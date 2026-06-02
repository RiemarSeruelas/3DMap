import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "pannellum/build/pannellum.css";
import "pannellum";
import {
  getEffectiveSite,
  getEffectiveArea,
  ensureTour,
  updateAreaTour,
  uploadAssetFile,
  createUniqueId,
} from "../utils/streetViewAdminStorage";
import "../styles/AdminAreaConfigPage.css";
import "../styles/admin-map-dot-patch.css";

function getSceneImage(scene) {
  return scene?.panorama || scene?.image || scene?.url || scene?.publicPath || "";
}

function getSceneTitle(scene, fallback = "Untitled Location") {
  return scene?.title || scene?.name || scene?.label || fallback;
}

function getSiteMapImage(site, area, tour) {
  return (
    site?.mapImage ||
    site?.image ||
    site?.map ||
    site?.floorMap ||
    site?.siteMap ||
    area?.mapImage ||
    area?.image ||
    area?.map ||
    tour?.mapImage ||
    ""
  );
}

function toLegacyPercentPoint(pitch, yaw) {
  return {
    x: Number((((yaw + 180) / 360) * 100).toFixed(2)),
    y: Number((((90 - pitch) / 180) * 100).toFixed(2)),
  };
}

function legacyPercentToPano(point = {}) {
  const x = Number(point.x || 50);
  const y = Number(point.y || 50);

  return {
    pitch: Number((90 - y * 1.8).toFixed(2)),
    yaw: Number((x * 3.6 - 180).toFixed(2)),
  };
}

function normalizeHotspotPosition(hotspot) {
  if (Number.isFinite(Number(hotspot?.pitch)) && Number.isFinite(Number(hotspot?.yaw))) {
    return {
      pitch: Number(hotspot.pitch),
      yaw: Number(hotspot.yaw),
    };
  }

  return legacyPercentToPano(hotspot);
}

function getSceneMapPoint(scene) {
  return scene?.mapPoint || scene?.minimap || null;
}

function PannellumStage({ image, scene, scenesById, isPicking, pickLabel, onPickPoint, onGoToScene }) {
  const mountRef = useRef(null);
  const viewerRef = useRef(null);
  const onGoToSceneRef = useRef(onGoToScene);
  const onPickPointRef = useRef(onPickPoint);
  const hotspotSignature = JSON.stringify(scene?.hotspots || []);

  useEffect(() => {
    onGoToSceneRef.current = onGoToScene;
  }, [onGoToScene]);

  useEffect(() => {
    onPickPointRef.current = onPickPoint;
  }, [onPickPoint]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !image || !window?.pannellum?.viewer) return;

    mount.innerHTML = "";

    const hotSpots = (scene?.hotspots || [])
      .filter((hotspot) => hotspot?.targetSceneId)
      .map((hotspot) => {
        const position = normalizeHotspotPosition(hotspot);
        const targetScene = scenesById?.[hotspot.targetSceneId];

        return {
          pitch: position.pitch,
          yaw: position.yaw,
          cssClass: "admin-config-pnlm-hotspot-shell-v2",
          createTooltipFunc: (hotSpotDiv, args) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "admin-config-pnlm-hotspot-button-v2";
            button.innerHTML = "➜";
            button.title = args.title;
            button.addEventListener("click", (event) => {
              event.preventDefault();
              event.stopPropagation();
              onGoToSceneRef.current?.(args.targetSceneId);
            });
            hotSpotDiv.appendChild(button);
          },
          createTooltipArgs: {
            title: targetScene ? `Go to ${getSceneTitle(targetScene)}` : "Go to location",
            targetSceneId: hotspot.targetSceneId,
          },
        };
      });

    viewerRef.current = window.pannellum.viewer(mount, {
      type: "equirectangular",
      panorama: image,
      autoLoad: true,
      showControls: false,
      compass: false,
      keyboardZoom: true,
      mouseZoom: true,
      hfov: 105,
      hotSpots,
    });

    return () => {
      try {
        viewerRef.current?.destroy?.();
      } catch {
        // Pannellum destroy can fail during route changes; safe to ignore.
      }
      viewerRef.current = null;
    };
  }, [image, scene?.id, hotspotSignature, scenesById]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    function handleClick(event) {
      if (!isPicking) return;
      if (event.target.closest(".admin-config-pnlm-hotspot-button-v2")) return;

      if (viewerRef.current?.mouseEventToCoords) {
        const coords = viewerRef.current.mouseEventToCoords(event);
        if (Array.isArray(coords) && coords.length >= 2) {
          onPickPointRef.current?.({
            pitch: Number(coords[0].toFixed(2)),
            yaw: Number(coords[1].toFixed(2)),
          });
        }
      }
    }

    mount.addEventListener("click", handleClick);
    return () => mount.removeEventListener("click", handleClick);
  }, [isPicking]);

  function handleFallbackClick(event) {
    if (!isPicking) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    const point = legacyPercentToPano({ x, y });
    onPickPointRef.current?.(point);
  }

  function zoomBy(delta) {
    const viewer = viewerRef.current;
    if (!viewer?.getHfov || !viewer?.setHfov) return;
    const nextHfov = Math.max(35, Math.min(120, viewer.getHfov() + delta));
    viewer.setHfov(nextHfov);
  }

  function toggleFullscreen() {
    const target = mountRef.current?.parentElement;
    if (!target) return;

    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else {
      target.requestFullscreen?.();
    }
  }

  if (!image) {
    return (
      <div className="admin-config-empty-preview-v2">
        <div>
          <b>No 360 image selected</b>
          <span>Add an image from the left panel.</span>
        </div>
      </div>
    );
  }

  const hasPannellum = typeof window !== "undefined" && !!window?.pannellum?.viewer;

  return (
    <div
      className={`admin-config-pannellum-wrap-v2 ${isPicking ? "is-marking" : ""}`}
      onClick={!hasPannellum ? handleFallbackClick : undefined}
    >
      {hasPannellum ? (
        <div ref={mountRef} className="admin-config-pannellum-mount-v2" />
      ) : (
        <img src={image} alt={getSceneTitle(scene)} className="admin-config-fallback-panorama-v2" />
      )}

      <div className="admin-config-pannellum-controls-v2" onClick={(event) => event.stopPropagation()}>
        <button type="button" onClick={() => zoomBy(-10)} title="Zoom in">+</button>
        <button type="button" onClick={() => zoomBy(10)} title="Zoom out">−</button>
        <button type="button" onClick={toggleFullscreen} title="Fullscreen">⛶</button>
      </div>

      {isPicking && (
        <div className="admin-config-picking-banner-v2">
          {pickLabel || "Click inside the panorama to place the button"}
        </div>
      )}
    </div>
  );
}

