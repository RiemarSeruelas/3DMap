import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import "pannellum/build/pannellum.css";
import "pannellum";
import "../styles/streetview-clean-viewer-map-admin.css";

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
    .sort((a, b) => labelForScene(a, a.id).localeCompare(labelForScene(b, b.id), undefined, {
      numeric: true,
      sensitivity: "base",
    }));
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
  return site?.mapImage || area?.mapImage || mapData?.mapImage || mapData?.siteMapImage || mapData?.areaMapImage || null;
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
    if (!src) return resolve(false);
    const image = new Image();
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
    image.src = src;
  });
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

  const currentScene = scenes[currentSceneId] || sceneList[0];
  const currentSceneIdResolved = currentScene?.id || currentSceneId;
  const mapImage = getMapImage(mapData, site, area);

  const sceneConnections = useMemo(
    () => getSceneConnections(mapData, currentSceneIdResolved),
    [mapData, currentSceneIdResolved]
  );

  function rememberCurrentView() {
    const viewer = pannellumInstanceRef.current;
    if (!viewer) return;
    viewMemoryRef.current = {
      yaw: normalizeNumber(viewer.getYaw?.(), 0),
      pitch: normalizeNumber(viewer.getPitch?.(), 0),
      hfov: normalizeNumber(viewer.getHfov?.(), normalizeNumber(mapData?.settings?.defaultHfov, 110)),
    };
  }

  async function switchScene(nextSceneId) {
    if (!scenes[nextSceneId] || nextSceneId === currentSceneIdResolved) return;
    rememberCurrentView();
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
    if (!viewerRef.current || !currentScene?.panorama) return;
    const pannellumGlobal = window.pannellum;
    if (!pannellumGlobal?.viewer) return;

    if (pannellumInstanceRef.current) {
      try {
        pannellumInstanceRef.current.destroy();
      } catch {}
      pannellumInstanceRef.current = null;
    }

    const remembered = viewMemoryRef.current;
    const viewer = pannellumGlobal.viewer(viewerRef.current, {
      type: "equirectangular",
      panorama: currentScene.panorama,
      autoLoad: true,
      showControls: false,
      showFullscreenCtrl: false,
      compass: false,
      draggable: true,
      mouseZoom: true,
      keyboardZoom: true,
      hfov: normalizeNumber(
        remembered?.hfov,
        normalizeNumber(currentScene?.view?.initialHfov, normalizeNumber(mapData?.settings?.defaultHfov, 110))
      ),
      yaw: normalizeNumber(remembered?.yaw, normalizeNumber(currentScene?.view?.initialYaw, 0)),
      pitch: normalizeNumber(remembered?.pitch, normalizeNumber(currentScene?.view?.initialPitch, 0)),
      hotSpots: sceneConnections
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
            createTooltipFunc: (hotSpotDiv) => {
              hotSpotDiv.innerHTML = `
                <button class="street-arrow-only-button" type="button" title="${connection.label || labelForScene(targetScene, connection.to)}">
                  <span>➜</span>
                </button>
              `;
            },
            clickHandlerFunc: () => switchScene(connection.to),
          };
        }),
    });

    pannellumInstanceRef.current = viewer;

    return () => {
      if (pannellumInstanceRef.current) {
        try {
          pannellumInstanceRef.current.destroy();
        } catch {}
        pannellumInstanceRef.current = null;
      }
    };
  }, [currentSceneIdResolved, currentScene?.panorama, mapData, sceneConnections, scenes]);

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

  return (
    <div ref={shellRef} className={`street-viewer-shell ${isTransitioning ? "is-speed-transitioning" : ""}`}>
      <div ref={viewerRef} className="street-pannellum-stage" />

      <div className="street-location-pill">
        <span>{site?.name || mapData?.name || "Street View"}</span>
        <strong>{labelForScene(currentScene, currentSceneIdResolved)}</strong>
      </div>

      <div className="street-viewer-controls-clean" onClick={(event) => event.stopPropagation()}>
        <button type="button" onClick={() => zoomBy(-10)} title="Zoom in">+</button>
        <button type="button" onClick={() => zoomBy(10)} title="Zoom out">−</button>
        <button type="button" onClick={toggleFullscreen} title="Fullscreen">⛶</button>
      </div>

      <div className="street-minimap-card raw-only">
        <div className="street-minimap-window">
          {mapImage ? (
            <div className="street-minimap-world" style={{ transform: getMiniMapTransform(activeMapPoint) }}>
              <img src={mapImage} alt="Site map" className="street-minimap-image" />

              <button
                type="button"
                className="street-minimap-dot is-active"
                style={{
                  left: `${normalizeNumber(activeMapPoint.x, 50)}%`,
                  top: `${normalizeNumber(activeMapPoint.y, 50)}%`,
                }}
                title={labelForScene(currentScene, currentSceneIdResolved)}
              />
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
