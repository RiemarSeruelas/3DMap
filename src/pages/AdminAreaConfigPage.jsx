import { useMemo, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import {
  createUniqueId,
  getEffectiveTour,
  getMergedArea,
  getMergedSite,
  getPercentPoint,
  updateAreaTour,
} from "../utils/streetViewAdminStorage";

function createEmptyScene(title, existingIds) {
  const id = createUniqueId(title || "location", existingIds);

  return {
    id,
    title: title || "Untitled Location",
    label: title || "Location",
    panorama: "",
    mapPoint: null,
    view: {
      initialYaw: 0,
      initialPitch: 0,
      initialHfov: 110,
    },
  };
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function AdminAreaConfigPage() {
  const navigate = useNavigate();
  const { siteId, areaId } = useParams();

  const site = getMergedSite(siteId);
  const area = getMergedArea(siteId, areaId);

  const [tour, setTour] = useState(() => getEffectiveTour(siteId, areaId));
  const [selectedSceneId, setSelectedSceneId] = useState(() => {
    const initialTour = getEffectiveTour(siteId, areaId);
    return initialTour.settings.firstScene || Object.keys(initialTour.scenes || {})[0] || null;
  });
  const [placingMapPointFor, setPlacingMapPointFor] = useState(null);
  const [pickingConnectionFor, setPickingConnectionFor] = useState(null);
  const [connectionTargetId, setConnectionTargetId] = useState("");
  const [saveMessage, setSaveMessage] = useState("");

  const panoramaBoxRef = useRef(null);
  const uploadInputRef = useRef(null);
  const connectedUploadInputRef = useRef(null);

  const scenes = useMemo(() => Object.values(tour.scenes || {}), [tour]);
  const selectedScene = selectedSceneId ? tour.scenes[selectedSceneId] : null;
  const selectedConnections = selectedSceneId
    ? tour.connections.filter((connection) => connection.from === selectedSceneId)
    : [];

  if (!site) return <Navigate to="/admin" replace />;
  if (!area) return <Navigate to="/admin" replace />;

  function showSaved(text = "Saved") {
    setSaveMessage(text);
    setTimeout(() => setSaveMessage(""), 1500);
  }

  function saveTour(nextTour, message = "Saved") {
    const cleanTour = {
      ...nextTour,
      settings: {
        firstScene: nextTour.settings?.firstScene || Object.keys(nextTour.scenes || {})[0] || null,
        defaultHfov: nextTour.settings?.defaultHfov || 110,
        mobileHfov: nextTour.settings?.mobileHfov || 90,
        ...(nextTour.settings || {}),
      },
      scenes: nextTour.scenes || {},
      connections: Array.isArray(nextTour.connections) ? nextTour.connections : [],
    };

    setTour(cleanTour);
    updateAreaTour(siteId, areaId, cleanTour);
    showSaved(message);
  }

  async function addLocationFile(file, options = {}) {
    if (!file) return;

    const { selectNew = true } = options;
    const previousSelectedSceneId = selectedSceneId;
    const existingIds = Object.keys(tour.scenes || {});
    const cleanTitle = file.name.replace(/\.[^/.]+$/, "");
    const newScene = createEmptyScene(cleanTitle, existingIds);
    const image = await fileToBase64(file);

    const sceneWithImage = {
      ...newScene,
      panorama: image,
    };

    const nextTour = {
      ...tour,
      settings: {
        ...tour.settings,
        firstScene: tour.settings.firstScene || sceneWithImage.id,
      },
      scenes: {
        ...tour.scenes,
        [sceneWithImage.id]: sceneWithImage,
      },
      connections: tour.connections || [],
    };

    setSelectedSceneId(selectNew ? sceneWithImage.id : previousSelectedSceneId || sceneWithImage.id);
    saveTour(nextTour, "Location added");
  }

  async function addLocationFromFile(event) {
    const file = event.target.files?.[0];
    await addLocationFile(file, { selectNew: true });
    event.target.value = "";
  }

  async function addConnectedLocationFromFile(event) {
    const file = event.target.files?.[0];
    await addLocationFile(file, { selectNew: false });
    event.target.value = "";
  }

  function updateSelectedScene(field, value) {
    if (!selectedScene) return;

    const nextTour = {
      ...tour,
      scenes: {
        ...tour.scenes,
        [selectedScene.id]: {
          ...selectedScene,
          [field]: value,
        },
      },
    };

    setTour(nextTour);
  }

  function saveSelectedLocation() {
    if (!selectedScene) return;

    const nextTitle = selectedScene.title?.trim() || "Untitled Location";
    const nextLabel = selectedScene.label?.trim() || nextTitle;

    const nextTour = {
      ...tour,
      scenes: {
        ...tour.scenes,
        [selectedScene.id]: {
          ...selectedScene,
          title: nextTitle,
          label: nextLabel,
        },
      },
    };

    saveTour(nextTour, "Location saved");
  }

  function setAsStart(sceneId) {
    saveTour(
      {
        ...tour,
        settings: {
          ...tour.settings,
          firstScene: sceneId,
        },
      },
      "Start saved"
    );
  }

  function deleteScene(sceneId) {
    const ok = window.confirm("Delete this location?");
    if (!ok) return;

    const nextScenes = { ...tour.scenes };
    delete nextScenes[sceneId];

    const nextConnections = tour.connections.filter(
      (connection) => connection.from !== sceneId && connection.to !== sceneId
    );

    const nextFirstScene =
      tour.settings.firstScene === sceneId
        ? Object.keys(nextScenes)[0] || null
        : tour.settings.firstScene;

    const nextTour = {
      ...tour,
      settings: {
        ...tour.settings,
        firstScene: nextFirstScene,
      },
      scenes: nextScenes,
      connections: nextConnections,
    };

    setSelectedSceneId(nextFirstScene);
    saveTour(nextTour, "Location deleted");
  }

  function handleMiniMapClick(event) {
    if (!placingMapPointFor) return;

    const point = getPercentPoint(event, event.currentTarget);
    const scene = tour.scenes[placingMapPointFor];
    if (!scene) return;

    const nextTour = {
      ...tour,
      scenes: {
        ...tour.scenes,
        [placingMapPointFor]: {
          ...scene,
          mapPoint: point,
          minimap: point,
        },
      },
    };

    setPlacingMapPointFor(null);
    saveTour(nextTour, "Map point saved");
  }

  function beginPickConnectionTo(targetSceneId) {
    if (!selectedScene || !targetSceneId) {
      alert("Choose a location first.");
      return;
    }

    setPickingConnectionFor({ from: selectedScene.id, to: targetSceneId });
  }

  function handlePanoramaClick(event) {
    if (!pickingConnectionFor || !panoramaBoxRef.current) return;

    const point = getPercentPoint(event, panoramaBoxRef.current);
    const fromScene = tour.scenes[pickingConnectionFor.from];
    const toScene = tour.scenes[pickingConnectionFor.to];
    if (!fromScene || !toScene) return;

    const connectionId = createUniqueId(
      `${pickingConnectionFor.from}-to-${pickingConnectionFor.to}`,
      tour.connections.map((connection) => connection.id)
    );

    const nextConnection = {
      id: connectionId,
      from: pickingConnectionFor.from,
      to: pickingConnectionFor.to,
      label: `Go to ${toScene.label || toScene.title}`,
      type: "move",
      hotspot: {
        x: point.x,
        y: point.y,
        icon: "↑",
        yaw: 0,
        pitch: -8,
      },
    };

    const existingIndex = tour.connections.findIndex(
      (connection) =>
        connection.from === pickingConnectionFor.from &&
        connection.to === pickingConnectionFor.to
    );

    const nextConnections =
      existingIndex >= 0
        ? tour.connections.map((connection, index) =>
            index === existingIndex
              ? {
                  ...connection,
                  label: nextConnection.label,
                  hotspot: nextConnection.hotspot,
                }
              : connection
          )
        : [...tour.connections, nextConnection];

    const nextTour = {
      ...tour,
      connections: nextConnections,
    };

    setPickingConnectionFor(null);
    setConnectionTargetId("");
    saveTour(nextTour, existingIndex >= 0 ? "Arrow position updated" : "Next location saved");
  }

  function deleteConnection(connectionId) {
    const nextTour = {
      ...tour,
      connections: tour.connections.filter((connection) => connection.id !== connectionId),
    };

    saveTour(nextTour, "Connection deleted");
  }

  function logout() {
    sessionStorage.removeItem("streetViewAuth");
    sessionStorage.removeItem("streetViewRole");
    navigate("/login", { replace: true });
  }

  const otherScenes = selectedScene
    ? scenes.filter((scene) => scene.id !== selectedScene.id)
    : [];

  const currentMapPoint = selectedScene?.mapPoint || selectedScene?.minimap || null;

  return (
    <div className="admin-config-page">
      <aside className="admin-config-sidebar">
        <div className="admin-config-brand">
          <div className="admin-config-logo">360</div>
          <div>
            <span>Street View Admin</span>
            <strong>{area.name}</strong>
          </div>
        </div>

        {saveMessage && <div className="admin-config-save-pill">✓ {saveMessage}</div>}

        <div className="admin-config-nav-group">
          <button onClick={() => navigate("/admin")}>Open Map</button>
          <button onClick={() => navigate(`/viewer/${siteId}/${areaId}`)}>Open Viewer</button>
          <button className="danger" onClick={logout}>Logout</button>
        </div>

        <div className="admin-config-section">
          <div className="admin-config-section-title">Location Upload</div>
          <label className="admin-config-upload-btn">
            + Upload 360 Image
            <input ref={uploadInputRef} type="file" accept="image/*" onChange={addLocationFromFile} hidden />
          </label>
          <input ref={connectedUploadInputRef} type="file" accept="image/*" onChange={addConnectedLocationFromFile} hidden />
        </div>

        <div className="admin-config-section grow">
          <div className="admin-config-section-title">Locations</div>
          <div className="admin-config-location-list">
            {scenes.length === 0 && <p>No locations yet. Upload a 360 image first.</p>}
            {scenes.map((scene) => (
              <button
                key={scene.id}
                className={`admin-config-location-item ${selectedSceneId === scene.id ? "active" : ""}`}
                onClick={() => setSelectedSceneId(scene.id)}
              >
                <span>{scene.title || "Untitled"}</span>
                {tour.settings.firstScene === scene.id && <small>START</small>}
              </button>
            ))}
          </div>
        </div>

        <div className="admin-config-section">
          <div className="admin-config-section-title">Selected Location</div>
          <label className="admin-config-field">
            <span>Title</span>
            <input
              disabled={!selectedScene}
              value={selectedScene?.title || ""}
              onChange={(event) => updateSelectedScene("title", event.target.value)}
              placeholder="Location title"
            />
          </label>

          <label className="admin-config-field">
            <span>Label</span>
            <input
              disabled={!selectedScene}
              value={selectedScene?.label || ""}
              onChange={(event) => updateSelectedScene("label", event.target.value)}
              placeholder="Map label"
            />
          </label>

          <div className="admin-config-action-grid">
            <button disabled={!selectedScene} onClick={saveSelectedLocation}>Save</button>
            <button disabled={!selectedScene} onClick={() => selectedScene && setAsStart(selectedScene.id)}>Set Start</button>
            <button disabled={!selectedScene} onClick={() => selectedScene && setPlacingMapPointFor(selectedScene.id)}>Set Map</button>
            <button disabled={!selectedScene} className="danger" onClick={() => selectedScene && deleteScene(selectedScene.id)}>Delete</button>
          </div>
        </div>

      </aside>

      <main className="admin-config-main">
        <section className="admin-config-connected-card">
          <div className="admin-config-card-title">
            <div>
              <span>Connected Locations</span>
              <strong>Click a location card, then click the 360 image to place or adjust its arrow.</strong>
            </div>
          </div>

          <div className="admin-config-connected-row">
            <button
              type="button"
              className="admin-config-add-link-card"
              onClick={() => connectedUploadInputRef.current?.click()}
            >
              <b>+</b>
              <span>Add</span>
            </button>

            {otherScenes.length === 0 && (
              <div className="admin-config-empty-link">Upload another location to connect.</div>
            )}

            {otherScenes.map((scene) => {
              const existingConnection = selectedConnections.find(
                (connection) => connection.to === scene.id
              );

              return (
                <div
                  key={scene.id}
                  className={`admin-config-link-card ${existingConnection ? "is-connected" : ""}`}
                  onClick={() => beginPickConnectionTo(scene.id)}
                  title="Click to place or adjust arrow on the 360 image"
                >
                  {scene.panorama ? <img src={scene.panorama} alt={scene.title} /> : <span>360</span>}
                  <strong>{scene.label || scene.title}</strong>
                  {existingConnection && <em>CONNECTED</em>}
                  {existingConnection && (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        deleteConnection(existingConnection.id);
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="admin-config-stage-card">
          <div className="admin-config-card-title">
            <div>
              <span>Location Placement</span>
              <strong>{pickingConnectionFor ? "Click the 360 image to place the next-location arrow" : placingMapPointFor ? "Click the map preview to place the location pin" : "Preview and configure this location"}</strong>
            </div>
          </div>

          <div className="admin-config-stage-layout">
            <div
              ref={panoramaBoxRef}
              className={`admin-config-panorama ${pickingConnectionFor ? "is-picking" : ""}`}
              onClick={handlePanoramaClick}
            >
              {selectedScene?.panorama ? (
                <>
                  <img src={selectedScene.panorama} alt={selectedScene.title} />
                  {selectedConnections.map((connection) => (
                    <div
                      key={connection.id}
                      className="admin-config-next-arrow"
                      style={{
                        left: `${connection.hotspot?.x ?? 50}%`,
                        top: `${connection.hotspot?.y ?? 50}%`,
                      }}
                    >
                      ↑
                    </div>
                  ))}
                </>
              ) : (
                <div className="admin-config-empty-stage">Upload/select a 360 image</div>
              )}
            </div>

            <div
              className={`admin-config-map-preview ${placingMapPointFor ? "is-placing" : ""}`}
              onClick={handleMiniMapClick}
            >
              <img src={site.mapImage} alt={site.name} />
              <svg viewBox="0 0 100 100" preserveAspectRatio="none">
                <polygon points={area.points} className="admin-config-parent-area" />
                {scenes.map((scene) => {
                  const point = scene.mapPoint || scene.minimap;
                  if (!point) return null;
                  return (
                    <g key={scene.id}>
                      <circle cx={point.x} cy={point.y} r="1.65" className="admin-config-map-dot" />
                      <text x={point.x + 1.8} y={point.y} className="admin-config-map-label">
                        {scene.label || scene.title}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>
        </section>
      </main>

      {placingMapPointFor && (
        <div className="admin-map-placement-modal-layer">
          <div className="admin-map-placement-modal">
            <div className="admin-map-placement-header">
              <div>
                <span>Map Location Pin</span>
                <strong>Click the area map where this 360 location belongs.</strong>
              </div>
              <button type="button" onClick={() => setPlacingMapPointFor(null)}>Cancel</button>
            </div>

            <div className="admin-map-placement-canvas" onClick={handleMiniMapClick}>
              <img src={site.mapImage} alt={site.name} />
              <svg viewBox="0 0 100 100" preserveAspectRatio="none">
                <polygon points={area.points} className="admin-config-parent-area" />
                {scenes.map((scene) => {
                  const point = scene.mapPoint || scene.minimap;
                  if (!point) return null;
                  return (
                    <g key={scene.id}>
                      <circle cx={point.x} cy={point.y} r="1.65" className="admin-config-map-dot" />
                      <text x={point.x + 1.8} y={point.y} className="admin-config-map-label">
                        {scene.label || scene.title}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminAreaConfigPage;
