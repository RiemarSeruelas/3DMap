import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import {
  clone,
  createConnection,
  createEmptyTour,
  createSceneFromUpload,
  getEffectiveFactoryMaps,
  makeSlug,
  saveFactoryMaps,
} from "../utils/streetViewAdminStorage";

function pointFromClick(event) {
  const rect = event.currentTarget.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * 100;
  const y = ((event.clientY - rect.top) / rect.height) * 100;

  return {
    x: Number(Math.max(0, Math.min(100, x)).toFixed(2)),
    y: Number(Math.max(0, Math.min(100, y)).toFixed(2)),
  };
}

function normalizeTour(area) {
  return area?.tour || createEmptyTour({ areaId: area?.id || "area", areaName: area?.name || "Area" });
}

function AdminAreaConfigPage() {
  const navigate = useNavigate();
  const { siteId, areaId } = useParams();

  const [maps, setMaps] = useState(() => getEffectiveFactoryMaps());
  const [selectedSceneId, setSelectedSceneId] = useState(null);
  const [sceneDraft, setSceneDraft] = useState({ title: "", label: "" });
  const [placingMapSceneId, setPlacingMapSceneId] = useState(null);
  const [connectionTargetId, setConnectionTargetId] = useState("");
  const [isPickingArrow, setIsPickingArrow] = useState(false);
  const [saveNotice, setSaveNotice] = useState("");

  const site = maps[siteId];
  const area = site?.areas?.find((item) => item.id === areaId) || null;
  const tour = normalizeTour(area);
  const scenes = tour.scenes || {};
  const sceneList = useMemo(() => Object.values(scenes), [scenes]);

  const safeSelectedSceneId = selectedSceneId || tour.settings?.firstScene || sceneList[0]?.id || null;
  const selectedScene = safeSelectedSceneId ? scenes[safeSelectedSceneId] : null;

  const outgoingConnections = (tour.connections || []).filter(
    (connection) => connection.from === safeSelectedSceneId
  );

  useEffect(() => {
    if (!selectedScene) return;
    setSceneDraft({
      title: selectedScene.title || "",
      label: selectedScene.label || "",
    });
  }, [selectedScene?.id]);

  if (!site) return <Navigate to="/admin" replace />;
  if (!area) return <Navigate to="/admin" replace />;

  function persist(nextMaps) {
    setMaps(nextMaps);
    saveFactoryMaps(nextMaps);
  }

  function showSavedNotice(message = "Saved") {
    setSaveNotice(message);
    window.clearTimeout(window.__streetViewSaveNoticeTimer);
    window.__streetViewSaveNoticeTimer = window.setTimeout(() => setSaveNotice(""), 1600);
  }

  function updateAreaTour(updater) {
    const nextMaps = clone(maps);
    const nextSite = nextMaps[siteId];

    nextSite.areas = nextSite.areas.map((item) => {
      if (item.id !== areaId) return item;
      const currentTour = normalizeTour(item);
      return {
        ...item,
        tour: updater(currentTour),
      };
    });

    persist(nextMaps);
  }

  function selectScene(sceneId) {
    const scene = scenes[sceneId];
    setSelectedSceneId(sceneId);
    setSceneDraft({
      title: scene?.title || "",
      label: scene?.label || "",
    });
    setConnectionTargetId("");
    setIsPickingArrow(false);
  }

  function uploadLocation(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const rawName = file.name.replace(/\.[^/.]+$/, "");
      const sceneId = `${makeSlug(rawName, "location")}-${Date.now()}`;
      const newScene = createSceneFromUpload({
        sceneId,
        title: rawName,
        label: rawName,
        panorama: reader.result,
        mapPoint: { x: 50, y: 50 },
      });

      updateAreaTour((currentTour) => ({
        ...currentTour,
        settings: {
          ...(currentTour.settings || {}),
          firstScene: currentTour.settings?.firstScene || sceneId,
          defaultHfov: currentTour.settings?.defaultHfov || 110,
          mobileHfov: currentTour.settings?.mobileHfov || 90,
        },
        scenes: {
          ...(currentTour.scenes || {}),
          [sceneId]: newScene,
        },
        connections: currentTour.connections || [],
      }));

      setSelectedSceneId(sceneId);
      setSceneDraft({ title: rawName, label: rawName });
      showSavedNotice("Location uploaded and saved");
    };

    reader.readAsDataURL(file);
    event.target.value = "";
  }

  function saveLocation() {
    if (!safeSelectedSceneId || !selectedScene) return;

    updateAreaTour((currentTour) => ({
      ...currentTour,
      scenes: {
        ...(currentTour.scenes || {}),
        [safeSelectedSceneId]: {
          ...currentTour.scenes[safeSelectedSceneId],
          title: sceneDraft.title.trim() || "Untitled Location",
          label: sceneDraft.label.trim() || sceneDraft.title.trim() || "Location",
        },
      },
    }));

    showSavedNotice("Location saved");
  }

  function setAsStart() {
    if (!safeSelectedSceneId) return;

    updateAreaTour((currentTour) => ({
      ...currentTour,
      settings: {
        ...(currentTour.settings || {}),
        firstScene: safeSelectedSceneId,
      },
    }));

    showSavedNotice("Start location saved");
  }

  function deleteLocation() {
    if (!safeSelectedSceneId) return;
    const confirmed = window.confirm("Delete this panorama location?");
    if (!confirmed) return;

    let nextSelectedId = null;

    updateAreaTour((currentTour) => {
      const nextScenes = { ...(currentTour.scenes || {}) };
      delete nextScenes[safeSelectedSceneId];

      const remainingIds = Object.keys(nextScenes);
      nextSelectedId = remainingIds[0] || null;

      return {
        ...currentTour,
        settings: {
          ...(currentTour.settings || {}),
          firstScene:
            currentTour.settings?.firstScene === safeSelectedSceneId
              ? nextSelectedId
              : currentTour.settings?.firstScene || nextSelectedId,
        },
        scenes: nextScenes,
        connections: (currentTour.connections || []).filter(
          (connection) => connection.from !== safeSelectedSceneId && connection.to !== safeSelectedSceneId
        ),
      };
    });

    setSelectedSceneId(nextSelectedId);
    if (nextSelectedId && scenes[nextSelectedId]) {
      setSceneDraft({ title: scenes[nextSelectedId].title || "", label: scenes[nextSelectedId].label || "" });
    } else {
      setSceneDraft({ title: "", label: "" });
    }
  }

  function startPlaceOnFactoryMap() {
    if (!safeSelectedSceneId) return;
    setPlacingMapSceneId(safeSelectedSceneId);
  }

  function handleFactoryMapClick(event) {
    if (!placingMapSceneId) return;
    const point = pointFromClick(event);

    updateAreaTour((currentTour) => ({
      ...currentTour,
      scenes: {
        ...(currentTour.scenes || {}),
        [placingMapSceneId]: {
          ...currentTour.scenes[placingMapSceneId],
          mapPoint: point,
        },
      },
    }));

    setPlacingMapSceneId(null);
    showSavedNotice("Map point saved");
  }

  function startPickArrow() {
    if (!connectionTargetId) {
      alert("Choose a next location first.");
      return;
    }
    setIsPickingArrow(true);
  }

  function handlePanoramaClick(event) {
    if (!isPickingArrow || !safeSelectedSceneId || !connectionTargetId) return;
    const point = pointFromClick(event);
    const targetScene = scenes[connectionTargetId];

    updateAreaTour((currentTour) => ({
      ...currentTour,
      connections: [
        ...(currentTour.connections || []),
        createConnection({
          from: safeSelectedSceneId,
          to: connectionTargetId,
          label: targetScene?.label || targetScene?.title || "Next Location",
          hotspot: {
            x: point.x,
            y: point.y,
            icon: "→",
          },
        }),
      ],
    }));

    setIsPickingArrow(false);
    setConnectionTargetId("");
    showSavedNotice("Next-location arrow saved");
  }

  function deleteConnection(connectionId) {
    updateAreaTour((currentTour) => ({
      ...currentTour,
      connections: (currentTour.connections || []).filter((connection) => connection.id !== connectionId),
    }));
    showSavedNotice("Connection deleted");
  }

  return (
    <div className="admin-split-page config-page">
      <header className="admin-topbar">
        <div>
          <p className="admin-eyebrow">Area Configuration</p>
          <h1>{area.name}</h1>
          <p>Add panorama locations, set the start location, and place next-location arrows on the 360 image.</p>
        </div>

        <div className="admin-topbar-actions">
          {saveNotice && <span className="admin-save-pill">{saveNotice}</span>}
          <button onClick={() => navigate("/admin")}>← Back to Area Mapping</button>
          <button onClick={() => navigate(`/viewer/${siteId}/${areaId}`)}>Open Viewer</button>
        </div>
      </header>

      <main className="config-page-layout">
        <aside className="config-left-panel">
          <label className="upload-location-card">
            <input type="file" accept="image/*" onChange={uploadLocation} />
            <strong>+ Upload 360 Image</strong>
            <span>This creates a new location inside this mapped area.</span>
          </label>

          <div className="location-list-title">Locations</div>
          <div className="location-list">
            {sceneList.length === 0 && (
              <div className="empty-small">No locations yet. Upload your first 360 image.</div>
            )}

            {sceneList.map((scene) => (
              <button
                key={scene.id}
                className={`location-card ${safeSelectedSceneId === scene.id ? "active" : ""}`}
                onClick={() => selectScene(scene.id)}
              >
                <span>{scene.title || scene.label || scene.id}</span>
                {tour.settings?.firstScene === scene.id && <strong>START</strong>}
              </button>
            ))}
          </div>
        </aside>

        <section className="config-main-panel">
          {!selectedScene && (
            <div className="friendly-empty-state">
              <h2>No location selected</h2>
              <p>Upload a 360 image to create the first location for this area.</p>
            </div>
          )}

          {selectedScene && (
            <>
              <section className="location-editor-card">
                <div className="location-editor-head">
                  <div>
                    <p className="admin-eyebrow">Selected Location</p>
                    <h2>{selectedScene.title || "Untitled Location"}</h2>
                  </div>
                  {tour.settings?.firstScene === selectedScene.id && <span className="start-badge">START LOCATION</span>}
                </div>

                <div className="location-form-grid friendly">
                  <div>
                    <label className="admin-field-label">Title</label>
                    <input
                      value={sceneDraft.title}
                      onChange={(event) => setSceneDraft((prev) => ({ ...prev, title: event.target.value }))}
                      placeholder="Example: Product Entrance"
                    />
                  </div>
                  <div>
                    <label className="admin-field-label">Label</label>
                    <input
                      value={sceneDraft.label}
                      onChange={(event) => setSceneDraft((prev) => ({ ...prev, label: event.target.value }))}
                      placeholder="Example: Entrance"
                    />
                  </div>
                </div>

                <div className="location-toolbar">
                  <button className="primary" onClick={saveLocation}>Save Location</button>
                  <button onClick={setAsStart}>Set as Start</button>
                  <button onClick={startPlaceOnFactoryMap}>Set Map Point</button>
                  <button className="danger-soft" onClick={deleteLocation}>Delete</button>
                </div>
              </section>

              <section className="config-two-column">
                <div className="factory-map-point-card">
                  <div className="card-title-row">
                    <div>
                      <h3>Factory Map Point</h3>
                      <p>{placingMapSceneId ? "Click the factory map to place this location." : "Mark where this panorama belongs on the parent map."}</p>
                    </div>
                    {selectedScene.mapPoint && <span>x {selectedScene.mapPoint.x}, y {selectedScene.mapPoint.y}</span>}
                  </div>

                  <div className={`mini-map-canvas ${placingMapSceneId ? "placing" : ""}`} onClick={handleFactoryMapClick}>
                    {site.mapImage && <img src={site.mapImage} alt={site.name} />}
                    <svg viewBox="0 0 100 100" preserveAspectRatio="none">
                      <polygon points={area.points} className="mini-area-shape" />
                      {sceneList.map((scene) => scene.mapPoint && (
                        <circle
                          key={scene.id}
                          cx={scene.mapPoint.x}
                          cy={scene.mapPoint.y}
                          r={scene.id === safeSelectedSceneId ? "1.8" : "1.2"}
                          className={scene.id === safeSelectedSceneId ? "mini-scene-point active" : "mini-scene-point"}
                        />
                      ))}
                    </svg>
                  </div>
                </div>

                <div className="next-location-card friendly-next-card">
                  <h3>Next Locations</h3>
                  <p>Pick a target, then click the 360 image where the arrow should appear.</p>

                  {sceneList.length < 2 ? (
                    <div className="friendly-warning">Add another location first before creating a next-location arrow.</div>
                  ) : (
                    <div className="next-location-controls">
                      <select value={connectionTargetId} onChange={(event) => setConnectionTargetId(event.target.value)}>
                        <option value="">Choose next location</option>
                        {sceneList
                          .filter((scene) => scene.id !== safeSelectedSceneId)
                          .map((scene) => (
                            <option key={scene.id} value={scene.id}>{scene.title || scene.label}</option>
                          ))}
                      </select>
                      <button className={isPickingArrow ? "active-map-btn" : ""} onClick={startPickArrow}>
                        {isPickingArrow ? "Click the 360 Image" : "Pick Arrow Position"}
                      </button>
                    </div>
                  )}

                  <div className="connection-list">
                    {outgoingConnections.map((connection) => (
                      <div key={connection.id} className="connection-item">
                        <span>→ {scenes[connection.to]?.title || connection.to}</span>
                        <button className="danger-soft" onClick={() => deleteConnection(connection.id)}>Delete</button>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              <section className="panorama-editor-card">
                <div className="card-title-row">
                  <div>
                    <h3>360 Image</h3>
                    <p>{isPickingArrow ? "Click the image to place the next-location arrow." : "Next-location arrows appear on this image."}</p>
                  </div>
                </div>

                <div className={`panorama-click-canvas ${isPickingArrow ? "picking" : ""}`} onClick={handlePanoramaClick}>
                  {selectedScene.panorama && <img src={selectedScene.panorama} alt={selectedScene.title} />}

                  {outgoingConnections.map((connection) => (
                    connection.hotspot?.x != null && connection.hotspot?.y != null ? (
                      <div
                        key={connection.id}
                        className="panorama-arrow"
                        style={{ left: `${connection.hotspot.x}%`, top: `${connection.hotspot.y}%` }}
                        title={connection.label}
                      >
                        →
                      </div>
                    ) : null
                  ))}

                  {isPickingArrow && <div className="panorama-click-hint">Click where the arrow should be</div>}
                </div>
              </section>
            </>
          )}
        </section>
      </main>
    </div>
  );
}

export default AdminAreaConfigPage;
