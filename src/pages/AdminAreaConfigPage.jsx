import { useEffect, useMemo, useRef, useState } from "react";
import "pannellum/build/pannellum.css";
import "pannellum";
import "../styles/admin.css";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import {
  createUniqueId,
  getEffectiveTour,
  getMergedArea,
  getMergedSite,
  getPercentPoint,
  updateAreaTour,
  uploadAdminImage,
} from "../utils/streetViewAdminStorage";

function normalizeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function labelForScene(scene, fallback = "Location") {
  return scene?.label || scene?.title || scene?.name || fallback;
}

function hotspotToPannellumPoint(hotspot = {}) {
  const hasYawPitch = Number.isFinite(Number(hotspot.yaw)) && Number.isFinite(Number(hotspot.pitch));
  const hasXY = Number.isFinite(Number(hotspot.x)) && Number.isFinite(Number(hotspot.y));

  if (hotspot.coordinateMode === "pannellum" && hasYawPitch) {
    return {
      yaw: normalizeNumber(hotspot.yaw, 0),
      pitch: clamp(normalizeNumber(hotspot.pitch, -8), -85, 85),
    };
  }

  if (hasYawPitch && !hasXY) {
    return {
      yaw: normalizeNumber(hotspot.yaw, 0),
      pitch: clamp(normalizeNumber(hotspot.pitch, -8), -85, 85),
    };
  }

  if (hasXY) {
    const x = normalizeNumber(hotspot.x, 50);
    const y = normalizeNumber(hotspot.y, 50);
    return {
      yaw: (x / 100) * 360 - 180,
      pitch: clamp(90 - (y / 100) * 180, -85, 85),
    };
  }

  return { yaw: 0, pitch: -8 };
}

