import { useEffect, useMemo, useState } from "react";
import {
  hydrateFactoryMapsFromPublicJson,
  waitForFactoryMapsSave,
} from "../utils/streetViewAdminStorage";

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const amount = bytes / 1024 ** exponent;
  return `${amount >= 100 || exponent === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[exponent]}`;
}

function daysUnused(asset) {
  const source = asset?.unreferenced_at || asset?.created_at;
  if (!source) return 0;
  const time = new Date(source).getTime();
  if (!Number.isFinite(time)) return 0;
  return Math.max(0, Math.floor((Date.now() - time) / 86_400_000));
}

async function apiJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      payload.error || `Request failed (${response.status})`,
    );
    error.status = response.status;
    throw error;
  }
  return payload;
}

function statusForAsset(asset) {
  if (!asset) {
    return {
      key: "unknown",
      label: "Checking image",
      help: "The app is checking whether this 360 image is ready for faster viewing.",
    };
  }

  if (asset.processing_status === "ready" && asset.multires_config) {
    return {
      key: "ready",
      label: "Ready for Faster Viewing",
      help: "No action is needed for this image.",
    };
  }

  if (asset.processing_status === "processing") {
    return {
      key: "working",
      label: "Optimization in Progress",
      help: "Please wait for this image to finish processing.",
    };
  }

  if (asset.processing_status === "failed") {
    return {
      key: "needs",
      label: "Needs Optimization",
      help: "The previous attempt did not finish. You can safely try again.",
    };
  }

  return {
    key: "needs",
    label: "Needs Optimization",
    help: "If you added or replaced this 360 image, click Optimize 360 Image so it loads faster for users.",
  };
}

