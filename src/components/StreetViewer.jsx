import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import "pannellum/build/pannellum.css";
import "pannellum";
import "../styles/admin.css";

const MAP_WORLD_WIDTH = 520;
const MAP_WORLD_HEIGHT = 292.5;
const MAP_WINDOW_WIDTH = 310;
const MAP_WINDOW_HEIGHT = 175;

function safeScenes(mapData) {
  return mapData?.scenes || {};
}

function labelForScene(scene, sceneId) {
  return scene?.title || scene?.name || scene?.label || sceneId || "Location";
}

function getAlphabeticalSceneList(mapData) {
  return Object.values(safeScenes(mapData))
    .filter(Boolean)
    .sort((a, b) =>
      labelForScene(a, a.id).localeCompare(labelForScene(b, b.id), undefined, {
        numeric: true,
        sensitivity: "base",
      })
    );
}

function getFirstSceneId(mapData) {
  const alphabeticalScenes = getAlphabeticalSceneList(mapData);
  return alphabeticalScenes[0]?.id || mapData?.settings?.firstScene || mapData?.firstScene || null;
}

function normalizeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeYaw(yaw) {
  let nextYaw = normalizeNumber(yaw, 0);
  while (nextYaw > 180) nextYaw -= 360;
  while (nextYaw < -180) nextYaw += 360;
  return Number(nextYaw.toFixed(2));
}

function bindLiveArrowRotation(button, hotspotYaw, getViewer) {
  if (!button) return () => {};

  let frameId = 0;
  let stopped = false;

  function tick() {
    if (stopped || !button.isConnected) {
      window.cancelAnimationFrame(frameId);
      return;
    }

    const viewer = getViewer?.();
    if (viewer?.getYaw) {
      const currentYaw = normalizeNumber(viewer.getYaw(), 0);
      const relativeYaw = normalizeYaw(normalizeNumber(hotspotYaw, 0) - currentYaw);
      button.style.setProperty("--floor-arrow-rotation", `${relativeYaw}deg`);
    }

    frameId = window.requestAnimationFrame(tick);
  }

  tick();

  return () => {
    stopped = true;
    window.cancelAnimationFrame(frameId);
  };
}


function getSaveAssetBase() {
  if (typeof window === "undefined") return "";

  const override = window.__STREETVIEW_SAVE_API_BASE__;
  if (typeof override === "string" && override.trim()) {
    return override.trim().replace(/\/$/, "");
  }

  // Same-origin mode: /uploads and /data are served through Vite on port 5055.
  return "";
}

function resolveAssetUrl(value) {
  if (!value) return "";
  if (typeof value !== "string") return value;

  const cleanValue = value.trim();
  if (!cleanValue) return "";

  if (
    cleanValue.startsWith("http://") ||
    cleanValue.startsWith("https://") ||
    cleanValue.startsWith("data:") ||
    cleanValue.startsWith("blob:")
  ) {
    return cleanValue;
  }

  if (cleanValue.startsWith("/uploads/") || cleanValue.startsWith("/data/") || cleanValue === "/streetview-data.json") {
    return `${getSaveAssetBase()}${cleanValue}`;
  }

  return cleanValue;
}

function getSceneNorthOffset(scene) {
  return normalizeYaw(
    scene?.view?.northOffset ??
      scene?.view?.yawOffset ??
      scene?.northOffset ??
      scene?.yawOffset ??
      0
  );
}

function toWorldYaw(sceneYaw, scene) {
  return normalizeYaw(normalizeNumber(sceneYaw, 0) + getSceneNorthOffset(scene));
}

function toSceneYaw(worldYaw, scene) {
  return normalizeYaw(normalizeNumber(worldYaw, 0) - getSceneNorthOffset(scene));
}