function pannellumPointToPercent({ yaw, pitch }) {
  return {
    x: Number((((normalizeNumber(yaw, 0) + 180) / 360) * 100).toFixed(2)),
    y: Number((((90 - clamp(normalizeNumber(pitch, 0), -85, 85)) / 180) * 100).toFixed(2)),
  };
}

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
  const placementViewerRef = useRef(null);
  const placementPannellumInstanceRef = useRef(null);
  const connectedUploadInputRef = useRef(null);

  const scenes = useMemo(() => Object.values(tour.scenes || {}), [tour]);
  const selectedScene = selectedSceneId ? tour.scenes[selectedSceneId] : null;
  const selectedConnections = selectedSceneId
    ? tour.connections.filter((connection) => connection.from === selectedSceneId)
    : [];

  const selectedConnectionsKey = useMemo(
    () => JSON.stringify(
      selectedConnections.map((connection) => ({
        id: connection.id,
        from: connection.from,
        to: connection.to,
        yaw: connection.hotspot?.yaw,
        pitch: connection.hotspot?.pitch,
        x: connection.hotspot?.x,
        y: connection.hotspot?.y,
      }))
    ),
    [selectedConnections]
  );

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
    const image = await uploadAdminImage(file, "panos");

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
    event.preventDefault();
    event.stopPropagation();

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

    setPlacingMapPointFor(null);
    setPickingConnectionFor({ from: selectedScene.id, to: targetSceneId });
  }

  function handlePanoramaClick(event) {
    event.preventDefault();
    event.stopPropagation();

    if (!pickingConnectionFor) return;

    const fromScene = tour.scenes[pickingConnectionFor.from];
    const toScene = tour.scenes[pickingConnectionFor.to];
    if (!fromScene || !toScene) return;

    const viewer = placementPannellumInstanceRef.current;
    let yaw = 0;
    let pitch = -8;

    if (viewer?.mouseEventToCoords) {
      const coords = viewer.mouseEventToCoords(event);
      // Pannellum returns [pitch, yaw].
      pitch = clamp(normalizeNumber(coords?.[0], -8), -85, 85);
      yaw = normalizeNumber(coords?.[1], 0);
    } else if (panoramaBoxRef.current) {
      const point = getPercentPoint(event, panoramaBoxRef.current);
      yaw = (point.x / 100) * 360 - 180;
      pitch = clamp(90 - (point.y / 100) * 180, -85, 85);
    }

    const percentPoint = pannellumPointToPercent({ yaw, pitch });
    const connectionId = `${pickingConnectionFor.from}-to-${pickingConnectionFor.to}`;

    const nextConnection = {
      id: connectionId,
      from: pickingConnectionFor.from,
      to: pickingConnectionFor.to,
      label: `Go to ${toScene.label || toScene.title}`,
      type: "move",
      hotspot: {
        coordinateMode: "pannellum",
        yaw: Number(yaw.toFixed(2)),
        pitch: Number(pitch.toFixed(2)),
        x: percentPoint.x,
        y: percentPoint.y,
        icon: "↑",
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

  useEffect(() => {
    if (!placementViewerRef.current || !selectedScene?.panorama) return;

    const pannellumGlobal = window.pannellum;
    if (!pannellumGlobal?.viewer) return;

    if (placementPannellumInstanceRef.current) {
      try {
        placementPannellumInstanceRef.current.destroy();
      } catch {
        // ignore cleanup errors
      }
      placementPannellumInstanceRef.current = null;
    }

    // Hard-clear the old Pannellum DOM/hotspots. This prevents the first location's
    // arrow from getting visually stuck when switching locations or re-placing arrows.
    placementViewerRef.current.innerHTML = "";

    const viewer = pannellumGlobal.viewer(placementViewerRef.current, {
      type: "equirectangular",
      panorama: selectedScene.panorama,
      autoLoad: true,
      showControls: true,
      showFullscreenCtrl: false,
      compass: false,
      draggable: true,
      mouseZoom: true,
      keyboardZoom: true,
      hfov: normalizeNumber(selectedScene?.view?.initialHfov, 110),
      yaw: normalizeNumber(selectedScene?.view?.initialYaw, 0),
      pitch: normalizeNumber(selectedScene?.view?.initialPitch, 0),
      hotSpots: selectedConnections
        .filter((connection) => tour.scenes?.[connection.to])
        .map((connection) => {
          const point = hotspotToPannellumPoint(connection.hotspot || {});
          const targetScene = tour.scenes?.[connection.to];

          return {
            id: connection.id || `${connection.from}-to-${connection.to}`,
            pitch: point.pitch,
            yaw: point.yaw,
            type: "custom",
            cssClass: "pnlm-admin-arrow-hotspot",
            createTooltipFunc: (hotSpotDiv) => {
              hotSpotDiv.innerHTML = `
                <button class="admin-pannellum-arrow-dot" type="button" title="${labelForScene(targetScene, connection.to)}">
                  <span>➜</span>
                </button>
              `;
            },
          };
        }),
    });

    placementPannellumInstanceRef.current = viewer;

    return () => {
      if (placementPannellumInstanceRef.current) {
        try {
          placementPannellumInstanceRef.current.destroy();
        } catch {
          // ignore cleanup errors
        }
        placementPannellumInstanceRef.current = null;
      }

      if (placementViewerRef.current) {
        placementViewerRef.current.innerHTML = "";
      }
    };
  }, [selectedSceneId, selectedScene?.panorama, selectedConnectionsKey, tour.scenes]);

  useEffect(() => {
    const element = placementViewerRef.current;
    if (!element) return;

    function handlePlacementClick(event) {
      if (!pickingConnectionFor) return;
      handlePanoramaClick(event);
    }

    element.addEventListener("click", handlePlacementClick, true);
    return () => element.removeEventListener("click", handlePlacementClick, true);
  }, [pickingConnectionFor, tour, selectedSceneId]);

  return (
    <div className="admin-config-page">
      <aside className="admin-config-sidebar">
        <div className="admin-config-sidebar-top">
          <div className="admin-config-brand">
            <div className="admin-config-logo">360</div>
            <div>
              <span>Street View Admin</span>
              <strong>{area.name}</strong>
            </div>
          </div>

          {saveMessage && <div className="admin-config-save-pill">✓ {saveMessage}</div>}
        </div>

        <input ref={connectedUploadInputRef} type="file" accept="image/*" onChange={addConnectedLocationFromFile} hidden />

        <div className="admin-config-section grow">
          <div className="admin-config-section-title">Locations</div>
          <div className="admin-config-location-list">
            {scenes.length === 0 && <p>No locations yet. Upload a 360 image first.</p>}
            {scenes.map((scene) => (
              <button
                key={scene.id}
                className={`admin-config-location-item ${selectedSceneId === scene.id ? "active" : ""}`}
                onClick={() => {
                  setPickingConnectionFor(null);
                  setPlacingMapPointFor(null);
                  setSelectedSceneId(scene.id);
                }}
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
            <button
              disabled={!selectedScene}
              onClick={() => {
                if (!selectedScene) return;
                setPickingConnectionFor(null);
                setPlacingMapPointFor(selectedScene.id);
              }}
            >
              Mark Mapping Area
            </button>
            <button disabled={!selectedScene} className="danger" onClick={() => selectedScene && deleteScene(selectedScene.id)}>Delete</button>
          </div>
        </div>

        <div className="admin-config-bottom-nav">
          <button onClick={() => navigate("/admin")}>Open Map</button>
          <button onClick={() => navigate(`/viewer/${siteId}/${areaId}`)}>Open Viewer</button>
          <button className="danger" onClick={logout}>Logout</button>
        </div>
      </aside>

      <main className="admin-config-main">
        <section className="admin-config-connected-card">
          <div className="admin-config-card-title">
            <div>
              <span>Connected Locations</span>
              <strong>Click a location card to open it. Use the arrow button to place the next-location arrow.</strong>
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
                  onClick={() => {
                    setPickingConnectionFor(null);
                    setPlacingMapPointFor(null);
                    setSelectedSceneId(scene.id);
                  }}
                  title="Click to open this location"
                >
                  {scene.panorama ? <img src={scene.panorama} alt={scene.title} /> : <span>360</span>}
                  <strong>{scene.label || scene.title}</strong>
                  {existingConnection && <em>CONNECTED</em>}

                  <button
                    type="button"
                    className="admin-config-mark-arrow-btn"
                    onClick={(event) => {
                      event.stopPropagation();
                      beginPickConnectionTo(scene.id);
                    }}
                  >
                    ↗
                  </button>

                  {existingConnection && (
                    <button
                      type="button"
                      className="admin-config-delete-link-btn"
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
              {(pickingConnectionFor || placingMapPointFor) && (
                <strong>{pickingConnectionFor ? "Click the 360 image to place the next-location arrow" : "Click the map preview to place the location pin"}</strong>
              )}
            </div>
          </div>

          <div className="admin-config-stage-layout">
            <div
              ref={panoramaBoxRef}
              className={`admin-config-panorama admin-config-panorama-360 ${pickingConnectionFor ? "is-picking" : ""}`}
            >
              {selectedScene?.panorama ? (
                <div ref={placementViewerRef} className="admin-config-pannellum-placement" />
              ) : (
                <div className="admin-config-empty-stage">Upload/select a 360 image</div>
              )}
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
