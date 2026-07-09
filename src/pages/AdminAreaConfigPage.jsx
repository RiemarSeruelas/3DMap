import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "pannellum/build/pannellum.css";
import "pannellum";
import {
  getEffectiveSite,
  getEffectiveArea,
  ensureTour,
  updateAreaTour,
  uploadPanoramaAsset,
  uploadAssetFile,
  createUniqueId,
} from "../utils/streetViewAdminStorage";
import "../styles/admin.css";

const CARD_PAGE_SIZE = 40;
const MAP_ZOOM_MIN = 1;
const MAP_ZOOM_MAX = 4;
const MAP_ZOOM_STEP = 0.35;
const DIRECTION_MARKER_PITCH = -42;
const DIRECTION_ORBIT_YAW_RANGE = 68;
const DIRECTION_ARROW_MAX_ROTATION = 48;
const EMPTY_MACHINE_FORM = {
  machineName: "",
  machineType: "",
  hazard: "",
  safetyNote: "",
  description: "",
  image: "",
  hoverImage: "",
};

function getSaveAssetBase() {
  if (typeof window === "undefined") return "http://localhost:3010";

  const override = window.__STREETVIEW_SAVE_API_BASE__;
  if (typeof override === "string" && override.trim()) {
    return override.trim().replace(/\/$/, "");
  }

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

  if (cleanValue.startsWith("/uploads/") || cleanValue.startsWith("/data/")) {
    return `${getSaveAssetBase()}${cleanValue}`;
  }

  return cleanValue;
}

function getSceneImage(scene) {
  return resolveAssetUrl(scene?.panorama || scene?.image || scene?.url || scene?.publicPath || "");
}

function getSceneTitle(scene, fallback = "Untitled Location") {
  return scene?.title || scene?.name || scene?.label || fallback;
}

function getSiteMapImage(site, area, tour) {
  return resolveAssetUrl(
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

function sortScenesAlphabetically(sceneList) {
  return [...sceneList].sort((a, b) => {
    const nameA = getSceneTitle(a).toLowerCase();
    const nameB = getSceneTitle(b).toLowerCase();
    return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: "base" });
  });
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
    return { pitch: Number(hotspot.pitch), yaw: Number(hotspot.yaw) };
  }
  return legacyPercentToPano(hotspot);
}

function getSceneMapPoint(scene) {
  return scene?.mapPoint || scene?.minimap || null;
}

function getSceneLinkCount(scene) {
  return (scene?.hotspots || []).filter((hotspot) => hotspot?.targetSceneId).length;
}

function getSceneMachineAreaCount(scene) {
  return Array.isArray(scene?.machineAreas) ? scene.machineAreas.length : 0;
}

function normalizeAdminNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clampAdminNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeAdminYaw(yaw) {
  let nextYaw = normalizeAdminNumber(yaw, 0);
  while (nextYaw > 180) nextYaw -= 360;
  while (nextYaw < -180) nextYaw += 360;
  return Number(nextYaw.toFixed(2));
}

function getAdminSceneNorthOffset(scene) {
  return normalizeAdminYaw(
    scene?.view?.northOffset ??
      scene?.view?.yawOffset ??
      scene?.northOffset ??
      scene?.yawOffset ??
      0
  );
}

function adminSceneYawToWorldYaw(sceneYaw, scene) {
  return normalizeAdminYaw(normalizeAdminNumber(sceneYaw, 0) + getAdminSceneNorthOffset(scene));
}

function adminWorldYawToSceneYaw(worldYaw, scene) {
  return normalizeAdminYaw(normalizeAdminNumber(worldYaw, 0) - getAdminSceneNorthOffset(scene));
}