function AdminAreaConfigPage() {
  const navigate = useNavigate();
  const { siteId, areaId } = useParams();
  const [searchParams] = useSearchParams();

  const fileInputRef = useRef(null);

  const [site, setSite] = useState(null);
  const [area, setArea] = useState(null);
  const [tour, setTour] = useState(null);
  const [selectedSceneId, setSelectedSceneId] = useState(null);

  const [searchText, setSearchText] = useState("");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newLocationName, setNewLocationName] = useState("");
  const [newLocationFile, setNewLocationFile] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  const [mode, setMode] = useState("preview");
  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
  const [isMapModalOpen, setIsMapModalOpen] = useState(false);
  const [pendingTargetSceneId, setPendingTargetSceneId] = useState(null);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editLocationName, setEditLocationName] = useState("");
  const [saveMessage, setSaveMessage] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadData() {
      const nextSite = await getEffectiveSite(siteId);
      const nextArea = await getEffectiveArea(siteId, areaId);
      const nextTour = ensureTour(nextArea?.tour, nextArea);
      const urlSceneId = searchParams.get("scene");

      if (!mounted) return;

      setSite(nextSite);
      setArea(nextArea);
      setTour(nextTour);

      const firstScene =
        (urlSceneId && nextTour?.scenes?.[urlSceneId] ? urlSceneId : null) ||
        nextTour?.settings?.firstScene ||
        Object.keys(nextTour?.scenes || {})[0] ||
        null;

      setSelectedSceneId(firstScene);
    }

    loadData();

    return () => {
      mounted = false;
    };
  }, [siteId, areaId, searchParams]);

  const scenes = useMemo(() => Object.values(tour?.scenes || {}), [tour]);
  const scenesById = useMemo(() => tour?.scenes || {}, [tour]);

  const filteredScenes = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    if (!query) return scenes;

    return scenes.filter((scene) => getSceneTitle(scene).toLowerCase().includes(query));
  }, [scenes, searchText]);

  const selectedScene = selectedSceneId ? tour?.scenes?.[selectedSceneId] : scenes[0];
  const selectedImage = getSceneImage(selectedScene);
  const pendingTargetScene = pendingTargetSceneId ? tour?.scenes?.[pendingTargetSceneId] : null;
  const siteMapImage = getSiteMapImage(site, area, tour);

  function logout() {
    sessionStorage.removeItem("streetViewAuth");
    sessionStorage.removeItem("streetViewRole");
    navigate("/login", { replace: true });
  }

  function showSaved(text = "Saved") {
    setSaveMessage(text);
    window.clearTimeout(window.__streetViewConfigSaveTimer);
    window.__streetViewConfigSaveTimer = window.setTimeout(() => setSaveMessage(""), 1600);
  }

  function saveTour(nextTour, message = "Saved") {
    setTour(nextTour);
    updateAreaTour(siteId, areaId, nextTour);
    showSaved(message);
  }

  async function handleAddLocation(event) {
    event.preventDefault();

    if (!newLocationFile) {
      alert("Please choose a 360 image first.");
      return;
    }

    setIsSaving(true);

    try {
      const existingIds = Object.keys(tour?.scenes || {});
      const locationTitle =
        newLocationName.trim() ||
        newLocationFile.name.replace(/\.[^/.]+$/, "") ||
        "New Location";

      const sceneId = createUniqueId(locationTitle, existingIds);
      const uploaded = await uploadAssetFile(newLocationFile, "panos");

      const nextScene = {
        id: sceneId,
        title: locationTitle,
        name: locationTitle,
        label: locationTitle,
        panorama: uploaded.publicPath || uploaded.url,
        thumbnail: uploaded.publicPath || uploaded.url,
        mapPoint: null,
        minimap: null,
        hotspots: [],
      };

      const nextTour = {
        ...tour,
        settings: {
          ...tour.settings,
          firstScene: tour?.settings?.firstScene || sceneId,
        },
        scenes: {
          ...(tour?.scenes || {}),
          [sceneId]: nextScene,
        },
      };

      saveTour(nextTour, "Image added");
      setSelectedSceneId(sceneId);
      setIsAddOpen(false);
      setNewLocationName("");
      setNewLocationFile(null);
      setSearchText("");

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (error) {
      console.error(error);
      alert("Failed to add location image.");
    } finally {
      setIsSaving(false);
    }
  }

  function openEditName() {
    if (!selectedScene?.id) return;
    setEditLocationName(getSceneTitle(selectedScene));
    setIsEditOpen(true);
  }

  function saveEditedName(event) {
    event.preventDefault();
    if (!selectedScene?.id) return;

    const cleanName = editLocationName.trim();
    if (!cleanName) {
      alert("Location name cannot be blank.");
      return;
    }

    const nextScene = {
      ...selectedScene,
      title: cleanName,
      name: cleanName,
      label: cleanName,
    };

    const nextTour = {
      ...tour,
      scenes: {
        ...tour.scenes,
        [selectedScene.id]: nextScene,
      },
    };

    saveTour(nextTour, "Name saved");
    setIsEditOpen(false);
  }

  function deleteSelectedLocation() {
    if (!selectedScene?.id) return;

    const ok = confirm(`Delete "${getSceneTitle(selectedScene)}"?`);
    if (!ok) return;

    const nextScenes = { ...(tour?.scenes || {}) };
    delete nextScenes[selectedScene.id];

    const remainingIds = Object.keys(nextScenes);
    const nextFirstScene =
      tour?.settings?.firstScene === selectedScene.id
        ? remainingIds[0] || null
        : tour?.settings?.firstScene || remainingIds[0] || null;

    const nextTour = {
      ...tour,
      settings: {
        ...tour.settings,
        firstScene: nextFirstScene,
      },
      scenes: nextScenes,
    };

    saveTour(nextTour, "Image deleted");
    setSelectedSceneId(nextFirstScene);
    setMode("preview");
  }

  function openMarkLocationPicker() {
    if (!selectedScene?.id) return;

    if (scenes.length < 2) {
      alert("Add another 360 image first, then connect this image to it.");
      return;
    }

    setMode("preview");
    setPendingTargetSceneId(null);
    setIsLinkModalOpen(true);
  }

  function chooseTargetScene(targetSceneId) {
    setPendingTargetSceneId(targetSceneId);
    setIsLinkModalOpen(false);
    setMode("mark-location");
  }

  const handlePanoPick = useCallback((point) => {
    if (!selectedScene?.id) return;

    if (mode === "mark-location" && pendingTargetSceneId) {
      const targetScene = tour?.scenes?.[pendingTargetSceneId];
      const currentHotspots = selectedScene.hotspots || [];
      const existingHotspot = currentHotspots.find(
        (hotspot) => hotspot?.targetSceneId === pendingTargetSceneId
      );
      const legacyPoint = toLegacyPercentPoint(point.pitch, point.yaw);

      const nextHotspot = {
        ...(existingHotspot || {}),
        id: existingHotspot?.id || createUniqueId(`to-${pendingTargetSceneId}`, currentHotspots.map((hotspot) => hotspot.id)),
        type: "scene",
        targetSceneId: pendingTargetSceneId,
        text: targetScene ? getSceneTitle(targetScene) : "Go to location",
        coordinateMode: "pannellum",
        pitch: point.pitch,
        yaw: point.yaw,
        x: legacyPoint.x,
        y: legacyPoint.y,
      };

      const nextScene = {
        ...selectedScene,
        hotspots: existingHotspot
          ? currentHotspots.map((hotspot) =>
              hotspot.id === existingHotspot.id ? nextHotspot : hotspot
            )
          : [...currentHotspots, nextHotspot],
      };

      const nextConnection = {
        id: `${selectedScene.id}-to-${pendingTargetSceneId}`,
        from: selectedScene.id,
        to: pendingTargetSceneId,
        label: targetScene ? `Go to ${getSceneTitle(targetScene)}` : "Go to location",
        type: "move",
        hotspot: {
          coordinateMode: "pannellum",
          yaw: point.yaw,
          pitch: point.pitch,
          x: legacyPoint.x,
          y: legacyPoint.y,
          icon: "↑",
        },
      };

      const otherConnections = (tour?.connections || []).filter(
        (connection) => !(connection?.from === selectedScene.id && connection?.to === pendingTargetSceneId)
      );

      const nextTour = {
        ...tour,
        scenes: {
          ...tour.scenes,
          [selectedScene.id]: nextScene,
        },
        connections: [...otherConnections, nextConnection],
      };

      saveTour(nextTour, existingHotspot ? "Location button relocated" : "Location button added");
      setPendingTargetSceneId(null);
      setMode("preview");
    }
  }, [mode, pendingTargetSceneId, selectedScene, tour]);

  const goToScene = useCallback((targetSceneId) => {
    if (!tour?.scenes?.[targetSceneId]) return;
    setSelectedSceneId(targetSceneId);
    setMode("preview");
    setPendingTargetSceneId(null);
  }, [tour]);

  function handleMapPlacementClick(event) {
    if (!selectedScene?.id) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const x = Number((((event.clientX - rect.left) / rect.width) * 100).toFixed(2));
    const y = Number((((event.clientY - rect.top) / rect.height) * 100).toFixed(2));
    const point = { x, y };

    const nextScene = {
      ...selectedScene,
      mapPoint: point,
      minimap: point,
    };

    const nextTour = {
      ...tour,
      scenes: {
        ...tour.scenes,
        [selectedScene.id]: nextScene,
      },
    };

    saveTour(nextTour, `Map dot saved at ${x}, ${y}`);
    setIsMapModalOpen(false);
  }

  return (
    <div className="admin-config-page-v2">
      <header className="admin-config-topbar-v2">
        <div className="admin-config-topbar-brand-v2">
          <div className="admin-config-logo-v2">360</div>
          <div>
            <span>Street View Admin</span>
            <strong>Location Configuration</strong>
          </div>
        </div>

        <div className="admin-config-topbar-meta-v2">
          <div>
            <span>Site</span>
            <strong>{site?.name || siteId}</strong>
          </div>
          <div>
            <span>Area</span>
            <strong>{area?.name || areaId}</strong>
          </div>
        </div>

        <nav className="admin-config-topbar-actions-v2">
          <button type="button" onClick={() => navigate("/admin")}>Open Map</button>
          <button type="button" onClick={() => navigate(`/viewer/${siteId}/${areaId}${selectedScene?.id ? `?scene=${selectedScene.id}` : ""}`)}>Open Viewer</button>
          <button type="button" className="danger" onClick={logout}>Logout</button>
        </nav>
      </header>

      <main className="admin-config-workspace-v2">
        <aside className="admin-config-image-rail-v2">
          <label className="admin-config-search-v2">
            <span>Search locations</span>
            <input
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Search image name..."
            />
          </label>

          <button
            type="button"
            className="admin-config-add-card-v2"
            onClick={() => setIsAddOpen(true)}
          >
            <b>+</b>
            <div>
              <strong>Add 360 Image</strong>
              <small>Upload new panorama</small>
            </div>
          </button>

          <div className="admin-config-rail-title-v2">
            <span>Uploaded Images</span>
            <strong>{scenes.length}</strong>
          </div>

          <div className="admin-config-image-list-v2">
            {filteredScenes.length === 0 ? (
              <div className="admin-config-empty-list-v2">
                No image names match your search.
              </div>
            ) : (
              filteredScenes.map((scene) => {
                const image = getSceneImage(scene);
                const isActive = selectedScene?.id === scene.id;
                const isMapped = !!getSceneMapPoint(scene);

                return (
                  <button
                    key={scene.id}
                    type="button"
                    className={`admin-config-image-card-v2 ${isActive ? "active" : ""}`}
                    onClick={() => {
                      setSelectedSceneId(scene.id);
                      setMode("preview");
                      setPendingTargetSceneId(null);
                    }}
                  >
                    {image ? (
                      <img src={image} alt={getSceneTitle(scene)} />
                    ) : (
                      <div className="admin-config-card-no-image-v2">No Image</div>
                    )}

                    <div className="admin-config-image-card-label-v2">
                      <strong>{getSceneTitle(scene)}</strong>
                    </div>

                    {isMapped && <em className="admin-config-map-mark-v2">MAP</em>}
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <section className="admin-config-center-stage-v2">
          <div className="admin-config-stage-header-v2">
            <strong>{selectedScene ? getSceneTitle(selectedScene) : "No image selected"}</strong>

            <div className="admin-config-stage-right-v2">
              {saveMessage && <span className="admin-config-save-flash-v2">{saveMessage}</span>}
              {mode !== "preview" && (
                <div className="admin-config-mode-pill-v2 active">
                  {mode === "mark-location" && pendingTargetScene && `Click panorama to place button to ${getSceneTitle(pendingTargetScene)}`}
                </div>
              )}
            </div>
          </div>

          <div className="admin-config-main-preview-v2">
            <PannellumStage
              image={selectedImage}
              scene={selectedScene}
              scenesById={scenesById}
              isPicking={mode === "mark-location"}
              pickLabel={
                mode === "mark-location" && pendingTargetScene
                  ? `Click where the button to ${getSceneTitle(pendingTargetScene)} should appear`
                  : "Click inside the panorama"
              }
              onPickPoint={handlePanoPick}
              onGoToScene={goToScene}
            />
          </div>

          <div className="admin-config-preview-actions-bar-v2">
            <button
              type="button"
              onClick={() => {
                if (!siteMapImage) {
                  alert("No site map image found for this site yet.");
                  return;
                }
                setMode("preview");
                setIsMapModalOpen(true);
              }}
              disabled={!selectedScene}
            >
              Mark in Map
            </button>

            <button
              type="button"
              onClick={openMarkLocationPicker}
              disabled={!selectedScene}
              className={mode === "mark-location" ? "active" : ""}
            >
              Mark Locations
            </button>

            <button type="button" onClick={openEditName} disabled={!selectedScene}>
              Edit
            </button>

            <button type="button" className="danger" onClick={deleteSelectedLocation} disabled={!selectedScene}>
              Delete
            </button>
          </div>
        </section>
      </main>

      {isAddOpen && (
        <div className="admin-config-modal-backdrop-v2" onMouseDown={() => setIsAddOpen(false)}>
          <form
            className="admin-config-add-modal-v2"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={handleAddLocation}
          >
            <div className="admin-config-modal-header-v2">
              <div>
                <span>Add Location</span>
                <strong>Upload 360 image</strong>
              </div>

              <button type="button" onClick={() => setIsAddOpen(false)}>×</button>
            </div>

            <label className="admin-config-form-field-v2">
              <span>Location Name</span>
              <input
                value={newLocationName}
                onChange={(event) => setNewLocationName(event.target.value)}
                placeholder="Example: Filler Entrance"
              />
            </label>

            <label className="admin-config-upload-box-v2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={(event) => setNewLocationFile(event.target.files?.[0] || null)}
              />

              <b>{newLocationFile ? newLocationFile.name : "Choose 360 Image"}</b>
              <span>JPG, PNG, WEBP panorama image</span>
            </label>

            <div className="admin-config-modal-actions-v2">
              <button type="button" onClick={() => setIsAddOpen(false)}>Cancel</button>
              <button type="submit" className="primary" disabled={isSaving}>
                {isSaving ? "Adding..." : "Add Image"}
              </button>
            </div>
          </form>
        </div>
      )}

      {isEditOpen && (
        <div className="admin-config-modal-backdrop-v2" onMouseDown={() => setIsEditOpen(false)}>
          <form
            className="admin-config-add-modal-v2"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={saveEditedName}
          >
            <div className="admin-config-modal-header-v2">
              <div>
                <span>Edit Location</span>
                <strong>Rename 360 image</strong>
              </div>

              <button type="button" onClick={() => setIsEditOpen(false)}>×</button>
            </div>

            <label className="admin-config-form-field-v2">
              <span>Location Name</span>
              <input
                value={editLocationName}
                onChange={(event) => setEditLocationName(event.target.value)}
                placeholder="Example: Engineering Room"
                autoFocus
              />
            </label>

            <div className="admin-config-modal-actions-v2">
              <button type="button" onClick={() => setIsEditOpen(false)}>Cancel</button>
              <button type="submit" className="primary">Save Name</button>
            </div>
          </form>
        </div>
      )}

      {isMapModalOpen && (
        <div className="admin-config-modal-backdrop-v2" onMouseDown={() => setIsMapModalOpen(false)}>
          <section className="admin-config-map-modal-v2" onMouseDown={(event) => event.stopPropagation()}>
            <div className="admin-config-modal-header-v2">
              <div>
                <span>Mark in Map</span>
                <strong>{getSceneTitle(selectedScene)}</strong>
              </div>

              <button type="button" onClick={() => setIsMapModalOpen(false)}>×</button>
            </div>

            <p className="admin-config-map-help-v2">Click the site map where this 360 location should appear. It saves as a small dot only.</p>

            <div className="admin-config-map-canvas-v2" onClick={handleMapPlacementClick}>
              <img src={siteMapImage} alt={site?.name || siteId} />

              {area?.points && (
                <svg className="admin-config-map-area-overlay-v2" viewBox="0 0 100 100" preserveAspectRatio="none">
                  <polygon points={area.points} />
                </svg>
              )}

              {scenes.map((scene) => {
                const point = getSceneMapPoint(scene);
                if (!point) return null;

                const isSelected = scene.id === selectedScene?.id;

                return (
                  <span
                    key={scene.id}
                    className={`admin-config-site-dot-v2 ${isSelected ? "is-selected" : ""}`}
                    style={{
                      left: `${point.x}%`,
                      top: `${point.y}%`,
                    }}
                    title={getSceneTitle(scene)}
                  />
                );
              })}
            </div>
          </section>
        </div>
      )}

      {isLinkModalOpen && (
        <div className="admin-config-modal-backdrop-v2" onMouseDown={() => setIsLinkModalOpen(false)}>
          <section className="admin-config-link-modal-v2" onMouseDown={(event) => event.stopPropagation()}>
            <div className="admin-config-modal-header-v2">
              <div>
                <span>Mark Location</span>
                <strong>Choose destination image</strong>
              </div>

              <button type="button" onClick={() => setIsLinkModalOpen(false)}>×</button>
            </div>

            <div className="admin-config-link-gallery-v2">
              {scenes
                .filter((scene) => scene.id !== selectedScene?.id)
                .map((scene) => {
                  const image = getSceneImage(scene);
                  const alreadyMarked = (selectedScene?.hotspots || []).some(
                    (hotspot) => hotspot?.targetSceneId === scene.id
                  );

                  return (
                    <button
                      key={scene.id}
                      type="button"
                      className="admin-config-link-target-card-v2"
                      onClick={() => chooseTargetScene(scene.id)}
                    >
                      {image ? <img src={image} alt={getSceneTitle(scene)} /> : <div>No Image</div>}
                      <strong>{getSceneTitle(scene)}</strong>
                      {alreadyMarked && <em>Relocate existing</em>}
                    </button>
                  );
                })}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export default AdminAreaConfigPage;
