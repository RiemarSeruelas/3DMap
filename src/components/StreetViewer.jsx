import { useEffect, useMemo, useRef, useState } from "react";
import "pannellum/build/pannellum.css";
import "pannellum";
import "../styles/viewer360.css";

const MAP_WORLD_WIDTH = 520;
const MAP_WORLD_HEIGHT = 292.5;
const MAP_WINDOW_WIDTH = 310;
const MAP_WINDOW_HEIGHT = 175;

function safeScenes(mapData) {
  return mapData?.scenes || {};
}

function getFirstSceneId(mapData) {
  const scenes = safeScenes(mapData);
  return (
    mapData?.settings?.firstScene ||
    mapData?.firstScene ||
    Object.keys(scenes)[0] ||
    null
  );
}

function normalizeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function xyToYawPitch(hotspot = {}) {
  // IMPORTANT: admin currently stores arrow placement as 0-100 x/y from the 360 image.
  // Prefer x/y even if old records also have yaw/pitch:0/-8, because those old yaw/pitch
  // values were just defaults and made every arrow appear in the same spot.
  if (Number.isFinite(Number(hotspot.x)) && Number.isFinite(Number(hotspot.y))) {
    const x = normalizeNumber(hotspot.x, 50);
    const y = normalizeNumber(hotspot.y, 50);

    return {
      yaw: (x / 100) * 360 - 180,
      pitch: clamp(90 - (y / 100) * 180, -85, 85),
    };
  }

  if (Number.isFinite(Number(hotspot.yaw)) && Number.isFinite(Number(hotspot.pitch))) {
    return {
      yaw: normalizeNumber(hotspot.yaw, 0),
      pitch: normalizeNumber(hotspot.pitch, -8),
    };
  }

  return { yaw: 0, pitch: -8 };
}

function getSceneConnections(mapData, sceneId) {
  return (mapData?.connections || []).filter(
    (connection) => connection?.from === sceneId && connection?.to
  );
}

function getSceneMapPoint(scene) {
  return scene?.mapPoint || scene?.minimap || null;
}

function getMapImage(mapData, site, area) {
  return (
    site?.mapImage ||
    area?.mapImage ||
    mapData?.mapImage ||
    mapData?.siteMapImage ||
    mapData?.areaMapImage ||
    null
  );
}

function labelForScene(scene, sceneId) {
  return scene?.label || scene?.title || scene?.name || sceneId || "Location";
}

function getMiniMapTransform(activePoint) {
  const x = normalizeNumber(activePoint?.x, 50);
  const y = normalizeNumber(activePoint?.y, 50);

  const translateX = MAP_WINDOW_WIDTH / 2 - (x / 100) * MAP_WORLD_WIDTH;
  const translateY = MAP_WINDOW_HEIGHT / 2 - (y / 100) * MAP_WORLD_HEIGHT;

  return `translate(${translateX}px, ${translateY}px)`;
}

function StreetViewer({ mapData, site, area }) {
  const viewerRef = useRef(null);
  const pannellumInstanceRef = useRef(null);
  const [currentSceneId, setCurrentSceneId] = useState(() => getFirstSceneId(mapData));

  const scenes = useMemo(() => safeScenes(mapData), [mapData]);
  const sceneList = useMemo(() => Object.values(scenes || {}).filter(Boolean), [scenes]);
  const currentScene = scenes[currentSceneId] || sceneList[0];
  const currentSceneIdResolved = currentScene?.id || currentSceneId;
  const mapImage = getMapImage(mapData, site, area);

  const sceneConnections = useMemo(
    () => getSceneConnections(mapData, currentSceneIdResolved),
    [mapData, currentSceneIdResolved]
  );

  useEffect(() => {
    const firstScene = getFirstSceneId(mapData);
    setCurrentSceneId((previous) => {
      if (previous && safeScenes(mapData)[previous]) return previous;
      return firstScene;
    });
  }, [mapData]);

  useEffect(() => {
    if (!viewerRef.current || !currentScene?.panorama) return;

    const pannellumGlobal = window.pannellum;

    if (!pannellumGlobal?.viewer) {
      console.error("Pannellum is not available on window.pannellum");
      return;
    }

    if (pannellumInstanceRef.current) {
      try {
        pannellumInstanceRef.current.destroy();
      } catch {
        // ignore hot reload cleanup errors
      }
      pannellumInstanceRef.current = null;
    }

    const viewer = pannellumGlobal.viewer(viewerRef.current, {
      type: "equirectangular",
      panorama: currentScene.panorama,
      autoLoad: true,
      showControls: true,
      showFullscreenCtrl: true,
      compass: false,
      draggable: true,
      mouseZoom: true,
      keyboardZoom: true,
      hfov: normalizeNumber(
        currentScene?.view?.initialHfov,
        normalizeNumber(mapData?.settings?.defaultHfov, 110)
      ),
      yaw: normalizeNumber(currentScene?.view?.initialYaw, 0),
      pitch: normalizeNumber(currentScene?.view?.initialPitch, 0),
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
            clickHandlerFunc: () => {
              if (scenes[connection.to]) {
                setCurrentSceneId(connection.to);
              }
            },
          };
        }),
    });

    pannellumInstanceRef.current = viewer;

    return () => {
      if (pannellumInstanceRef.current) {
        try {
          pannellumInstanceRef.current.destroy();
        } catch {
          // ignore cleanup errors
        }
        pannellumInstanceRef.current = null;
      }
    };
  }, [currentSceneIdResolved, currentScene?.panorama, mapData, sceneConnections, scenes]);

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
    <div className="street-viewer-shell">
      <div ref={viewerRef} className="street-pannellum-stage" />

      <div className="street-location-pill">
        <span>{site?.name || mapData?.name || "Street View"}</span>
        <strong>{labelForScene(currentScene, currentSceneIdResolved)}</strong>
      </div>

      <div className="street-minimap-card">
        <div className="street-minimap-header">
          <span>Site Map</span>
          <strong>{labelForScene(currentScene, currentSceneIdResolved)}</strong>
        </div>

        <div className="street-minimap-window">
          {mapImage ? (
            <div
              className="street-minimap-world"
              style={{ transform: getMiniMapTransform(activeMapPoint) }}
            >
              <img src={mapImage} alt="Site map" className="street-minimap-image" />

              {area?.points && (
                <svg className="street-minimap-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
                  <polygon points={area.points} className="street-minimap-area" />
                </svg>
              )}

              {sceneList.map((scene) => {
                const point = getSceneMapPoint(scene);
                if (!point) return null;

                const isActive = scene.id === currentSceneIdResolved;

                return (
                  <button
                    key={scene.id}
                    type="button"
                    className={`street-minimap-dot ${isActive ? "is-active" : ""}`}
                    style={{
                      left: `${normalizeNumber(point.x, 50)}%`,
                      top: `${normalizeNumber(point.y, 50)}%`,
                    }}
                    onClick={() => setCurrentSceneId(scene.id)}
                    title={labelForScene(scene, scene.id)}
                  />
                );
              })}
            </div>
          ) : (
            <div className="street-minimap-empty">No map image</div>
          )}

          <div className="street-minimap-center-ring" />
        </div>
      </div>
    </div>
  );
}

export default StreetViewer;