function bindAdminLiveArrowRotation(button, hotspotYaw, getViewer) {
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
      const currentYaw = normalizeAdminNumber(viewer.getYaw(), 0);
      const relativeYaw = normalizeAdminYaw(normalizeAdminNumber(hotspotYaw, 0) - currentYaw);
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

function getMachineAreaPoints(area = {}) {
  return Array.isArray(area.points) ? area.points.filter((point) => Number.isFinite(Number(point.pitch)) && Number.isFinite(Number(point.yaw))) : [];
}

function getMachineAreaCenter(area = {}) {
  const points = getMachineAreaPoints(area);
  if (!points.length) return { pitch: -8, yaw: 0 };
  return {
    pitch: points.reduce((sum, point) => sum + normalizeAdminNumber(point.pitch, 0), 0) / points.length,
    yaw: points.reduce((sum, point) => sum + normalizeAdminNumber(point.yaw, 0), 0) / points.length,
  };
}

function getMachineAreaSize(area = {}) {
  const points = getMachineAreaPoints(area);
  if (points.length < 2) return { width: 170, height: 120 };

  const yaws = points.map((point) => normalizeAdminNumber(point.yaw, 0));
  const pitches = points.map((point) => normalizeAdminNumber(point.pitch, 0));
  const yawSpan = Math.max(...yaws) - Math.min(...yaws);
  const pitchSpan = Math.max(...pitches) - Math.min(...pitches);

  return {
    width: Math.round(clampAdminNumber(Math.abs(yawSpan) * 14, 120, 460)),
    height: Math.round(clampAdminNumber(Math.abs(pitchSpan) * 18, 80, 360)),
  };
}

function projectPanoPointToScreen(point, viewer, element) {
  if (!point || !viewer || !element) return null;

  const width = element.clientWidth || element.getBoundingClientRect().width || 1;
  const height = element.clientHeight || element.getBoundingClientRect().height || 1;
  const yaw = normalizeAdminYaw(point.yaw);
  const pitch = clampAdminNumber(normalizeAdminNumber(point.pitch, 0), -89, 89);
  const viewYaw = normalizeAdminYaw(viewer.getYaw?.() || 0);
  const viewPitch = clampAdminNumber(normalizeAdminNumber(viewer.getPitch?.(), 0), -89, 89);
  const hfov = clampAdminNumber(normalizeAdminNumber(viewer.getHfov?.(), 100), 35, 120);

  const deg = Math.PI / 180;
  const targetPitch = pitch * deg;
  const deltaYaw = normalizeAdminYaw(yaw - viewYaw) * deg;
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

function PannellumStage({
  image,
  scene,
  scenesById,
  isPicking,
  pickLabel,
  onPickPoint,
  onGoToScene,
  machineDraftPoints = [],
  machineAreas = [],
  onEditMachineArea,
  onRemoveMachineArea,
  isDirectionPicking = false,
  directionTargetTitle = "",
}) {
  const mountRef = useRef(null);
  const viewerRef = useRef(null);
  const viewMemoryRef = useRef(null);
  const onGoToSceneRef = useRef(onGoToScene);
  const onPickPointRef = useRef(onPickPoint);
  const [hoveredMachineArea, setHoveredMachineArea] = useState(null);
  const [projectedMachineAreas, setProjectedMachineAreas] = useState([]);
  const machineHoverCloseTimerRef = useRef(null);
  const selectedSceneId = scene?.id || "";

  const hotspotSignature = useMemo(() => {
    const linkSignature = (scene?.hotspots || [])
      .filter((hotspot) => hotspot?.targetSceneId)
      .map((hotspot) => `${hotspot.id}:${hotspot.targetSceneId}:${hotspot.pitch}:${hotspot.yaw}:${hotspot.x}:${hotspot.y}:${hotspot.directionAngle}`)
      .join("|");

    const machineSignature = (machineAreas || [])
      .map((area) => `${area.id}:${getMachineAreaPoints(area).map((point) => `${point.pitch},${point.yaw}`).join(";")}`)
      .join("|");

    const draftSignature = (machineDraftPoints || []).map((point) => `${point.pitch},${point.yaw}`).join("|");

    return `${linkSignature}::${machineSignature}::${draftSignature}`;
  }, [scene?.hotspots, machineAreas, machineDraftPoints]);

  useEffect(() => {
    onGoToSceneRef.current = onGoToScene;
  }, [onGoToScene]);

  useEffect(() => {
    onPickPointRef.current = onPickPoint;
  }, [onPickPoint]);

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

  useEffect(() => {
    return () => cancelMachineAreaClose();
  }, []);

  function rememberCurrentAdminView() {
    const viewer = viewerRef.current;
    if (!viewer || !scene) return;

    const rawYaw = normalizeAdminNumber(viewer.getYaw?.(), 0);
    const rawPitch = normalizeAdminNumber(viewer.getPitch?.(), 0);
    const rawHfov = normalizeAdminNumber(viewer.getHfov?.(), 105);

    viewMemoryRef.current = {
      worldYaw: adminSceneYawToWorldYaw(rawYaw, scene),
      rawYaw,
      pitch: rawPitch,
      hfov: rawHfov,
      fromSceneId: scene?.id,
      savedAt: Date.now(),
    };
  }

  function goToSceneWithRememberedView(targetSceneId) {
    rememberCurrentAdminView();
    onGoToSceneRef.current?.(targetSceneId);
  }

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !image || !window?.pannellum?.viewer) return;

    mount.innerHTML = "";

    const remembered = viewMemoryRef.current;

    const targetYaw = normalizeAdminYaw(
      remembered
        ? adminWorldYawToSceneYaw(remembered.worldYaw, scene)
        : normalizeAdminNumber(scene?.view?.initialYaw, 0)
    );

    const targetPitch = clampAdminNumber(
      normalizeAdminNumber(remembered?.pitch, normalizeAdminNumber(scene?.view?.initialPitch, 0)),
      -85,
      85
    );

    const targetHfov = clampAdminNumber(
      normalizeAdminNumber(remembered?.hfov, normalizeAdminNumber(scene?.view?.initialHfov, 105)),
      35,
      120
    );

    function applyRememberedAdminView(viewer) {
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

    const locationHotSpots = (scene?.hotspots || [])
      .filter((hotspot) => hotspot?.targetSceneId)
      .map((hotspot) => {
        const position = normalizeHotspotPosition(hotspot);
        const targetScene = scenesById?.[hotspot.targetSceneId];

        return {
          pitch: position.pitch,
          yaw: position.yaw,
          type: "custom",
          cssClass: "admin-config-pnlm-hotspot-shell-v2",
          createTooltipFunc: (hotSpotDiv, args) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "admin-config-pnlm-hotspot-button-v2";
            button.innerHTML = '<span class="street-floor-arrow-core" aria-hidden="true"></span>';
            button.title = args.title;
            button.setAttribute("aria-label", args.title);
            bindAdminLiveArrowRotation(button, args.hotspotYaw, () => viewerRef.current);
            button.addEventListener("click", (event) => {
              event.preventDefault();
              event.stopPropagation();
              goToSceneWithRememberedView(args.targetSceneId);
            });
            hotSpotDiv.appendChild(button);
          },
          createTooltipArgs: {
            title: targetScene ? `Go to ${getSceneTitle(targetScene)}` : "Go to location",
            targetSceneId: hotspot.targetSceneId,
            hotspotYaw: position.yaw,
          },
        };
      });

    const draftHotSpots = (machineDraftPoints || []).map((point, index) => ({
      pitch: point.pitch,
      yaw: point.yaw,
      type: "custom",
      cssClass: "machine-draft-point-shell",
      createTooltipFunc: (hotSpotDiv) => {
        const dot = document.createElement("span");
        dot.className = "machine-draft-point";
        dot.textContent = String(index + 1);
        hotSpotDiv.appendChild(dot);
      },
    }));

    viewerRef.current = window.pannellum.viewer(mount, {
      type: "equirectangular",
      panorama: image,
      autoLoad: true,
      showControls: false,
      compass: false,
      keyboardZoom: true,
      mouseZoom: true,
      hfov: targetHfov,
      yaw: targetYaw,
      pitch: targetPitch,
      hotSpots: [...locationHotSpots, ...draftHotSpots],
    });

    applyRememberedAdminView(viewerRef.current);

    try {
      viewerRef.current?.on?.("load", () => applyRememberedAdminView(viewerRef.current));
    } catch {}

    return () => {
      try {
        viewerRef.current?.destroy?.();
      } catch {}
      viewerRef.current = null;
    };
  }, [image, selectedSceneId, hotspotSignature, scenesById]);

  useEffect(() => {
    setProjectedMachineAreas([]);
    setHoveredMachineArea(null);

    let animationFrame = 0;
    let lastSignature = "__init__";

    function updateProjectedMachineAreas() {
      const viewer = viewerRef.current;
      const element = mountRef.current;

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
  }, [machineAreas, selectedSceneId]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    function handleClick(event) {
      if (!isPicking) return;
      if (event.target.closest(".admin-config-pnlm-hotspot-button-v2, .machine-area-hotspot-button, .machine-draft-point")) return;

      if (viewerRef.current?.mouseEventToCoords) {
        const coords = viewerRef.current.mouseEventToCoords(event);
        if (Array.isArray(coords) && coords.length >= 2) {
          if (isDirectionPicking) {
            const rect = mount.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const clickOffsetX = event.clientX - centerX;
            const directionStrength = clampAdminNumber(clickOffsetX / Math.max(1, rect.width * 0.38), -1, 1);
            const centerYaw = normalizeAdminNumber(viewerRef.current?.getYaw?.(), Number(coords[1]));
            const directionYaw = normalizeAdminYaw(centerYaw + directionStrength * DIRECTION_ORBIT_YAW_RANGE);
            const directionAngle = Number((directionStrength * DIRECTION_ARROW_MAX_ROTATION).toFixed(2));

            rememberCurrentAdminView();
            onPickPointRef.current?.({
              pitch: DIRECTION_MARKER_PITCH,
              yaw: directionYaw,
              directionYaw,
              directionAngle,
              clickPitch: Number(coords[0].toFixed(2)),
              clickYaw: Number(coords[1].toFixed(2)),
              coordinateMode: "direction-orbit",
              ...toLegacyPercentPoint(DIRECTION_MARKER_PITCH, directionYaw),
            });
            return;
          }

          const pitch = Number(coords[0].toFixed(2));
          const yaw = Number(coords[1].toFixed(2));
          rememberCurrentAdminView();
          onPickPointRef.current?.({
            pitch,
            yaw,
            ...toLegacyPercentPoint(pitch, yaw),
          });
        }
      }
    }

    mount.addEventListener("click", handleClick);
    return () => mount.removeEventListener("click", handleClick);
  }, [isPicking, isDirectionPicking]);

  function handleFallbackClick(event) {
    if (!isPicking) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    if (isDirectionPicking) {
      const directionStrength = clampAdminNumber((x - 50) / 38, -1, 1);
      const directionYaw = normalizeAdminYaw(directionStrength * DIRECTION_ORBIT_YAW_RANGE);
      const directionAngle = Number((directionStrength * DIRECTION_ARROW_MAX_ROTATION).toFixed(2));
      rememberCurrentAdminView();
      onPickPointRef.current?.({
        pitch: DIRECTION_MARKER_PITCH,
        yaw: directionYaw,
        directionYaw,
        directionAngle,
        coordinateMode: "direction-orbit",
        ...toLegacyPercentPoint(DIRECTION_MARKER_PITCH, directionYaw),
      });
      return;
    }

    rememberCurrentAdminView();
    onPickPointRef.current?.({ ...legacyPercentToPano({ x, y }), x, y });
  }

  function zoomBy(delta) {
    const viewer = viewerRef.current;
    if (!viewer?.getHfov || !viewer?.setHfov) return;
    viewer.setHfov(Math.max(35, Math.min(120, viewer.getHfov() + delta)));
  }

  function toggleFullscreen() {
    const target = mountRef.current?.parentElement;
    if (!target) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else target.requestFullscreen?.();
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

      {projectedMachineAreas.length > 0 && (
        <svg className="machine-area-screen-overlay admin-machine-area-screen-overlay" aria-hidden="true">
          <defs>
            {projectedMachineAreas.map((item) => {
              const previewImage = getMachineAreaHoverImage(item.area);
              if (!previewImage) return null;
              const patternId = getMachineAreaPatternId("admin-machine-area-fill", item.id);
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
            const patternId = getMachineAreaPatternId("admin-machine-area-fill", item.id);

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

      <div className="admin-config-pannellum-controls-v2" onClick={(event) => event.stopPropagation()}>
        <button type="button" onClick={() => zoomBy(-10)} title="Zoom in">+</button>
        <button type="button" onClick={() => zoomBy(10)} title="Zoom out">−</button>
        <button type="button" onClick={toggleFullscreen} title="Fullscreen">⛶</button>
      </div>

      {hoveredMachineArea && (
        <aside className="machine-area-info-card admin-machine-area-info-card" onMouseEnter={cancelMachineAreaClose} onMouseLeave={scheduleMachineAreaClose} onClick={(event) => event.stopPropagation()}>
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
          <div className="machine-area-card-actions">
            <button type="button" onClick={() => { setHoveredMachineArea(null); onEditMachineArea?.(hoveredMachineArea); }}>Edit</button>
            <button type="button" className="danger" onClick={() => { setHoveredMachineArea(null); onRemoveMachineArea?.(hoveredMachineArea.id); }}>Remove</button>
          </div>
        </aside>
      )}

      {isDirectionPicking && (
        <div className="direction-marking-guide" aria-hidden="true">
          <div className="direction-marking-orbit">
            <span className="direction-person-dot" />
            <span className="direction-orbit-arrow direction-orbit-arrow-up">⌃</span>
            <span className="direction-orbit-arrow direction-orbit-arrow-right">›</span>
            <span className="direction-orbit-arrow direction-orbit-arrow-left">‹</span>
          </div>
          <strong>Click the direction</strong>
          <span>{directionTargetTitle ? `toward ${directionTargetTitle}` : "toward the next panorama"}</span>
        </div>
      )}

      {isPicking && (
        <div className={`admin-config-picking-banner-v2 ${isDirectionPicking ? "direction-picking-banner" : "machine-picking-banner"}`}>
          {pickLabel || "Click inside the panorama"}
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
  const [visibleCount, setVisibleCount] = useState(CARD_PAGE_SIZE);

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newLocationName, setNewLocationName] = useState("");
  const [newLocationFiles, setNewLocationFiles] = useState([]);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  const [mode, setMode] = useState("preview");
  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
  const [isMapModalOpen, setIsMapModalOpen] = useState(false);
  const [pendingTargetSceneId, setPendingTargetSceneId] = useState(null);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editLocationName, setEditLocationName] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [mapZoom, setMapZoom] = useState(1);
  const [mapPan, setMapPan] = useState({ x: 0, y: 0 });
  const [isMapPanning, setIsMapPanning] = useState(false);

  const [machineAreaDraftPoints, setMachineAreaDraftPoints] = useState([]);
  const [isMachineModalOpen, setIsMachineModalOpen] = useState(false);
  const [machineForm, setMachineForm] = useState(EMPTY_MACHINE_FORM);
  const [editingMachineAreaId, setEditingMachineAreaId] = useState(null);
  const [machineImageFile, setMachineImageFile] = useState(null);
  const [machineHoverImageFile, setMachineHoverImageFile] = useState(null);
  const [isMarkingsMenuOpen, setIsMarkingsMenuOpen] = useState(false);
  const [isLocationManagerOpen, setIsLocationManagerOpen] = useState(false);
  const [mapModalMode, setMapModalMode] = useState("jump");

  const mapViewportRef = useRef(null);
  const mapPanGestureRef = useRef({
    active: false,
    moved: false,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
  });

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

  const scenesById = useMemo(() => tour?.scenes || {}, [tour]);
  const scenes = useMemo(() => sortScenesAlphabetically(Object.values(tour?.scenes || {})), [tour]);

  const filteredScenes = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    if (!query) return scenes;
    return scenes.filter((scene) => getSceneTitle(scene).toLowerCase().includes(query));
  }, [scenes, searchText]);

  const visibleScenes = useMemo(() => filteredScenes.slice(0, visibleCount), [filteredScenes, visibleCount]);
  const selectedScene = selectedSceneId ? tour?.scenes?.[selectedSceneId] : scenes[0];
  const selectedImage = getSceneImage(selectedScene);
  const pendingTargetScene = pendingTargetSceneId ? tour?.scenes?.[pendingTargetSceneId] : null;
  const siteMapImage = getSiteMapImage(site, area, tour);
  const selectedMachineAreas = Array.isArray(selectedScene?.machineAreas) ? selectedScene.machineAreas : [];

  const selectedHotspots = useMemo(() => {
    return (selectedScene?.hotspots || []).filter((hotspot) => hotspot?.targetSceneId);
  }, [selectedScene]);

  const linkTargetScenes = useMemo(() => {
    return scenes.filter((scene) => scene.id !== selectedScene?.id);
  }, [scenes, selectedScene?.id]);

  useEffect(() => {
    setVisibleCount(CARD_PAGE_SIZE);
  }, [searchText]);

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

  function handleFileSelect(event) {
    const files = Array.from(event.target.files || []).filter((file) => file.type.startsWith("image/"));
    setNewLocationFiles(files);
  }

  async function handleAddLocation(event) {
    event.preventDefault();
    if (!newLocationFiles.length) {
      alert("Please choose at least one 360 image first.");
      return;
    }

    setIsSaving(true);
    setUploadProgress({ current: 0, total: newLocationFiles.length, name: "Preparing..." });

    try {
      const nextTour = {
        ...tour,
        scenes: { ...(tour?.scenes || {}) },
        settings: { ...(tour?.settings || {}) },
      };
      let selectedFirstNewScene = null;

      for (let index = 0; index < newLocationFiles.length; index += 1) {
        const file = newLocationFiles[index];
        setUploadProgress({ current: index + 1, total: newLocationFiles.length, name: file.name });

        const baseTitle =
          newLocationFiles.length === 1 && newLocationName.trim()
            ? newLocationName.trim()
            : file.name.replace(/\.[^/.]+$/, "") || `Location ${index + 1}`;

        const sceneId = createUniqueId(baseTitle, Object.keys(nextTour.scenes));
        const uploaded = await uploadPanoramaAsset(file);

        nextTour.scenes[sceneId] = {
          id: sceneId,
          title: baseTitle,
          name: baseTitle,
          label: baseTitle,
          panorama: uploaded.panorama,
          thumbnail: uploaded.thumbnail,
          mapPoint: null,
          minimap: null,
          hotspots: [],
          machineAreas: [],
          view: { initialYaw: 0, initialPitch: 0, initialHfov: 110, northOffset: 0 },
        };

        if (!nextTour.settings.firstScene) nextTour.settings.firstScene = sceneId;
        if (!selectedFirstNewScene) selectedFirstNewScene = sceneId;

        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      saveTour(nextTour, `${newLocationFiles.length} image(s) added`);
      setSelectedSceneId(selectedFirstNewScene);
      setIsAddOpen(false);
      setNewLocationName("");
      setNewLocationFiles([]);
      setSearchText("");
      setVisibleCount(CARD_PAGE_SIZE);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (error) {
      console.error(error);
      alert("Failed to add one or more location images.");
    } finally {
      setIsSaving(false);
      setUploadProgress(null);
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
    if (!cleanName) return alert("Location name cannot be blank.");

    const nextScene = { ...selectedScene, title: cleanName, name: cleanName, label: cleanName };
    saveTour({ ...tour, scenes: { ...tour.scenes, [selectedScene.id]: nextScene } }, "Name saved");
    setIsEditOpen(false);
  }

  function removeMachineArea(machineAreaId) {
    if (!selectedScene?.id) return;
    const machineArea = selectedMachineAreas.find((item) => item.id === machineAreaId);
    if (!window.confirm(`Remove machine area "${getMachineAreaTitle(machineArea)}"?`)) return;

    const nextScene = {
      ...selectedScene,
      machineAreas: selectedMachineAreas.filter((item) => item.id !== machineAreaId),
    };

    saveTour({ ...tour, scenes: { ...tour.scenes, [selectedScene.id]: nextScene } }, "Machine area removed");

    if (editingMachineAreaId === machineAreaId) {
      setEditingMachineAreaId(null);
      setMachineAreaDraftPoints([]);
      setMachineImageFile(null);
      setMachineHoverImageFile(null);
      setMachineForm(EMPTY_MACHINE_FORM);
    }
  }

  function removeHotspot(hotspotId) {
    if (!selectedScene?.id) return;
    const hotspot = selectedHotspots.find((item) => item.id === hotspotId);
    const ok = window.confirm(`Remove button to ${getSceneTitle(tour?.scenes?.[hotspot?.targetSceneId], hotspot?.targetSceneId)}?`);
    if (!ok) return;

    const nextScene = {
      ...selectedScene,
      hotspots: (selectedScene.hotspots || []).filter((item) => item.id !== hotspotId),
    };

    saveTour({ ...tour, scenes: { ...tour.scenes, [selectedScene.id]: nextScene } }, "Marked location removed");
  }

  function removeAllHotspots() {
    if (!selectedScene?.id || !selectedHotspots.length) return;
    const ok = window.confirm(`Remove all ${selectedHotspots.length} marked location button(s) from this image?`);
    if (!ok) return;

    const nextScene = {
      ...selectedScene,
      hotspots: (selectedScene.hotspots || []).filter((item) => !item?.targetSceneId),
    };

    saveTour({ ...tour, scenes: { ...tour.scenes, [selectedScene.id]: nextScene } }, "All marked locations removed");
  }

  function removeMapPoint() {
    if (!selectedScene?.id) return;
    const hasMapPoint = !!getSceneMapPoint(selectedScene);
    if (!hasMapPoint) return;

    const ok = window.confirm(`Remove map mark for "${getSceneTitle(selectedScene)}"?`);
    if (!ok) return;

    const nextScene = {
      ...selectedScene,
      mapPoint: null,
      minimap: null,
    };

    saveTour({ ...tour, scenes: { ...tour.scenes, [selectedScene.id]: nextScene } }, "Map mark removed");
  }

  function deleteSelectedLocation() {
    if (!selectedScene?.id) return;
    if (!confirm(`Delete "${getSceneTitle(selectedScene)}"?`)) return;

    const nextScenes = { ...(tour?.scenes || {}) };
    delete nextScenes[selectedScene.id];

    Object.keys(nextScenes).forEach((sceneId) => {
      nextScenes[sceneId] = {
        ...nextScenes[sceneId],
        hotspots: (nextScenes[sceneId].hotspots || []).filter((hotspot) => hotspot?.targetSceneId !== selectedScene.id),
      };
    });

    const remainingIds = Object.keys(nextScenes);
    const nextFirstScene =
      tour?.settings?.firstScene === selectedScene.id
        ? remainingIds[0] || null
        : tour?.settings?.firstScene || remainingIds[0] || null;

    saveTour({ ...tour, settings: { ...tour.settings, firstScene: nextFirstScene }, scenes: nextScenes }, "Image deleted");
    setSelectedSceneId(nextFirstScene);
    setMode("preview");
  }

  function openMarkLocationPicker() {
    if (!selectedScene?.id) return;
    if (scenes.length < 2) return alert("Add another 360 image first, then connect this image to it.");
    setMode("preview");
    setPendingTargetSceneId(null);
    setIsLocationManagerOpen(true);
  }

  function chooseTargetScene(targetSceneId) {
    setPendingTargetSceneId(targetSceneId);
    setIsLinkModalOpen(false);
    setIsLocationManagerOpen(false);
    setIsMarkingsMenuOpen(false);
    setMode("mark-location");
    showSaved("Pick a direction in the 360 image");
  }

  function openMachineAreaPicker() {
    if (!selectedScene?.id) return;
    if (mode === "mark-machine-area") {
      cancelMachineAreaDraft();
      return;
    }
    setMode("preview");
    setPendingTargetSceneId(null);
    setMachineAreaDraftPoints([]);
    setMachineForm(EMPTY_MACHINE_FORM);
    setMachineImageFile(null);
    setMachineHoverImageFile(null);
    setEditingMachineAreaId(null);
    setIsMarkingsMenuOpen(false);
    setIsMachineModalOpen(true);
  }

  function openMachineAreaEditor(machineArea) {
    if (!machineArea?.id) return;
    setEditingMachineAreaId(machineArea.id);
    setMachineForm({
      machineName: machineArea.machineName || machineArea.name || "",
      machineType: machineArea.machineType || "",
      hazard: machineArea.hazard || "",
      safetyNote: machineArea.safetyNote || "",
      description: machineArea.description || "",
      image: machineArea.image || "",
      hoverImage: machineArea.hoverImage || "",
    });
    setMachineImageFile(null);
    setMachineHoverImageFile(null);
    setMachineAreaDraftPoints(getMachineAreaPoints(machineArea));
    setMode("preview");
    setIsMachineModalOpen(true);
  }

  function startNewMachineAreaForm() {
    if (!selectedScene?.id) return;
    setEditingMachineAreaId(null);
    setMachineForm(EMPTY_MACHINE_FORM);
    setMachineImageFile(null);
    setMachineHoverImageFile(null);
    setMachineAreaDraftPoints([]);
    setMode("preview");
    setIsMachineModalOpen(true);
  }

  function startMachineAreaPick({ reset = false } = {}) {
    if (!selectedScene?.id) return;
    setIsMachineModalOpen(false);
    setMode("mark-machine-area");
    setPendingTargetSceneId(null);
    if (reset) setMachineAreaDraftPoints([]);
  }

  function finishMachineAreaDraft() {
    if (machineAreaDraftPoints.length < 3) return alert("Click at least 3 points around the safety area first.");
    setMode("preview");
    setIsMachineModalOpen(true);
  }

  function undoMachineAreaPoint() {
    setMachineAreaDraftPoints((current) => current.slice(0, -1));
  }

  function cancelMachineAreaDraft() {
    setMode("preview");
    setMachineAreaDraftPoints([]);
    setIsMachineModalOpen(false);
    setEditingMachineAreaId(null);
    setMachineImageFile(null);
    setMachineHoverImageFile(null);
    setMachineForm(EMPTY_MACHINE_FORM);
  }

  async function saveMachineArea(event) {
    event.preventDefault();
    if (!selectedScene?.id) return;
    if (machineAreaDraftPoints.length < 3) return alert("Please mark at least 3 points around the safety area.");
    if (!machineForm.machineName.trim()) return alert("Machine name is required.");

    setIsSaving(true);

    try {
      const currentMachineAreas = Array.isArray(selectedScene.machineAreas) ? selectedScene.machineAreas : [];
      const existing = editingMachineAreaId ? currentMachineAreas.find((item) => item.id === editingMachineAreaId) : null;
      const machineId = existing?.id || createUniqueId(`machine-${machineForm.machineName}`, currentMachineAreas.map((item) => item.id));

      let machineImagePath = machineForm.image || existing?.image || "";
      let machineHoverImagePath = machineForm.hoverImage || existing?.hoverImage || "";

      if (machineImageFile) {
        const uploadedImage = await uploadAssetFile(machineImageFile, "machines");
        machineImagePath = uploadedImage.publicPath || uploadedImage.url || machineImagePath;
      }

      if (machineHoverImageFile) {
        const uploadedHoverImage = await uploadAssetFile(machineHoverImageFile, "machines");
        machineHoverImagePath = uploadedHoverImage.publicPath || uploadedHoverImage.url || machineHoverImagePath;
      }

      const nextMachineArea = {
        ...(existing || {}),
        id: machineId,
        type: "machineArea",
        machineName: machineForm.machineName.trim(),
        machineType: machineForm.machineType.trim(),
        hazard: machineForm.hazard.trim(),
        safetyNote: machineForm.safetyNote.trim(),
        description: machineForm.description.trim(),
        image: machineImagePath,
        hoverImage: machineHoverImagePath,
        points: machineAreaDraftPoints,
      };

      const nextMachineAreas = existing
        ? currentMachineAreas.map((item) => (item.id === existing.id ? nextMachineArea : item))
        : [...currentMachineAreas, nextMachineArea];

      const nextScene = {
        ...selectedScene,
        machineAreas: nextMachineAreas,
      };

      saveTour({ ...tour, scenes: { ...tour.scenes, [selectedScene.id]: nextScene } }, existing ? "Safety area updated" : "Safety area saved");
      setIsMachineModalOpen(false);
      setMachineAreaDraftPoints([]);
      setMachineImageFile(null);
      setMachineHoverImageFile(null);
      setMachineForm(EMPTY_MACHINE_FORM);
      setEditingMachineAreaId(null);
      setMode("preview");
    } catch (error) {
      console.error(error);
      alert("Failed to save safety area.");
    } finally {
      setIsSaving(false);
    }
  }

  const handlePanoPick = useCallback((point) => {
    if (!selectedScene?.id) return;

    if (mode === "mark-machine-area") {
      setMachineAreaDraftPoints((currentPoints) => [...currentPoints, point]);
      return;
    }

    if (mode === "mark-location" && pendingTargetSceneId) {
      const targetScene = tour?.scenes?.[pendingTargetSceneId];
      const currentHotspots = selectedScene.hotspots || [];
      const existingHotspot = currentHotspots.find((hotspot) => hotspot?.targetSceneId === pendingTargetSceneId);

      // Navigation markings now use the click only as a general direction.
      // The click chooses only the panorama yaw/direction.
      // The arrow itself is snapped to a fixed floor pitch, so direction is shown by where it sits around the viewer, not by rotating the glyph.
      const directionPoint = {
        pitch: DIRECTION_MARKER_PITCH,
        yaw: normalizeAdminYaw(point.directionYaw ?? point.yaw),
      };
      const directionAngle = Number.isFinite(Number(point.directionAngle)) ? Number(point.directionAngle) : 0;
      const legacyPoint = toLegacyPercentPoint(directionPoint.pitch, directionPoint.yaw);
      const nextHotspot = {
        ...(existingHotspot || {}),
        id: existingHotspot?.id || createUniqueId(`to-${pendingTargetSceneId}`, currentHotspots.map((hotspot) => hotspot.id)),
        type: "scene",
        targetSceneId: pendingTargetSceneId,
        text: targetScene ? getSceneTitle(targetScene) : "Go to location",
        coordinateMode: "direction-orbit",
        pitch: directionPoint.pitch,
        yaw: directionPoint.yaw,
        directionAngle,
        x: legacyPoint.x,
        y: legacyPoint.y,
      };
      const nextScene = {
        ...selectedScene,
        hotspots: existingHotspot
          ? currentHotspots.map((hotspot) => (hotspot.id === existingHotspot.id ? nextHotspot : hotspot))
          : [...currentHotspots, nextHotspot],
      };
      saveTour({ ...tour, scenes: { ...tour.scenes, [selectedScene.id]: nextScene } }, existingHotspot ? "Location button relocated" : "Location button added");
      setPendingTargetSceneId(null);
      setMode("preview");
    }
  }, [mode, pendingTargetSceneId, selectedScene, tour]);

  const goToScene = useCallback((targetSceneId) => {
    if (!tour?.scenes?.[targetSceneId]) return;
    setSelectedSceneId(targetSceneId);
    setMode("preview");
    setPendingTargetSceneId(null);
    setMachineAreaDraftPoints([]);
    setIsMapModalOpen(false);
  }, [tour]);

  function clampMapPan(nextPan, zoomValue = mapZoom) {
    const viewport = mapViewportRef.current;
    if (!viewport || zoomValue <= 1) return { x: 0, y: 0 };

    const minX = viewport.clientWidth * (1 - zoomValue);
    const minY = viewport.clientHeight * (1 - zoomValue);

    return {
      x: Math.min(0, Math.max(minX, nextPan.x)),
      y: Math.min(0, Math.max(minY, nextPan.y)),
    };
  }

  function setMapView(nextZoom, nextPan) {
    const cleanZoom = Number(Math.min(MAP_ZOOM_MAX, Math.max(MAP_ZOOM_MIN, nextZoom)).toFixed(2));
    setMapZoom(cleanZoom);
    setMapPan(clampMapPan(nextPan, cleanZoom));
  }

  function openMapModal(nextMode = "jump") {
    if (!siteMapImage) return alert("No site map image found for this site yet.");
    setMode("preview");
    setMapModalMode(nextMode);
    setMapZoom(1);
    setMapPan({ x: 0, y: 0 });
    setIsMapModalOpen(true);
  }

  function zoomMapAt(delta, clientX, clientY) {
    const viewport = mapViewportRef.current;
    if (!viewport) {
      setMapView(mapZoom + delta, mapPan);
      return;
    }

    const rect = viewport.getBoundingClientRect();
    const nextZoom = Number(Math.min(MAP_ZOOM_MAX, Math.max(MAP_ZOOM_MIN, mapZoom + delta)).toFixed(2));
    if (nextZoom === mapZoom) return;

    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const mapX = (localX - mapPan.x) / mapZoom;
    const mapY = (localY - mapPan.y) / mapZoom;

    setMapView(nextZoom, {
      x: localX - mapX * nextZoom,
      y: localY - mapY * nextZoom,
    });
  }

  function updateMapZoom(delta) {
    const viewport = mapViewportRef.current;
    if (!viewport) {
      setMapView(mapZoom + delta, mapPan);
      return;
    }

    const rect = viewport.getBoundingClientRect();
    zoomMapAt(delta, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  function resetMapZoom() {
    setMapZoom(1);
    setMapPan({ x: 0, y: 0 });
  }

  function handleMapWheel(event) {
    event.preventDefault();
    event.stopPropagation();

    const direction = event.deltaY > 0 ? -1 : 1;
    zoomMapAt(direction * MAP_ZOOM_STEP, event.clientX, event.clientY);
  }

  function handleMapPanMove(event) {
    const gesture = mapPanGestureRef.current;
    if (!gesture.active) return;

    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) gesture.moved = true;

    setMapPan(clampMapPan({
      x: gesture.originX + dx,
      y: gesture.originY + dy,
    }));
  }

  function stopMapPan() {
    const gesture = mapPanGestureRef.current;
    gesture.active = false;
    setIsMapPanning(false);
    window.removeEventListener("mousemove", handleMapPanMove);
    window.removeEventListener("mouseup", stopMapPan);

    window.setTimeout(() => {
      mapPanGestureRef.current.moved = false;
    }, 80);
  }

  function handleMapMouseDown(event) {
    const shouldPan = event.button === 2 || event.button === 1 || (event.button === 0 && event.shiftKey);
    if (!shouldPan) return;

    event.preventDefault();
    event.stopPropagation();

    mapPanGestureRef.current = {
      active: true,
      moved: false,
      startX: event.clientX,
      startY: event.clientY,
      originX: mapPan.x,
      originY: mapPan.y,
    };
    setIsMapPanning(true);

    window.addEventListener("mousemove", handleMapPanMove);
    window.addEventListener("mouseup", stopMapPan);
  }

  function getClickedMapPoint(event) {
    const viewport = mapViewportRef.current;
    if (!viewport) return null;

    const rect = viewport.getBoundingClientRect();
    const mapX = (event.clientX - rect.left - mapPan.x) / mapZoom;
    const mapY = (event.clientY - rect.top - mapPan.y) / mapZoom;

    return {
      x: Number(Math.min(100, Math.max(0, (mapX / rect.width) * 100)).toFixed(2)),
      y: Number(Math.min(100, Math.max(0, (mapY / rect.height) * 100)).toFixed(2)),
    };
  }

  function findClosestSceneByMapPoint(point) {
    if (!point) return null;
    return scenes
      .map((scene) => ({ scene, point: getSceneMapPoint(scene) }))
      .filter((item) => item.point && tour?.scenes?.[item.scene?.id])
      .map((item) => {
        const dx = normalizeAdminNumber(item.point.x, 50) - point.x;
        const dy = normalizeAdminNumber(item.point.y, 50) - point.y;
        return { ...item, distance: Math.sqrt(dx * dx + dy * dy) };
      })
      .sort((a, b) => a.distance - b.distance)[0]?.scene || null;
  }

  function handleMapPlacementClick(event) {
    if (!selectedScene?.id) return;
    if (event.button !== 0) return;
    if (mapPanGestureRef.current.moved) return;

    const point = getClickedMapPoint(event);
    if (!point) return;

    if (mapModalMode === "place") {
      const nextScene = { ...selectedScene, mapPoint: point, minimap: point };
      saveTour({ ...tour, scenes: { ...tour.scenes, [selectedScene.id]: nextScene } }, `Map dot saved at ${point.x}, ${point.y}`);
      setMapModalMode("jump");
      return;
    }

    const closestScene = findClosestSceneByMapPoint(point);
    if (closestScene?.id) {
      goToScene(closestScene.id);
    }
  }

  return (
    <div className="admin-config-page-v2">
      <header className="admin-config-topbar-v2">
        <div className="admin-config-topbar-brand-v2">
          <div className="admin-config-logo-v2">360</div>
          <div><span>Street View Admin</span><strong>Location Configuration</strong></div>
        </div>
        <div className="admin-config-topbar-meta-v2">
          <div><span>Site</span><strong>{site?.name || siteId}</strong></div>
          <div><span>Area</span><strong>{area?.name || areaId}</strong></div>
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
            <input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Search image name..." />
          </label>

          <button type="button" className="admin-config-add-card-v2" onClick={() => setIsAddOpen(true)}>
            <b>+</b><div><strong>Add 360 Images</strong><small>Batch upload panoramas</small></div>
          </button>

          <div className="admin-config-rail-title-v2"><span>Uploaded Images</span><strong>{scenes.length}</strong></div>

          <div className="admin-config-text-location-list-v2">
            {filteredScenes.length === 0 ? <div className="admin-config-empty-list-v2">No image names match your search.</div> : visibleScenes.map((scene, index) => {
              const isActive = selectedScene?.id === scene.id;
              const isMapped = !!getSceneMapPoint(scene);
              const linkCount = getSceneLinkCount(scene);
              const machineCount = getSceneMachineAreaCount(scene);
              return (
                <button key={scene.id} type="button" className={`admin-config-location-row-v2 ${isActive ? "active" : ""}`} onClick={() => { setSelectedSceneId(scene.id); setMode("preview"); setPendingTargetSceneId(null); setMachineAreaDraftPoints([]); }}>
                  <span className="admin-config-location-index-v2">{String(index + 1).padStart(2, "0")}</span>
                  <strong>{getSceneTitle(scene)}</strong>
                  <span className="admin-config-location-badges-v2">
                    {isMapped && <em>MAP</em>}
                    {linkCount > 0 && <em>{linkCount} LINK{linkCount > 1 ? "S" : ""}</em>}
                    {machineCount > 0 && <em>{machineCount} MACHINE{machineCount > 1 ? "S" : ""}</em>}
                  </span>
                </button>
              );
            })}

            {visibleCount < filteredScenes.length && (
              <button type="button" className="admin-config-load-more-v2" onClick={() => setVisibleCount((current) => current + CARD_PAGE_SIZE)}>
                Load more ({filteredScenes.length - visibleCount} left)
              </button>
            )}
          </div>
        </aside>

        <section className="admin-config-center-stage-v2">
          <div className="admin-config-stage-header-v2">
            <strong>{selectedScene ? getSceneTitle(selectedScene) : "No image selected"}</strong>
            <div className="admin-config-stage-right-v2">
              {saveMessage && <span className="admin-config-save-flash-v2">{saveMessage}</span>}
              {mode === "mark-machine-area" && (
                <div className="machine-area-draft-toolbar">
                  <button type="button" onClick={undoMachineAreaPoint} disabled={!machineAreaDraftPoints.length}>Undo</button>
                  <button type="button" className="primary" onClick={finishMachineAreaDraft} disabled={machineAreaDraftPoints.length < 3}>Finish</button>
                </div>
              )}
              {mode === "mark-location" && pendingTargetScene && (
                <div className="admin-config-mode-pill-v2 active">
                  {`Click direction toward ${getSceneTitle(pendingTargetScene)}`}
                </div>
              )}
            </div>
          </div>

          <div className="admin-config-main-preview-v2">
            <PannellumStage
              image={selectedImage}
              scene={selectedScene}
              scenesById={scenesById}
              isPicking={mode === "mark-location" || mode === "mark-machine-area"}
              pickLabel={
                mode === "mark-machine-area"
                  ? `Click safety area corners (${machineAreaDraftPoints.length} point(s))`
                  : mode === "mark-location" && pendingTargetScene
                    ? `Click direction toward ${getSceneTitle(pendingTargetScene)}`
                    : "Click inside the panorama"
              }
              onPickPoint={handlePanoPick}
              onGoToScene={goToScene}
              machineDraftPoints={machineAreaDraftPoints}
              machineAreas={selectedMachineAreas}
              onEditMachineArea={openMachineAreaEditor}
              onRemoveMachineArea={removeMachineArea}
              isDirectionPicking={mode === "mark-location"}
              directionTargetTitle={pendingTargetScene ? getSceneTitle(pendingTargetScene) : ""}
            />
          </div>

          <div className="admin-config-preview-actions-bar-v2 compact-three-actions">
            <div className="admin-action-menu-wrap">
              <button
                type="button"
                onClick={() => setIsMarkingsMenuOpen((current) => !current)}
                disabled={!selectedScene}
                className={isMarkingsMenuOpen ? "active" : ""}
              >
                Markings
              </button>
              {isMarkingsMenuOpen && (
                <div className="admin-action-menu">
                  <button type="button" onClick={() => { setIsMarkingsMenuOpen(false); openMapModal("jump"); }} disabled={!selectedScene}>Map Area</button>
                  <button type="button" onClick={() => { setIsMarkingsMenuOpen(false); setIsLocationManagerOpen(true); }} disabled={!selectedScene}>Mark Area</button>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={openMachineAreaPicker}
              disabled={!selectedScene}
              className={mode === "mark-machine-area" ? "active" : ""}
            >
              {mode === "mark-machine-area" ? "Cancel Safety" : "Safety"}
            </button>
            <button type="button" className="danger" onClick={deleteSelectedLocation} disabled={!selectedScene}>Delete</button>
          </div>
        </section>
      </main>

      {isAddOpen && (
        <div className="admin-config-modal-backdrop-v2" onMouseDown={() => !isSaving && setIsAddOpen(false)}>
          <form className="admin-config-add-modal-v2" onMouseDown={(event) => event.stopPropagation()} onSubmit={handleAddLocation}>
            <div className="admin-config-modal-header-v2"><div><span>Add Location</span><strong>Upload 360 image batch</strong></div><button type="button" disabled={isSaving} onClick={() => setIsAddOpen(false)}>×</button></div>

            <label className="admin-config-form-field-v2">
              <span>Location Name</span>
              <input value={newLocationName} onChange={(event) => setNewLocationName(event.target.value)} placeholder="Used only when uploading one image" disabled={isSaving} />
            </label>

            <label className="admin-config-upload-box-v2">
              <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleFileSelect} disabled={isSaving} />
              <b>{newLocationFiles.length ? `${newLocationFiles.length} image(s) selected` : "Choose 360 Images"}</b>
              <span>Batch upload JPG, PNG, WEBP panoramas</span>
            </label>

            {uploadProgress && (
              <div className="admin-config-upload-progress-v2">
                <strong>Uploading {uploadProgress.current} / {uploadProgress.total}</strong>
                <span>{uploadProgress.name}</span>
                <div><i style={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%` }} /></div>
              </div>
            )}

            <div className="admin-config-modal-actions-v2">
              <button type="button" disabled={isSaving} onClick={() => setIsAddOpen(false)}>Cancel</button>
              <button type="submit" className="primary" disabled={isSaving}>{isSaving ? "Uploading..." : "Add Image(s)"}</button>
            </div>
          </form>
        </div>
      )}

      {isMachineModalOpen && (
        <div className="admin-config-modal-backdrop-v2" onMouseDown={() => !isSaving && cancelMachineAreaDraft()}>
          <form className="admin-config-add-modal-v2 machine-area-modal" onMouseDown={(event) => event.stopPropagation()} onSubmit={saveMachineArea}>
            <div className="admin-config-modal-header-v2">
              <div><span>Safety Area</span><strong>{editingMachineAreaId ? "Edit information or area shape" : "Add information first, then mark the area"}</strong></div>
              <button type="button" disabled={isSaving} onClick={cancelMachineAreaDraft}>×</button>
            </div>

            <div className="machine-area-point-summary">
              <strong>{machineAreaDraftPoints.length}</strong> marked point{machineAreaDraftPoints.length === 1 ? "" : "s"}. Fill the fields, then click Mark Area whenever you are ready.
            </div>

            {selectedMachineAreas.length > 0 && (
              <section className="machine-area-saved-list">
                <div className="machine-area-saved-list-head">
                  <div>
                    <span>Marked Entries</span>
                    <strong>{selectedMachineAreas.length} saved</strong>
                  </div>
                  <button type="button" onClick={startNewMachineAreaForm}>New</button>
                </div>

                <div className="machine-area-saved-items">
                  {selectedMachineAreas.map((machineArea, index) => {
                    const isEditing = editingMachineAreaId === machineArea.id;
                    const points = getMachineAreaPoints(machineArea).length;
                    return (
                      <article key={machineArea.id || index} className={`machine-area-saved-item ${isEditing ? "is-editing" : ""}`}>
                        <button type="button" className="machine-area-saved-main" onClick={() => openMachineAreaEditor(machineArea)}>
                          <b>{String(index + 1).padStart(2, "0")}</b>
                          <div>
                            <strong>{getMachineAreaTitle(machineArea)}</strong>
                            <span>{machineArea.hazard || machineArea.safetyNote || `${points} point${points === 1 ? "" : "s"}`}</span>
                          </div>
                        </button>
                        <button type="button" onClick={() => openMachineAreaEditor(machineArea)}>{isEditing ? "Editing" : "Edit"}</button>
                        <button type="button" className="danger" onClick={() => removeMachineArea(machineArea.id)}>Delete</button>
                      </article>
                    );
                  })}
                </div>
              </section>
            )}

            <label className="admin-config-form-field-v2">
              <span>Name</span>
              <input value={machineForm.machineName} onChange={(event) => setMachineForm((current) => ({ ...current, machineName: event.target.value }))} placeholder="Example: Mespack Door / Guard Door / Conveyor Section" autoFocus />
            </label>

            <label className="admin-config-form-field-v2">
              <span>Category</span>
              <input value={machineForm.machineType} onChange={(event) => setMachineForm((current) => ({ ...current, machineType: event.target.value }))} placeholder="Example: Cartoner / Conveyor / Filler" />
            </label>

            <label className="admin-config-form-field-v2">
              <span>Hazard</span>
              <input value={machineForm.hazard} onChange={(event) => setMachineForm((current) => ({ ...current, hazard: event.target.value }))} placeholder="Example: Moving parts / pinch point" />
            </label>

            <label className="admin-config-form-field-v2">
              <span>Safety</span>
              <textarea value={machineForm.safetyNote} onChange={(event) => setMachineForm((current) => ({ ...current, safetyNote: event.target.value }))} placeholder="Example: Do not open door while machine is running." />
            </label>

            <label className="admin-config-form-field-v2">
              <span>Note</span>
              <textarea value={machineForm.description} onChange={(event) => setMachineForm((current) => ({ ...current, description: event.target.value }))} placeholder="Add another item shown on hover." />
            </label>

            <div className="machine-area-file-grid">
              <label className="admin-config-upload-box-v2 compact">
                <input type="file" accept="image/*" onChange={(event) => setMachineImageFile(event.target.files?.[0] || null)} disabled={isSaving} />
                <b>{machineImageFile ? machineImageFile.name : machineForm.image ? "Current image saved" : "Optional Image"}</b>
                <span>Shown in the popup/card</span>
              </label>

              <label className="admin-config-upload-box-v2 compact">
                <input type="file" accept="image/*" onChange={(event) => setMachineHoverImageFile(event.target.files?.[0] || null)} disabled={isSaving} />
                <b>{machineHoverImageFile ? machineHoverImageFile.name : machineForm.hoverImage ? "Current hover image saved" : "Optional Hover Image"}</b>
                <span>Shown when the marked area is hovered</span>
              </label>
            </div>

            <div className="admin-config-modal-actions-v2">
              <button type="button" disabled={isSaving} onClick={cancelMachineAreaDraft}>Cancel</button>
              <button type="button" disabled={isSaving} onClick={() => startMachineAreaPick({ reset: true })}>{machineAreaDraftPoints.length ? "Re-mark Area" : "Mark Area"}</button>
              <button type="submit" className="primary" disabled={isSaving}>{isSaving ? "Saving..." : editingMachineAreaId ? "Update Safety Area" : "Save Safety Area"}</button>
            </div>
          </form>
        </div>
      )}

      {isLocationManagerOpen && (
        <div className="admin-config-modal-backdrop-v2" onMouseDown={() => setIsLocationManagerOpen(false)}>
          <section className="admin-config-link-modal-v2 direction-link-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="admin-config-modal-header-v2">
              <div><span>Mark Area</span><strong>Choose panorama, then pick direction</strong></div>
              <button type="button" onClick={() => setIsLocationManagerOpen(false)}>×</button>
            </div>

            <div className="direction-marking-instructions">
              <strong>New marking logic</strong>
              <span>Click Add beside the destination panorama. Then click only the direction in the 360 image. The arrow will stay near the standing point instead of exactly where you clicked.</span>
            </div>

            <div className="admin-config-text-target-list-v2 direction-panorama-list">
              {linkTargetScenes.map((scene, index) => {
                const existingHotspot = selectedHotspots.find((hotspot) => hotspot?.targetSceneId === scene.id);
                return (
                  <div key={scene.id} className="direction-panorama-row">
                    <button type="button" className="admin-config-target-row-v2" onClick={() => chooseTargetScene(scene.id)}>
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <strong>{getSceneTitle(scene)}</strong>
                      <em>{existingHotspot ? "Relocate" : "Add"}</em>
                    </button>
                    {existingHotspot && (
                      <button type="button" className="direction-remove-link" onClick={() => removeHotspot(existingHotspot.id)}>Remove</button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      )}

      {isMapModalOpen && (
        <div className="admin-config-modal-backdrop-v2" onMouseDown={() => setIsMapModalOpen(false)}>
          <section className="admin-config-map-modal-v2" onMouseDown={(event) => event.stopPropagation()}>
            <div className="admin-config-modal-header-v2">
              <div><span>Map Area</span><strong>{mapModalMode === "place" ? `Place ${getSceneTitle(selectedScene)}` : "Click anywhere to jump to closest location"}</strong></div>
              <button type="button" onClick={() => setIsMapModalOpen(false)}>×</button>
            </div>

            <div className="admin-config-map-toolbar-v2">
              <p className="admin-config-map-help-v2">Scroll to zoom. Right click-drag to move. Click anywhere to jump to the closest marked location, or press Add/Update to place the selected location.</p>
              <div className="admin-config-map-zoom-controls-v2">
                <button type="button" onClick={() => updateMapZoom(-MAP_ZOOM_STEP)} disabled={mapZoom <= MAP_ZOOM_MIN}>−</button>
                <span>{Math.round(mapZoom * 100)}%</span>
                <button type="button" onClick={() => updateMapZoom(MAP_ZOOM_STEP)} disabled={mapZoom >= MAP_ZOOM_MAX}>+</button>
                <button type="button" onClick={resetMapZoom}>Reset</button>
                <button type="button" className={mapModalMode === "place" ? "primary" : ""} onClick={(event) => { event.stopPropagation(); setMapModalMode("place"); }}>Add/Update Selected Mark</button>
                {getSceneMapPoint(selectedScene) && (
                  <button type="button" className="danger" onClick={(event) => { event.stopPropagation(); removeMapPoint(); setMapModalMode("jump"); }}>Remove Selected Mark</button>
                )}
              </div>
            </div>

            <div
              ref={mapViewportRef}
              className={`admin-config-map-viewport-v2 ${isMapPanning ? "is-panning" : ""}`}
              onWheel={handleMapWheel}
              onMouseDown={handleMapMouseDown}
              onContextMenu={(event) => event.preventDefault()}
            >
              <div
                className="admin-config-map-canvas-v2"
                style={{
                  "--admin-map-zoom": mapZoom,
                  transform: `translate(${mapPan.x}px, ${mapPan.y}px) scale(${mapZoom})`,
                }}
                onClick={handleMapPlacementClick}
              >
                <img src={siteMapImage} alt={site?.name || siteId} draggable="false" />
                {area?.points && <svg className="admin-config-map-area-overlay-v2" viewBox="0 0 100 100" preserveAspectRatio="none"><polygon points={area.points} /></svg>}
                {scenes.map((scene) => {
                  const point = getSceneMapPoint(scene);
                  if (!point) return null;
                  return (
                    <button
                      key={scene.id}
                      type="button"
                      className={`admin-config-site-dot-v2 ${scene.id === selectedScene?.id ? "is-selected" : ""}`}
                      style={{ left: `${point.x}%`, top: `${point.y}%` }}
                      title={getSceneTitle(scene)}
                      onClick={(event) => { event.stopPropagation(); goToScene(scene.id); }}
                    />
                  );
                })}
              </div>
            </div>
          </section>
        </div>
      )}

      {isLinkModalOpen && (
        <div className="admin-config-modal-backdrop-v2" onMouseDown={() => setIsLinkModalOpen(false)}>
          <section className="admin-config-link-modal-v2" onMouseDown={(event) => event.stopPropagation()}>
            <div className="admin-config-modal-header-v2"><div><span>Mark Location</span><strong>Choose destination image</strong></div><button type="button" onClick={() => setIsLinkModalOpen(false)}>×</button></div>
            <div className="admin-config-text-target-list-v2">
              {linkTargetScenes.map((scene, index) => {
                const alreadyMarked = selectedHotspots.some((hotspot) => hotspot?.targetSceneId === scene.id);
                return (
                  <button key={scene.id} type="button" className="admin-config-target-row-v2" onClick={() => chooseTargetScene(scene.id)}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
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