function xyToYawPitch(hotspot = {}) {
  const hasYawPitch = Number.isFinite(Number(hotspot.yaw)) && Number.isFinite(Number(hotspot.pitch));
  const hasXY = Number.isFinite(Number(hotspot.x)) && Number.isFinite(Number(hotspot.y));

  if (hasYawPitch) {
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

function getSceneConnections(mapData, sceneId) {
  const scenes = safeScenes(mapData);
  const currentScene = scenes[sceneId];

  const sceneHotspotConnections = (currentScene?.hotspots || [])
    .filter((hotspot) => hotspot?.targetSceneId)
    .map((hotspot) => ({
      id: hotspot.id || `${sceneId}-to-${hotspot.targetSceneId}`,
      from: sceneId,
      to: hotspot.targetSceneId,
      label: hotspot.text || hotspot.label,
      hotspot,
      source: "sceneHotspot",
    }));

  const hotspotTargets = new Set(sceneHotspotConnections.map((connection) => connection.to));

  const legacyConnections = (mapData?.connections || [])
    .filter((connection) => connection?.from === sceneId && connection?.to)
    .filter((connection) => !hotspotTargets.has(connection.to));

  const merged = [...sceneHotspotConnections, ...legacyConnections];
  const seen = new Set();

  return merged.filter((connection) => {
    const key = `${connection.from}-${connection.to}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getSceneMapPoint(scene) {
  return scene?.mapPoint || scene?.minimap || null;
}


function getMapImage(mapData, site, area) {
  return resolveAssetUrl(site?.mapImage || area?.mapImage || mapData?.mapImage || mapData?.siteMapImage || mapData?.areaMapImage || null);
}

function getMiniMapTransform(activePoint) {
  const x = normalizeNumber(activePoint?.x, 50);
  const y = normalizeNumber(activePoint?.y, 50);
  const translateX = MAP_WINDOW_WIDTH / 2 - (x / 100) * MAP_WORLD_WIDTH;
  const translateY = MAP_WINDOW_HEIGHT / 2 - (y / 100) * MAP_WORLD_HEIGHT;
  return `translate(${translateX}px, ${translateY}px)`;
}

function preloadImage(src) {
  return new Promise((resolve) => {
    const cleanSrc = resolveAssetUrl(src);
    if (!cleanSrc) return resolve(false);
    const image = new Image();
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
    image.src = cleanSrc;
  });
}

function getMachineAreaPoints(area = {}) {
  return Array.isArray(area.points) ? area.points.filter((point) => Number.isFinite(Number(point.pitch)) && Number.isFinite(Number(point.yaw))) : [];
}

function getMachineAreaCenter(area = {}) {
  const points = getMachineAreaPoints(area);
  if (!points.length) return { pitch: -8, yaw: 0 };
  return {
    pitch: points.reduce((sum, point) => sum + normalizeNumber(point.pitch, 0), 0) / points.length,
    yaw: points.reduce((sum, point) => sum + normalizeNumber(point.yaw, 0), 0) / points.length,
  };
}

function getMachineAreaSize(area = {}) {
  const points = getMachineAreaPoints(area);
  if (points.length < 2) return { width: 170, height: 120 };

  const yaws = points.map((point) => normalizeNumber(point.yaw, 0));
  const pitches = points.map((point) => normalizeNumber(point.pitch, 0));
  const yawSpan = Math.max(...yaws) - Math.min(...yaws);
  const pitchSpan = Math.max(...pitches) - Math.min(...pitches);

  return {
    width: Math.round(clamp(Math.abs(yawSpan) * 14, 120, 460)),
    height: Math.round(clamp(Math.abs(pitchSpan) * 18, 80, 360)),
  };
}

function getMachineAreaTitle(area = {}) {
  return area.machineName || area.name || "Machine Area";
}

function getMachineAreaPopupImage(area = {}) {
  return resolveAssetUrl(area?.image || "");
}

function getMachineAreaHoverImage(area = {}) {
  return resolveAssetUrl(area?.hoverImage || "");
}

function getMachineAreaPatternId(prefix, value) {
  const safeId = String(value || "machine-area").replace(/[^a-zA-Z0-9_-]/g, "-");
  return `${prefix}-${safeId}`;
}

function projectPanoPointToScreen(point, viewer, element) {
  if (!point || !viewer || !element) return null;

  const width = element.clientWidth || element.getBoundingClientRect().width || 1;
  const height = element.clientHeight || element.getBoundingClientRect().height || 1;
  const yaw = normalizeYaw(point.yaw);
  const pitch = clamp(normalizeNumber(point.pitch, 0), -89, 89);
  const viewYaw = normalizeYaw(viewer.getYaw?.() || 0);
  const viewPitch = clamp(normalizeNumber(viewer.getPitch?.(), 0), -89, 89);
  const hfov = clamp(normalizeNumber(viewer.getHfov?.(), 100), 35, 120);

  const deg = Math.PI / 180;
  const targetPitch = pitch * deg;
  const deltaYaw = normalizeYaw(yaw - viewYaw) * deg;
  const cameraPitch = viewPitch * deg;
  const hFovRad = hfov * deg;
  const aspect = width / Math.max(1, height);
  const vFovRad = 2 * Math.atan(Math.tan(hFovRad / 2) / aspect);

  const x = Math.cos(targetPitch) * Math.sin(deltaYaw);
  const y = Math.sin(targetPitch);
  const z = Math.cos(targetPitch) * Math.cos(deltaYaw);

  const relX = x;
  const relY = y * Math.cos(cameraPitch) - z * Math.sin(cameraPitch);
  const relZ = y * Math.sin(cameraPitch) + z * Math.cos(cameraPitch);

  if (relZ <= 0.02) return null;

  const screenX = width / 2 + (width / 2) * (relX / relZ) / Math.tan(hFovRad / 2);
  const screenY = height / 2 - (height / 2) * (relY / relZ) / Math.tan(vFovRad / 2);

  return { x: Number(screenX.toFixed(1)), y: Number(screenY.toFixed(1)) };
}

function getProjectedMachineAreas(machineAreas = [], viewer, element) {
  if (!viewer || !element) return [];

  return machineAreas
    .map((machineArea) => {
      const points = getMachineAreaPoints(machineArea);
      if (points.length < 3) return null;

      const screenPoints = points
        .map((point) => projectPanoPointToScreen(point, viewer, element))
        .filter(Boolean);

      if (screenPoints.length < 3) return null;

      const center = {
        x: screenPoints.reduce((sum, point) => sum + point.x, 0) / screenPoints.length,
        y: screenPoints.reduce((sum, point) => sum + point.y, 0) / screenPoints.length,
      };

      return {
        area: machineArea,
        id: machineArea.id || getMachineAreaTitle(machineArea),
        points: screenPoints,
        pointsAttr: screenPoints.map((point) => `${point.x},${point.y}`).join(' '),
        center,
      };
    })
    .filter(Boolean);
}

function StreetViewer({ mapData, site, area }) {
  const [searchParams] = useSearchParams();
  const shellRef = useRef(null);
  const viewerRef = useRef(null);
  const pannellumInstanceRef = useRef(null);
  const viewMemoryRef = useRef(null);

  const requestedSceneId = searchParams.get("scene");

  const scenes = useMemo(() => safeScenes(mapData), [mapData]);
  const sceneList = useMemo(() => getAlphabeticalSceneList(mapData), [mapData]);
  const requestedSceneExists = requestedSceneId && scenes[requestedSceneId];

  const [currentSceneId, setCurrentSceneId] = useState(() => requestedSceneId || getFirstSceneId(mapData));
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isSafetyModeOn, setIsSafetyModeOn] = useState(false);
  const [hoveredMachineArea, setHoveredMachineArea] = useState(null);
  const [projectedMachineAreas, setProjectedMachineAreas] = useState([]);
  const machineHoverCloseTimerRef = useRef(null);

  const currentScene = scenes[currentSceneId] || sceneList[0];
  const currentSceneIdResolved = currentScene?.id || currentSceneId;
  const currentPanorama = resolveAssetUrl(currentScene?.panorama);
  const mapImage = getMapImage(mapData, site, area);
  const machineAreas = useMemo(() => (Array.isArray(currentScene?.machineAreas) ? currentScene.machineAreas : []), [currentScene]);

  const sceneConnections = useMemo(
    () => getSceneConnections(mapData, currentSceneIdResolved),
    [mapData, currentSceneIdResolved]
  );

  function cancelMachineAreaClose() {
    window.clearTimeout(machineHoverCloseTimerRef.current);
    machineHoverCloseTimerRef.current = null;
  }

  function showMachineArea(machineArea) {
    cancelMachineAreaClose();
    setHoveredMachineArea(machineArea);
  }

  function scheduleMachineAreaClose() {
    cancelMachineAreaClose();
    machineHoverCloseTimerRef.current = window.setTimeout(() => {
      setHoveredMachineArea(null);
    }, 140);
  }


  function rememberCurrentView() {
    const viewer = pannellumInstanceRef.current;
    if (!viewer || !currentScene) return;

    const rawYaw = normalizeNumber(viewer.getYaw?.(), 0);
    const rawPitch = normalizeNumber(viewer.getPitch?.(), 0);
    const rawHfov = normalizeNumber(viewer.getHfov?.(), normalizeNumber(mapData?.settings?.defaultHfov, 110));

    viewMemoryRef.current = {
      worldYaw: toWorldYaw(rawYaw, currentScene),
      rawYaw,
      pitch: rawPitch,
      hfov: rawHfov,
      fromSceneId: currentSceneIdResolved,
      savedAt: Date.now(),
    };
  }

  async function switchScene(nextSceneId) {
    if (!scenes[nextSceneId] || nextSceneId === currentSceneIdResolved) return;

    rememberCurrentView();
    setHoveredMachineArea(null);
    setIsTransitioning(true);
    await preloadImage(scenes[nextSceneId]?.panorama);

    setCurrentSceneId(nextSceneId);
    window.setTimeout(() => setIsTransitioning(false), 360);
  }

  useEffect(() => {
    if (requestedSceneExists) {
      setCurrentSceneId(requestedSceneId);
      return;
    }

    const firstScene = getFirstSceneId(mapData);
    setCurrentSceneId((previous) => {
      if (previous && scenes[previous]) return previous;
      return firstScene;
    });
  }, [mapData, requestedSceneId, requestedSceneExists, scenes]);

  useEffect(() => {
    const nextImages = sceneConnections
      .map((connection) => scenes[connection.to]?.panorama)
      .filter(Boolean)
      .slice(0, 5);

    nextImages.forEach((src) => preloadImage(src));
  }, [sceneConnections, scenes]);

  useEffect(() => {
    return () => cancelMachineAreaClose();
  }, []);

  useEffect(() => {
    if (!isSafetyModeOn) {
      cancelMachineAreaClose();
      setHoveredMachineArea(null);
    }
  }, [isSafetyModeOn]);

  useEffect(() => {
    setProjectedMachineAreas([]);
    setHoveredMachineArea(null);

    let animationFrame = 0;
    let lastSignature = "__init__";

    function updateProjectedMachineAreas() {
      const viewer = pannellumInstanceRef.current;
      const element = viewerRef.current;

      if (!viewer || !element || !machineAreas.length) {
        if (lastSignature !== "__empty__") {
          lastSignature = "__empty__";
          setProjectedMachineAreas([]);
        }
        animationFrame = window.requestAnimationFrame(updateProjectedMachineAreas);
        return;
      }

      const nextProjected = getProjectedMachineAreas(machineAreas, viewer, element);
      const nextSignature = nextProjected
        .map((item) => `${item.id}:${item.pointsAttr}`)
        .join('|') || "__empty__";

      if (nextSignature !== lastSignature) {
        lastSignature = nextSignature;
        setProjectedMachineAreas(nextProjected);
      }

      animationFrame = window.requestAnimationFrame(updateProjectedMachineAreas);
    }

    updateProjectedMachineAreas();

    return () => {
      setProjectedMachineAreas([]);
      window.cancelAnimationFrame(animationFrame);
    };
  }, [machineAreas, currentSceneIdResolved]);

  useEffect(() => {
    if (!viewerRef.current || !currentPanorama) return;
    const pannellumGlobal = window.pannellum;
    if (!pannellumGlobal?.viewer) return;

    if (pannellumInstanceRef.current) {
      try {
        pannellumInstanceRef.current.destroy();
      } catch {}
      pannellumInstanceRef.current = null;
    }

    setHoveredMachineArea(null);

    const remembered = viewMemoryRef.current;

    const targetYaw = normalizeYaw(
      remembered
        ? toSceneYaw(remembered.worldYaw, currentScene)
        : normalizeNumber(currentScene?.view?.initialYaw, 0)
    );

    const targetPitch = clamp(
      normalizeNumber(
        remembered?.pitch,
        normalizeNumber(currentScene?.view?.initialPitch, 0)
      ),
      -85,
      85
    );

    const targetHfov = clamp(
      normalizeNumber(
        remembered?.hfov,
        normalizeNumber(currentScene?.view?.initialHfov, normalizeNumber(mapData?.settings?.defaultHfov, 110))
      ),
      35,
      120
    );

    function applyRememberedView(viewer) {
      if (!viewer) return;

      try {
        viewer.setYaw?.(targetYaw, false);
        viewer.setPitch?.(targetPitch, false);
        viewer.setHfov?.(targetHfov, false);
      } catch {}

      window.setTimeout(() => {
        try {
          viewer.setYaw?.(targetYaw, false);
          viewer.setPitch?.(targetPitch, false);
          viewer.setHfov?.(targetHfov, false);
        } catch {}
      }, 80);

      window.setTimeout(() => {
        try {
          viewer.setYaw?.(targetYaw, false);
          viewer.setPitch?.(targetPitch, false);
          viewer.setHfov?.(targetHfov, false);
        } catch {}
      }, 220);
    }

    const navHotSpots = sceneConnections
      .filter((connection) => scenes[connection.to])
      .map((connection) => {
        const targetScene = scenes[connection.to];
        const point = xyToYawPitch(connection.hotspot || {});

        return {
          id: connection.id || `${connection.from}-to-${connection.to}`,
          pitch: point.pitch,
          yaw: point.yaw,
          type: "custom",
          cssClass: "pnlm-street-arrow-hotspot",
          createTooltipFunc: (hotSpotDiv, args) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "street-arrow-only-button";
            button.title = args.title;
            button.setAttribute("aria-label", args.title);
            button.innerHTML = '<span class="street-floor-arrow-core" aria-hidden="true"></span>';
            bindLiveArrowRotation(button, args.hotspotYaw, () => pannellumInstanceRef.current);
            hotSpotDiv.appendChild(button);
          },
          createTooltipArgs: {
            title: connection.label || labelForScene(targetScene, connection.to),
            hotspotYaw: point.yaw,
          },
          clickHandlerFunc: () => switchScene(connection.to),
        };
      });

    const viewer = pannellumGlobal.viewer(viewerRef.current, {
      type: "equirectangular",
      panorama: currentPanorama,
      autoLoad: true,
      showControls: false,
      showFullscreenCtrl: false,
      compass: false,
      draggable: true,
      mouseZoom: true,
      keyboardZoom: true,
      hfov: targetHfov,
      yaw: targetYaw,
      pitch: targetPitch,
      hotSpots: navHotSpots,
    });

    pannellumInstanceRef.current = viewer;
    applyRememberedView(viewer);

    try {
      viewer.on?.("load", () => applyRememberedView(viewer));
    } catch {}

    return () => {
      if (pannellumInstanceRef.current) {
        try {
          pannellumInstanceRef.current.destroy();
        } catch {}
        pannellumInstanceRef.current = null;
      }
    };
  }, [currentSceneIdResolved, currentPanorama, mapData, sceneConnections, scenes, machineAreas]);

  function zoomBy(delta) {
    const viewer = pannellumInstanceRef.current;
    if (!viewer?.getHfov || !viewer?.setHfov) return;
    viewer.setHfov(Math.max(35, Math.min(120, viewer.getHfov() + delta)));
  }

  function toggleFullscreen() {
    const target = shellRef.current;
    if (!target) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else target.requestFullscreen?.();
  }

  if (!mapData || !currentScene) {
    return (
      <div className="street-viewer-empty">
        <h2>No 360 location found</h2>
        <p>Add at least one location in Admin Configuration.</p>
      </div>
    );
  }

  const activeMapPoint = getSceneMapPoint(currentScene) || { x: 50, y: 50 };

  function handleMiniMapTeleport(event) {
    if (!mapImage) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const clickedPoint = {
      x: clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 100),
      y: clamp(((event.clientY - rect.top) / rect.height) * 100, 0, 100),
    };

    const closest = sceneList
      .map((scene) => ({ scene, point: getSceneMapPoint(scene) }))
      .filter((item) => item.point && scenes[item.scene?.id])
      .map((item) => {
        const dx = normalizeNumber(item.point.x, 50) - clickedPoint.x;
        const dy = normalizeNumber(item.point.y, 50) - clickedPoint.y;
        return { ...item, distance: Math.sqrt(dx * dx + dy * dy) };
      })
      .sort((a, b) => a.distance - b.distance)[0];

    if (closest?.scene?.id) switchScene(closest.scene.id);
  }

  return (
    <div ref={shellRef} className={`street-viewer-shell ${isTransitioning ? "is-speed-transitioning" : ""}`}>
      <div ref={viewerRef} className="street-pannellum-stage" />

      <div className="street-location-pill">
        <span>{site?.name || mapData?.name || "Street View"}</span>
        <strong>{labelForScene(currentScene, currentSceneIdResolved)}</strong>
      </div>

      <button
        type="button"
        className={`street-safety-toggle ${isSafetyModeOn ? "is-on" : ""}`}
        onClick={() => setIsSafetyModeOn((current) => !current)}
        title={isSafetyModeOn ? "Hide safety markings" : "Show safety markings"}
      >
        {isSafetyModeOn ? "Safety Off" : "Safety On"}
      </button>

      {isSafetyModeOn && projectedMachineAreas.length > 0 && (
        <svg className="machine-area-screen-overlay" aria-hidden="true">
          <defs>
            {projectedMachineAreas.map((item) => {
              const previewImage = getMachineAreaHoverImage(item.area);
              if (!previewImage) return null;
              const patternId = getMachineAreaPatternId("viewer-machine-area-fill", item.id);
              return (
                <pattern
                  key={patternId}
                  id={patternId}
                  patternUnits="objectBoundingBox"
                  patternContentUnits="objectBoundingBox"
                  width="1"
                  height="1"
                >
                  <image href={previewImage} x="0" y="0" width="1" height="1" preserveAspectRatio="xMidYMid slice" />
                </pattern>
              );
            })}
          </defs>

          {projectedMachineAreas.map((item) => {
            const isActive = hoveredMachineArea?.id === item.area.id;
            const previewImage = isActive ? getMachineAreaHoverImage(item.area) : "";
            const patternId = getMachineAreaPatternId("viewer-machine-area-fill", item.id);

            return (
              <polygon
                key={item.id}
                className={`machine-area-screen-polygon ${isActive ? "is-active" : ""} ${previewImage ? "has-preview-fill" : ""}`}
                points={item.pointsAttr}
                style={previewImage ? { fill: `url(#${patternId})` } : undefined}
                onMouseEnter={() => showMachineArea(item.area)}
                onMouseLeave={scheduleMachineAreaClose}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  showMachineArea(item.area);
                }}
              />
            );
          })}
        </svg>
      )}

      <div className="street-viewer-controls-clean street-viewer-controls-by-map" onClick={(event) => event.stopPropagation()}>
        <button type="button" onClick={() => zoomBy(-10)} title="Zoom in">+</button>
        <button type="button" onClick={() => zoomBy(10)} title="Zoom out">−</button>
        <button type="button" onClick={toggleFullscreen} title="Fullscreen">⛶</button>
      </div>

      {isSafetyModeOn && hoveredMachineArea && (
        <aside className="machine-area-info-card" onMouseEnter={cancelMachineAreaClose} onMouseLeave={scheduleMachineAreaClose}>
          <div className="machine-area-info-header">
            <span>Safety Area</span>
            <button type="button" onClick={() => setHoveredMachineArea(null)}>×</button>
          </div>
          <strong>{getMachineAreaTitle(hoveredMachineArea)}</strong>
          {hoveredMachineArea.machineType && <em>{hoveredMachineArea.machineType}</em>}
          {getMachineAreaPopupImage(hoveredMachineArea) && (
            <img src={getMachineAreaPopupImage(hoveredMachineArea)} alt={getMachineAreaTitle(hoveredMachineArea)} />
          )}
          {hoveredMachineArea.hazard && <p><b>Hazard:</b> {hoveredMachineArea.hazard}</p>}
          {hoveredMachineArea.safetyNote && <p><b>Safety:</b> {hoveredMachineArea.safetyNote}</p>}
          {hoveredMachineArea.description && <p>{hoveredMachineArea.description}</p>}
        </aside>
      )}

      <div className="street-minimap-card raw-only">
        <div className="street-minimap-window">
          {mapImage ? (
            <div className="street-minimap-world" style={{ transform: getMiniMapTransform(activeMapPoint) }} onClick={handleMiniMapTeleport} title="Click the map to jump to the closest location">
              <img src={mapImage} alt="Site map" className="street-minimap-image" />

              {sceneList.map((scene) => {
                const point = getSceneMapPoint(scene);
                if (!point) return null;
                const isActive = scene.id === currentSceneIdResolved;
                return (
                  <button
                    key={scene.id}
                    type="button"
                    className={`street-minimap-dot ${isActive ? "is-active" : "is-nearby"}`}
                    style={{
                      left: `${normalizeNumber(point.x, 50)}%`,
                      top: `${normalizeNumber(point.y, 50)}%`,
                    }}
                    title={labelForScene(scene, scene.id)}
                    onClick={(event) => {
                      event.stopPropagation();
                      switchScene(scene.id);
                    }}
                  />
                );
              })}
            </div>
          ) : (
            <div className="street-minimap-empty">No map image</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default StreetViewer;