function ImageMaintenancePanel({ selectedScene, onOptimizationComplete }) {
  const [summary, setSummary] = useState(null);
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [errorText, setErrorText] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [showOldFiles, setShowOldFiles] = useState(false);
  const [selectedOldIds, setSelectedOldIds] = useState([]);

  async function refresh({ quiet = false } = {}) {
    if (!quiet) setLoading(true);
    setErrorText("");
    try {
      const [summaryPayload, assetsPayload] = await Promise.all([
        apiJson("/api/admin/storage-summary"),
        apiJson("/api/admin/storage-assets?limit=5000"),
      ]);
      setSummary(summaryPayload);
      setAssets(assetsPayload.assets || []);
    } catch (error) {
      setErrorText(error.message || "Could not check the 360 images.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (!selectedScene?.panorama) return undefined;
    let cancelled = false;

    (async () => {
      await waitForFactoryMapsSave();
      if (!cancelled) await refresh({ quiet: true });
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedScene?.panorama, selectedScene?.panoramaAssetId]);

  const currentAsset = useMemo(() => {
    const sceneAssetId = Number(selectedScene?.panoramaAssetId || 0);
    if (sceneAssetId) {
      const byId = assets.find((asset) => Number(asset.id) === sceneAssetId);
      if (byId) return byId;
    }

    const panoramaPath = selectedScene?.panorama;
    if (!panoramaPath) return null;
    return assets.find((asset) => asset.public_path === panoramaPath) || null;
  }, [assets, selectedScene?.panorama, selectedScene?.panoramaAssetId]);

  const activeImagesNeedingOptimization = useMemo(
    () =>
      assets.filter(
        (asset) =>
          asset.kind === "panos" &&
          asset.is_referenced &&
          !asset.deleted_at &&
          asset.fileExists !== false &&
          !(asset.processing_status === "ready" && asset.multires_config),
      ),
    [assets],
  );

  const oldUnusedFiles = useMemo(
    () => assets.filter((asset) => !asset.is_referenced && !asset.deleted_at),
    [assets],
  );

  const selectedOldFiles = useMemo(
    () => oldUnusedFiles.filter((asset) => selectedOldIds.includes(Number(asset.id))),
    [oldUnusedFiles, selectedOldIds],
  );

  useEffect(() => {
    const validIds = new Set(oldUnusedFiles.map((asset) => Number(asset.id)));
    setSelectedOldIds((current) => current.filter((id) => validIds.has(Number(id))));
  }, [oldUnusedFiles]);

  const currentStatus = statusForAsset(currentAsset);
  const canOptimize = summary?.multires?.available !== false;

  async function finishOptimization(messageText) {
    await hydrateFactoryMapsFromPublicJson({ force: true });
    if (onOptimizationComplete) await onOptimizationComplete();
    await refresh({ quiet: true });
    setMessage(messageText);
  }

  async function optimizeAsset(asset) {
    if (!asset || working) return;

    if (!canOptimize) {
      setIsOpen(true);
      setErrorText(
        "Image optimization is not available in this runtime. The 360 image still works normally. Use the Docker deployment to enable optimization.",
      );
      return;
    }

    setWorking(true);
    setMessage("Optimizing 360 image...");
    setErrorText("");
    try {
      await waitForFactoryMapsSave();
      await apiJson(`/api/admin/assets/${asset.id}/generate-multires`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      await finishOptimization("360 image is ready for faster viewing.");
    } catch (error) {
      setMessage("");
      setErrorText(error.message || "Image optimization failed.");
    } finally {
      setWorking(false);
    }
  }

  async function optimizeAll() {
    if (!activeImagesNeedingOptimization.length || working) return;

    if (!canOptimize) {
      setErrorText(
        "Image optimization is not available in this runtime. The images still work normally. Use the Docker deployment to enable optimization.",
      );
      return;
    }

    const confirmed = window.confirm(
      `Optimize ${activeImagesNeedingOptimization.length} active 360 image(s) for faster viewing?\n\nThe original images will stay untouched.`,
    );
    if (!confirmed) return;

    setWorking(true);
    setErrorText("");
    let succeeded = 0;
    let failed = 0;

    await waitForFactoryMapsSave();

    for (let index = 0; index < activeImagesNeedingOptimization.length; index += 1) {
      const asset = activeImagesNeedingOptimization[index];
      setMessage(
        `Optimizing image ${index + 1} of ${activeImagesNeedingOptimization.length}...`,
      );
      try {
        await apiJson(`/api/admin/assets/${asset.id}/generate-multires`, {
          method: "POST",
          body: JSON.stringify({}),
        });
        succeeded += 1;
      } catch (_error) {
        failed += 1;
      }
    }

    try {
      await finishOptimization(
        failed
          ? `${succeeded} image(s) optimized. ${failed} could not be optimized.`
          : `${succeeded} image(s) are ready for faster viewing.`,
      );
    } catch (error) {
      setErrorText(error.message || "Optimization finished, but the page could not refresh.");
    } finally {
      setWorking(false);
    }
  }

  async function deleteOldFile(asset) {
    if (!asset || working) return;
    if (asset.is_referenced) {
      alert("This image is still used by the live map and cannot be deleted.");
      return;
    }

    const confirmed = window.confirm(
      `Permanently delete this old unused file?\n\n${asset.original_name || asset.public_path}\n\nThis action cannot be undone.`,
    );
    if (!confirmed) return;

    setWorking(true);
    setMessage("Deleting old unused file...");
    try {
      await apiJson(`/api/admin/assets/${asset.id}`, { method: "DELETE" });
      setMessage("Old unused file deleted.");
      await refresh({ quiet: true });
    } catch (error) {
      setErrorText(error.message || "Could not delete the old file.");
    } finally {
      setWorking(false);
    }
  }

  function toggleOldFileSelection(assetId) {
    const id = Number(assetId);
    setSelectedOldIds((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    );
  }

  function toggleSelectAllShown() {
    const shownIds = oldUnusedFiles.map((asset) => Number(asset.id));
    const allSelected = shownIds.length > 0 && shownIds.every((id) => selectedOldIds.includes(id));
    setSelectedOldIds(allSelected ? [] : shownIds);
  }

  async function deleteSelectedOldFiles() {
    if (!selectedOldFiles.length || working) return;
    const bytes = selectedOldFiles.reduce(
      (sum, asset) =>
        sum + Number(asset.size_bytes || 0) + Number(asset.multires_bytes || 0),
      0,
    );

    const confirmed = window.confirm(
      `Permanently delete ${selectedOldFiles.length} selected old file(s)?\n\nEstimated space: ${formatBytes(bytes)}\n\nOnly the files you checked will be deleted. This action cannot be undone.`,
    );
    if (!confirmed) return;

    setWorking(true);
    setMessage("Deleting selected old files...");
    setErrorText("");
    try {
      const result = await apiJson("/api/admin/storage-cleanup", {
        method: "POST",
        body: JSON.stringify({
          days: 0,
          ids: selectedOldFiles.map((asset) => Number(asset.id)),
          confirm: true,
        }),
      });
      setSelectedOldIds([]);
      setMessage(
        `${result.deleted?.length || 0} selected old file(s) deleted${result.failed?.length ? `; ${result.failed.length} failed` : ""}.`,
      );
      await refresh({ quiet: true });
    } catch (error) {
      setErrorText(error.message || "Could not delete the selected old files.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <>
      <section className={`location-image-speed-card ${currentStatus.key}`}>
        <div className="location-image-speed-copy">
          <span>360 Image Loading</span>
          <strong>{loading ? "Checking image..." : currentStatus.label}</strong>
          <small>{currentStatus.help}</small>
        </div>

        <div className="location-image-speed-actions">
          {currentStatus.key !== "ready" && currentAsset && (
            <button
              type="button"
              className="primary"
              disabled={working || loading}
              onClick={() => optimizeAsset(currentAsset)}
            >
              {working ? "Working..." : "Optimize 360 Image"}
            </button>
          )}
          {currentStatus.key === "ready" && (
            <span className="location-image-ready-pill">✓ Optimized</span>
          )}
          <button type="button" onClick={() => setIsOpen(true)}>
            Image Maintenance
            {activeImagesNeedingOptimization.length > 0
              ? ` (${activeImagesNeedingOptimization.length})`
              : ""}
          </button>
        </div>
      </section>

      {isOpen && (
        <div
          className="admin-config-modal-backdrop-v2 image-maintenance-backdrop"
          onMouseDown={() => !working && setIsOpen(false)}
        >
          <section
            className={`image-maintenance-modal ${showOldFiles ? "old-drawer-open" : ""}`}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="image-maintenance-header">
              <div>
                <span>Location Configuration</span>
                <h2>360 Image Maintenance</h2>
              </div>
              <button
                type="button"
                className="image-maintenance-close"
                disabled={working}
                onClick={() => setIsOpen(false)}
                aria-label="Close"
              >
                ×
              </button>
            </header>

            <div className="image-maintenance-scroll-body">
              {errorText && <div className="image-maintenance-alert error">{errorText}</div>}
            {message && <div className="image-maintenance-alert">{message}</div>}

            <div className="image-maintenance-main-grid">
              <article className={`image-maintenance-current-card ${currentStatus.key}`}>
                <span>Selected Location</span>
                <strong>{selectedScene?.title || selectedScene?.name || "No location selected"}</strong>
                <div className="image-maintenance-status-line">
                  <b>{currentStatus.label}</b>
                  {currentAsset && <em>{formatBytes(currentAsset.size_bytes)}</em>}
                </div>
                <p>{currentStatus.help}</p>
                {currentStatus.key !== "ready" && currentAsset && (
                  <button
                    type="button"
                    className="primary"
                    disabled={working || loading}
                    onClick={() => optimizeAsset(currentAsset)}
                  >
                    {working ? "Working..." : "Optimize This 360 Image"}
                  </button>
                )}
                {currentStatus.key === "ready" && (
                  <div className="image-maintenance-done">✓ No action needed</div>
                )}
              </article>

              <article className="image-maintenance-bulk-card">
                <span>All Active Locations</span>
                <strong>
                  {activeImagesNeedingOptimization.length
                    ? `${activeImagesNeedingOptimization.length} image(s) need optimization`
                    : "All 360 images are ready"}
                </strong>
                <p>
                  Use this after a batch upload or when several 360 images were replaced.
                </p>
                <button
                  type="button"
                  className="primary"
                  disabled={
                    working ||
                    loading ||
                    !activeImagesNeedingOptimization.length
                  }
                  onClick={optimizeAll}
                >
                  {working
                    ? "Working..."
                    : activeImagesNeedingOptimization.length
                      ? `Optimize All New / Updated Images (${activeImagesNeedingOptimization.length})`
                      : "Everything Is Optimized"}
                </button>
              </article>
            </div>

            <button
              type="button"
              className={`image-maintenance-old-launch ${showOldFiles ? "open" : ""}`}
              onClick={() => setShowOldFiles((current) => !current)}
            >
              <span>
                <strong>Old Unused Files</strong>
                <small>
                  {oldUnusedFiles.length
                    ? `${oldUnusedFiles.length} old file(s) are no longer used by the current map.`
                    : "No old unused files."}
                </small>
              </span>
              <b>{showOldFiles ? "−" : "+"}</b>
            </button>

            </div>

            {showOldFiles && (
              <aside className="image-maintenance-old-drawer">
                <header>
                  <div>
                    <span>Cleanup</span>
                    <h3>Old Unused Files</h3>
                    <p>
                      These are files left behind after an image was replaced. Nothing is deleted automatically.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="image-maintenance-drawer-close"
                    disabled={working}
                    onClick={() => setShowOldFiles(false)}
                    aria-label="Close old unused files"
                  >
                    ×
                  </button>
                </header>

                <div className="image-maintenance-drawer-controls">
                  <button
                    type="button"
                    className="image-maintenance-select-all"
                    disabled={!oldUnusedFiles.length || working}
                    onClick={toggleSelectAllShown}
                  >
                    {oldUnusedFiles.length > 0 &&
                    oldUnusedFiles.every((asset) => selectedOldIds.includes(Number(asset.id)))
                      ? "Clear Selection"
                      : `Select All (${oldUnusedFiles.length})`}
                  </button>
                </div>

                <div className="image-maintenance-old-drawer-list">
                  {oldUnusedFiles.length === 0 && (
                    <div className="image-maintenance-empty">
                      No old unused files.
                    </div>
                  )}

                  {oldUnusedFiles.map((asset) => {
                    const checked = selectedOldIds.includes(Number(asset.id));
                    return (
                      <article key={asset.id} className={checked ? "selected" : ""}>
                        <label className="image-maintenance-old-check">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={working}
                            onChange={() => toggleOldFileSelection(asset.id)}
                          />
                          <span aria-hidden="true" />
                        </label>

                        <div className="image-maintenance-old-copy">
                          <strong>{asset.original_name || `File ${asset.id}`}</strong>
                          <small>
                            Unused {daysUnused(asset)} day(s) · {formatBytes(Number(asset.size_bytes || 0) + Number(asset.multires_bytes || 0))}
                          </small>
                        </div>

                        <div className="image-maintenance-old-actions">
                          {asset.fileExists !== false && (
                            <button
                              type="button"
                              onClick={() =>
                                window.open(
                                  asset.public_path,
                                  "_blank",
                                  "noopener,noreferrer",
                                )
                              }
                            >
                              Preview
                            </button>
                          )}
                          <button
                            type="button"
                            className="danger"
                            disabled={working}
                            onClick={() => deleteOldFile(asset)}
                          >
                            Delete
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>

                <footer>
                  <span>
                    {selectedOldFiles.length
                      ? `${selectedOldFiles.length} selected`
                      : "Select the files you want to remove"}
                  </span>
                  <button
                    type="button"
                    className="danger"
                    disabled={working || !selectedOldFiles.length}
                    onClick={deleteSelectedOldFiles}
                  >
                    Delete Selected ({selectedOldFiles.length})
                  </button>
                </footer>
              </aside>
            )}
          </section>
        </div>
      )}
    </>
  );
}

export default ImageMaintenancePanel;
