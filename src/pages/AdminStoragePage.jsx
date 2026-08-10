import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { hydrateFactoryMapsFromPublicJson } from "../utils/streetViewAdminStorage";
import "../styles/admin.css";

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

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
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
    const error = new Error(payload.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function AdminStoragePage() {
  const navigate = useNavigate();
  const [summary, setSummary] = useState(null);
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionText, setActionText] = useState("");
  const [errorText, setErrorText] = useState("");
  const [cleanupDays, setCleanupDays] = useState(30);
  const [working, setWorking] = useState(false);

  async function refresh() {
    setLoading(true);
    setErrorText("");
    try {
      const [summaryPayload, assetsPayload] = await Promise.all([
        apiJson("/api/admin/storage-summary"),
        apiJson("/api/admin/storage-assets?limit=5000"),
      ]);
      setSummary(summaryPayload);
      setAssets(assetsPayload.assets || []);
    } catch (error) {
      setErrorText(error.message || "Failed to load storage data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const panoramasNeedingMultires = useMemo(
    () =>
      assets.filter(
        (asset) =>
          asset.kind === "panos" &&
          asset.fileExists !== false &&
          asset.processing_status !== "ready" &&
          !asset.deleted_at,
      ),
    [assets],
  );

  const unusedAssets = useMemo(
    () => assets.filter((asset) => !asset.is_referenced && !asset.deleted_at),
    [assets],
  );

  const eligibleUnused = useMemo(() => {
    const days = Math.max(0, Number(cleanupDays || 0));
    return unusedAssets.filter((asset) => daysUnused(asset) >= days);
  }, [cleanupDays, unusedAssets]);

  async function generateOne(asset) {
    if (!asset || working) return;
    if (summary?.multires?.available === false) {
      alert(
        `Multires generation is not available in this runtime (${summary.multires.reason || "unknown reason"}). Use the Docker deployment, which includes Python and Hugin/nona.`,
      );
      return;
    }

    setWorking(true);
    setErrorText("");
    setActionText(`Generating multires: ${asset.original_name || asset.public_path}`);
    try {
      await apiJson(`/api/admin/assets/${asset.id}/generate-multires`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      await hydrateFactoryMapsFromPublicJson({ force: true });
      setActionText("Multires generation complete.");
      await refresh();
    } catch (error) {
      setErrorText(error.message);
    } finally {
      setWorking(false);
    }
  }

  async function generateExisting() {
    if (!panoramasNeedingMultires.length || working) return;
    if (summary?.multires?.available === false) {
      alert(
        `Multires generation is not available in this runtime (${summary.multires.reason || "unknown reason"}). Use the Docker deployment, which includes Python and Hugin/nona.`,
      );
      return;
    }

    const confirmed = window.confirm(
      `Generate multires tiles for ${panoramasNeedingMultires.length} panorama(s)? Originals will be kept untouched.`,
    );
    if (!confirmed) return;

    setWorking(true);
    setErrorText("");
    let succeeded = 0;
    const failed = [];

    for (let index = 0; index < panoramasNeedingMultires.length; index += 1) {
      const asset = panoramasNeedingMultires[index];
      setActionText(
        `Generating ${index + 1}/${panoramasNeedingMultires.length}: ${asset.original_name || asset.public_path}`,
      );
      try {
        await apiJson(`/api/admin/assets/${asset.id}/generate-multires`, {
          method: "POST",
          body: JSON.stringify({}),
        });
        succeeded += 1;
      } catch (error) {
        failed.push(`${asset.original_name || asset.public_path}: ${error.message}`);
      }
    }

    try {
      await hydrateFactoryMapsFromPublicJson({ force: true });
      await refresh();
      setActionText(
        failed.length
          ? `${succeeded} generated; ${failed.length} failed. ${failed[0]}`
          : `${succeeded} panorama(s) converted to multires.`,
      );
    } catch (error) {
      setErrorText(error.message || "Multires generation finished, but the page could not refresh.");
    } finally {
      setWorking(false);
    }
  }

  async function deleteOne(asset) {
    if (working) return;
    if (asset.is_referenced) {
      alert("This file is still used by the live map and cannot be deleted.");
      return;
    }
    const confirmed = window.confirm(
      `Permanently delete this unused file?\n\n${asset.original_name || asset.public_path}\n\nThis also removes its generated multires tiles, if any.`,
    );
    if (!confirmed) return;

    setWorking(true);
    setActionText(`Deleting ${asset.original_name || asset.public_path}...`);
    try {
      await apiJson(`/api/admin/assets/${asset.id}`, { method: "DELETE" });
      setActionText("Unused asset deleted.");
      await refresh();
    } catch (error) {
      setErrorText(error.message);
    } finally {
      setWorking(false);
    }
  }

  async function cleanupByAge() {
    if (!eligibleUnused.length || working) return;
    const days = Math.max(0, Number(cleanupDays || 0));
    const bytes = eligibleUnused.reduce(
      (sum, asset) => sum + Number(asset.size_bytes || 0) + Number(asset.multires_bytes || 0),
      0,
    );
    const confirmed = window.confirm(
      `Delete ${eligibleUnused.length} unused asset(s) that have been unused for at least ${days} day(s)?\n\nEstimated space: ${formatBytes(bytes)}\n\nNothing is deleted automatically; this happens only because you are confirming it now.`,
    );
    if (!confirmed) return;

    setWorking(true);
    setActionText(`Deleting unused assets older than ${days} day(s)...`);
    setErrorText("");
    try {
      const result = await apiJson("/api/admin/storage-cleanup", {
        method: "POST",
        body: JSON.stringify({ days, confirm: true }),
      });
      setActionText(
        `Cleanup complete: ${result.deleted?.length || 0} deleted${result.failed?.length ? `, ${result.failed.length} failed` : ""}.`,
      );
      await refresh();
    } catch (error) {
      setErrorText(error.message);
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="admin-storage-page">
      <header className="admin-storage-topbar">
        <div>
          <p className="admin-eyebrow">Street View Admin</p>
          <h1>Storage & Multires</h1>
          <p>
            Panorama originals stay untouched. Generated tiles improve viewer loading,
            and unused files are deleted only when an admin explicitly chooses to delete them.
          </p>
        </div>
        <button type="button" onClick={() => navigate("/admin")}>Back to Admin</button>
      </header>

      {errorText && <div className="admin-storage-alert error">{errorText}</div>}
      {actionText && <div className="admin-storage-alert">{actionText}</div>}

      <section className="admin-storage-stats">
        <article>
          <span>Total Storage</span>
          <strong>{formatBytes(summary?.total_bytes)}</strong>
          <small>{formatBytes(summary?.multires_bytes)} generated tiles</small>
        </article>
        <article>
          <span>Stored Assets</span>
          <strong>{summary?.file_count ?? "—"}</strong>
          <small>Database-tracked files</small>
        </article>
        <article>
          <span>Unused Assets</span>
          <strong>{summary?.unreferenced_count ?? "—"}</strong>
          <small>{formatBytes(summary?.unreferenced_bytes)} reclaimable</small>
        </article>
        <article>
          <span>Multires</span>
          <strong>{summary?.multires_ready_count ?? "—"}</strong>
          <small>{summary?.multires_pending_count ?? 0} still need generation</small>
        </article>
      </section>

      <section className="admin-storage-panel">
        <div className="admin-storage-panel-head">
          <div>
            <p className="admin-eyebrow">Panorama Optimization</p>
            <h2>Multiresolution Tiles</h2>
            <p>
              New 360 uploads are converted automatically when the generator is available.
              Existing panoramas can be converted here without re-uploading them.
            </p>
          </div>
          <button
            type="button"
            className="primary"
            disabled={working || loading || !panoramasNeedingMultires.length}
            onClick={generateExisting}
          >
            Generate for Existing Panoramas ({panoramasNeedingMultires.length})
          </button>
        </div>

        <div className="admin-storage-runtime">
          <span>Generator</span>
          <strong className={summary?.multires?.available ? "ok" : "warn"}>
            {summary?.multires?.available ? "Available" : `Unavailable: ${summary?.multires?.reason || "unknown"}`}
          </strong>
          <span>Queue</span>
          <strong>{summary?.multires?.active || 0} active / {summary?.multires?.queued || 0} queued</strong>
        </div>

        <div className="admin-storage-list compact">
          {panoramasNeedingMultires.length === 0 && !loading && (
            <div className="admin-storage-empty">All registered panoramas have multires tiles.</div>
          )}
          {panoramasNeedingMultires.slice(0, 50).map((asset) => (
            <article key={asset.id} className="admin-storage-row">
              <div>
                <strong>{asset.original_name || `Panorama ${asset.id}`}</strong>
                <small>{asset.public_path}</small>
              </div>
              <span className={`asset-status ${asset.processing_status}`}>
                {asset.processing_status?.replaceAll("_", " ") || "not generated"}
              </span>
              <span>{formatBytes(asset.size_bytes)}</span>
              <button type="button" disabled={working} onClick={() => generateOne(asset)}>
                Generate
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className="admin-storage-panel">
        <div className="admin-storage-panel-head cleanup-head">
          <div>
            <p className="admin-eyebrow">Manual Cleanup</p>
            <h2>Unused Assets</h2>
            <p>
              There is no automatic 30-day deletion. Choose a retention age below and press
              the delete button only when you want to clean up those files.
            </p>
          </div>
          <div className="admin-storage-cleanup-controls">
            <label>
              Unused for at least
              <span>
                <input
                  type="number"
                  min="0"
                  max="3650"
                  value={cleanupDays}
                  onChange={(event) => setCleanupDays(event.target.value)}
                />
                days
              </span>
            </label>
            <button
              type="button"
              className="danger"
              disabled={working || !eligibleUnused.length}
              onClick={cleanupByAge}
            >
              Delete Eligible ({eligibleUnused.length})
            </button>
          </div>
        </div>

        <div className="admin-storage-list">
          {unusedAssets.length === 0 && !loading && (
            <div className="admin-storage-empty">No unused assets.</div>
          )}
          {unusedAssets.map((asset) => (
            <article key={asset.id} className="admin-storage-row unused">
              <div className="admin-storage-file-info">
                <strong>{asset.original_name || `Asset ${asset.id}`}</strong>
                <small>{asset.public_path}</small>
                <em>
                  {asset.kind} · unused {daysUnused(asset)} day(s) · since {formatDate(asset.unreferenced_at || asset.created_at)}
                </em>
              </div>
              <span>{formatBytes(Number(asset.size_bytes || 0) + Number(asset.multires_bytes || 0))}</span>
              <div className="admin-storage-row-actions">
                {asset.fileExists !== false && (
                  <button
                    type="button"
                    onClick={() => window.open(asset.public_path, "_blank", "noopener,noreferrer")}
                  >
                    Preview
                  </button>
                )}
                <button type="button" className="danger" disabled={working} onClick={() => deleteOne(asset)}>
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

export default AdminStoragePage;
