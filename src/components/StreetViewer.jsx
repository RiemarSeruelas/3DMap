import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import "pannellum/build/pannellum.css";
import "pannellum";
import "../styles/admin.css";

const MAP_WORLD_WIDTH = 520;
const MAP_WORLD_HEIGHT = 292.5;
const MAP_WINDOW_WIDTH = 310;
const MAP_WINDOW_HEIGHT = 175;
const POPUP_HOVER_RELEASE_DELAY = 900;
const POPUP_INTERACTION_PADDING = 96;

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
      }),
    );
}

function getFirstSceneId(mapData) {
  const alphabeticalScenes = getAlphabeticalSceneList(mapData);
  return (
    alphabeticalScenes[0]?.id ||
    mapData?.settings?.firstScene ||
    mapData?.firstScene ||
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
      const relativeYaw = normalizeYaw(
        normalizeNumber(hotspotYaw, 0) - currentYaw,
      );
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

  if (
    cleanValue.startsWith("/uploads/") ||
    cleanValue.startsWith("/data/") ||
    cleanValue === "/streetview-data.json"
  ) {
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
      0,
  );
}

function toWorldYaw(sceneYaw, scene) {
  return normalizeYaw(
    normalizeNumber(sceneYaw, 0) + getSceneNorthOffset(scene),
  );
}

function toSceneYaw(worldYaw, scene) {
  return normalizeYaw(
    normalizeNumber(worldYaw, 0) - getSceneNorthOffset(scene),
  );
}

function xyToYawPitch(hotspot = {}) {
  const hasYawPitch =
    Number.isFinite(Number(hotspot.yaw)) &&
    Number.isFinite(Number(hotspot.pitch));
  const hasXY =
    Number.isFinite(Number(hotspot.x)) && Number.isFinite(Number(hotspot.y));

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

  const hotspotTargets = new Set(
    sceneHotspotConnections.map((connection) => connection.to),
  );

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
  return resolveAssetUrl(
    site?.mapImage ||
      area?.mapImage ||
      mapData?.mapImage ||
      mapData?.siteMapImage ||
      mapData?.areaMapImage ||
      null,
  );
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
  return Array.isArray(area.points)
    ? area.points.filter(
        (point) =>
          Number.isFinite(Number(point.pitch)) &&
          Number.isFinite(Number(point.yaw)),
      )
    : [];
}

function getMachineAreaMode(area = {}) {
  return area.mode === "tutor" ? "tutor" : "safety";
}

function getPopupAreaPoint(popup = {}) {
  return popup.popupArea || popup.areaPoint || popup.position || popup;
}

function getPopupArrowPoint(popup = {}) {
  return popup.arrowPoint || popup.pointerPoint || popup.targetPoint || null;
}

function hasPopupPoint(point) {
  return (
    Number.isFinite(Number(point?.pitch)) &&
    Number.isFinite(Number(point?.yaw))
  );
}

function getSafetyPopups(area = {}) {
  return Array.isArray(area.safetyPopups)
    ? area.safetyPopups.filter((popup) =>
        hasPopupPoint(getPopupAreaPoint(popup)),
      )
    : [];
}

function getSceneSafetyPopups(scene = {}) {
  const directPopups = getSafetyPopups(scene);
  const legacyPopups = Array.isArray(scene.machineAreas)
    ? scene.machineAreas.flatMap((machineArea) => getSafetyPopups(machineArea))
    : [];
  const seen = new Set();

  return [...directPopups, ...legacyPopups].filter((popup) => {
    const key = popup?.id || `${popup?.title || "popup"}-${popup?.yaw}-${popup?.pitch}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function unwrapYawAround(yaw, referenceYaw) {
  let value = normalizeYaw(yaw);
  const reference = normalizeYaw(referenceYaw);
  while (value - reference > 180) value -= 360;
  while (value - reference < -180) value += 360;
  return value;
}

function isPointInsideMachineArea(point, machineArea) {
  if (!hasPopupPoint(point)) return false;
  const points = getMachineAreaPoints(machineArea);
  if (points.length < 3) return false;

  const pointYaw = normalizeYaw(point.yaw);
  const pointPitch = normalizeNumber(point.pitch, 0);
  const polygon = points.map((polygonPoint) => ({
    x: unwrapYawAround(polygonPoint.yaw, pointYaw),
    y: normalizeNumber(polygonPoint.pitch, 0),
  }));

  let inside = false;
  for (let currentIndex = 0, previousIndex = polygon.length - 1;
    currentIndex < polygon.length;
    previousIndex = currentIndex, currentIndex += 1) {
    const current = polygon[currentIndex];
    const previous = polygon[previousIndex];
    const crosses =
      current.y > pointPitch !== previous.y > pointPitch &&
      pointYaw <
        ((previous.x - current.x) * (pointPitch - current.y)) /
          (previous.y - current.y || Number.EPSILON) +
          current.x;
    if (crosses) inside = !inside;
  }

  return inside;
}

function getPointDistanceToMachineArea(point, machineArea) {
  if (!hasPopupPoint(point)) return Number.POSITIVE_INFINITY;
  const pointYaw = normalizeYaw(point.yaw);
  const pointPitch = normalizeNumber(point.pitch, 0);
  const points = getMachineAreaPoints(machineArea);
  if (!points.length) return Number.POSITIVE_INFINITY;

  return Math.min(
    ...points.map((areaPoint) => {
      const yawDistance = unwrapYawAround(areaPoint.yaw, pointYaw) - pointYaw;
      const pitchDistance = normalizeNumber(areaPoint.pitch, 0) - pointPitch;
      return Math.hypot(yawDistance, pitchDistance);
    }),
  );
}

function getPopupMachineAreaId(popup, machineAreas = []) {
  const explicitId = popup?.machineAreaId || popup?.safetyAreaId || null;
  if (explicitId && machineAreas.some((machineArea) => machineArea.id === explicitId)) {
    return explicitId;
  }

  const popupPoint = getPopupAreaPoint(popup);
  const popupArea = machineAreas.find((machineArea) =>
    isPointInsideMachineArea(popupPoint, machineArea),
  );

  if (popupArea?.id) return popupArea.id;

  const arrowPoint = getPopupArrowPoint(popup);
  const targetPoint = hasPopupPoint(arrowPoint) ? arrowPoint : popupPoint;
  const matchedArea = machineAreas.find((machineArea) =>
    isPointInsideMachineArea(targetPoint, machineArea),
  );

  if (matchedArea?.id) return matchedArea.id;

  const nearestArea = [...machineAreas].sort(
    (firstArea, secondArea) =>
      getPointDistanceToMachineArea(targetPoint, firstArea) -
      getPointDistanceToMachineArea(targetPoint, secondArea),
  )[0];

  return nearestArea?.id || null;
}

function getMachineAreaTitle(area = {}) {
  return area.machineName || area.name || "Machine Area";
}

function getMachineAreaPurpose(area = {}, mode = getMachineAreaMode(area)) {
  if (mode === "safety") {
    return (
      area.safetyPurpose ||
      (area.mode === "safety" ? area.purpose : "") ||
      ""
    );
  }

  return (
    area.tutorPurpose ||
    (area.mode === "tutor" ? area.purpose : "") ||
    area.description ||
    area.machineType ||
    ""
  );
}

function projectPanoPointToScreen(point, viewer, element) {
  if (!point || !viewer || !element) return null;

  const width =
    element.clientWidth || element.getBoundingClientRect().width || 1;
  const height =
    element.clientHeight || element.getBoundingClientRect().height || 1;
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

  const screenX =
    width / 2 + ((width / 2) * (relX / relZ)) / Math.tan(hFovRad / 2);
  const screenY =
    height / 2 - ((height / 2) * (relY / relZ)) / Math.tan(vFovRad / 2);

  return { x: Number(screenX.toFixed(1)), y: Number(screenY.toFixed(1)) };
}

function getProjectedSafetyPopup(popup, viewer, element) {
  if (!viewer || !element) return null;
  const boxPosition = projectPanoPointToScreen(
    getPopupAreaPoint(popup),
    viewer,
    element,
  );
  if (!boxPosition) return null;

  const arrowPoint = getPopupArrowPoint(popup);
  const arrowPosition = hasPopupPoint(arrowPoint)
    ? projectPanoPointToScreen(arrowPoint, viewer, element)
    : null;

  return { boxPosition, arrowPosition };
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
        x:
          screenPoints.reduce((sum, point) => sum + point.x, 0) /
          screenPoints.length,
        y:
          screenPoints.reduce((sum, point) => sum + point.y, 0) /
          screenPoints.length,
      };

      const xValues = screenPoints.map((point) => point.x);
      const yValues = screenPoints.map((point) => point.y);
      const minX = Math.min(...xValues);
      const maxX = Math.max(...xValues);
      const minY = Math.min(...yValues);
      const maxY = Math.max(...yValues);

      return {
        area: machineArea,
        id: machineArea.id || getMachineAreaTitle(machineArea),
        points: screenPoints,
        pointsAttr: screenPoints
          .map((point) => `${point.x},${point.y}`)
          .join(" "),
        center,
        bounds: {
          x: minX,
          y: minY,
          width: Math.max(1, maxX - minX),
          height: Math.max(1, maxY - minY),
        },
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
  const machinePolygonRefs = useRef(new Map());
  const machineClipRefs = useRef(new Map());
  const machineImageRefs = useRef(new Map());
  const popupBoxRefs = useRef(new Map());
  const popupLineRefs = useRef(new Map());
  const popupArrowRefs = useRef(new Map());
  const projectedMachineBoundsRef = useRef(new Map());
  const popupInteractionZonesRef = useRef(new Map());
  const hoveredMachineAreaIdRef = useRef(null);
  const hoveredPopupIdRef = useRef(null);
  const hoverLeaveTimerRef = useRef(null);
  const hoverReleaseClearPopupRef = useRef(false);
  const lastPointerPositionRef = useRef({ x: null, y: null });
  const popupDragRef = useRef({
    active: false,
    pointerId: null,
    node: null,
    startX: 0,
    startY: 0,
    startYaw: 0,
    startPitch: 0,
  });
  const machineAreaDragRef = useRef({
    active: false,
    moved: false,
    pointerId: null,
    node: null,
    startX: 0,
    startY: 0,
    startYaw: 0,
    startPitch: 0,
  });
  const suppressMachineAreaClickRef = useRef(false);

  const requestedSceneId = searchParams.get("scene");

  const scenes = useMemo(() => safeScenes(mapData), [mapData]);
  const sceneList = useMemo(() => getAlphabeticalSceneList(mapData), [mapData]);
  const requestedSceneExists = requestedSceneId && scenes[requestedSceneId];

  const [currentSceneId, setCurrentSceneId] = useState(
    () => requestedSceneId || getFirstSceneId(mapData),
  );
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [viewerMode, setViewerMode] = useState("tutor");
  const [selectedMachineArea, setSelectedMachineArea] = useState(null);
  const [hoveredMachineAreaId, setHoveredMachineAreaId] = useState(null);
  const [hoveredPopupId, setHoveredPopupId] = useState(null);

  const currentScene = scenes[currentSceneId] || sceneList[0];
  const currentSceneIdResolved = currentScene?.id || currentSceneId;
  const currentPanorama = resolveAssetUrl(currentScene?.panorama);
  const mapImage = getMapImage(mapData, site, area);
  const machineAreas = useMemo(
    () =>
      Array.isArray(currentScene?.machineAreas)
        ? currentScene.machineAreas.filter(
            (machineArea) => getMachineAreaMode(machineArea) === viewerMode,
          )
        : [],
    [currentScene, viewerMode],
  );
  const sceneSafetyPopups = useMemo(
    () => getSceneSafetyPopups(currentScene),
    [currentScene],
  );

  const sceneConnections = useMemo(
    () => getSceneConnections(mapData, currentSceneIdResolved),
    [mapData, currentSceneIdResolved],
  );

  function showMachineArea(machineArea) {
    setSelectedMachineArea((current) =>
      current?.id === machineArea?.id ? null : machineArea,
    );
  }

  function clearHoverLeaveTimer() {
    if (hoverLeaveTimerRef.current) {
      window.clearTimeout(hoverLeaveTimerRef.current);
      hoverLeaveTimerRef.current = null;
    }
    hoverReleaseClearPopupRef.current = false;
  }

  function rememberPointerPosition(event) {
    if (!event) return;
    lastPointerPositionRef.current = {
      x: Number.isFinite(Number(event.clientX)) ? Number(event.clientX) : null,
      y: Number.isFinite(Number(event.clientY)) ? Number(event.clientY) : null,
    };
  }

  function setHoveredMachineAreaSafe(machineAreaId, event) {
    rememberPointerPosition(event);
    clearHoverLeaveTimer();
    setHoveredMachineAreaId(machineAreaId);
  }

  function getElementUnderLastPointer() {
    const { x, y } = lastPointerPositionRef.current;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return document.elementFromPoint(x, y);
  }

  function isPointerInsideLinkedZone(activeAreaId) {
    if (!activeAreaId) return false;

    const shell = shellRef.current;
    const { x: clientX, y: clientY } = lastPointerPositionRef.current;
    if (!shell || !Number.isFinite(clientX) || !Number.isFinite(clientY)) {
      return false;
    }

    const rect = shell.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    return sceneSafetyPopups.some((popup) => {
      if (getPopupMachineAreaId(popup, machineAreas) !== activeAreaId) {
        return false;
      }

      return isInsideInteractionZone(
        x,
        y,
        popupInteractionZonesRef.current.get(popup.id),
      );
    });
  }

  function scheduleHoverRelease({ clearPopup = false } = {}) {
    hoverReleaseClearPopupRef.current =
      hoverReleaseClearPopupRef.current || clearPopup;
    if (hoverLeaveTimerRef.current) return;

    hoverLeaveTimerRef.current = window.setTimeout(() => {
      const activeAreaId = hoveredMachineAreaIdRef.current;
      const target = getElementUnderLastPointer();
      const popupTarget = target?.closest?.(".viewer-safety-popup-marker");
      const machineTarget = target?.closest?.(".machine-area-screen-polygon");
      const pointerStillLinked = isPointerInsideLinkedZone(activeAreaId);

      if (popupTarget) {
        const popupId = popupTarget.dataset.popupId;
        if (popupId) setHoveredPopupId(popupId);
        hoverReleaseClearPopupRef.current = false;
        hoverLeaveTimerRef.current = null;
        return;
      }

      if (machineTarget) {
        const machineAreaId = machineTarget.dataset.machineAreaId;
        if (machineAreaId) setHoveredMachineAreaId(machineAreaId);
        hoverReleaseClearPopupRef.current = false;
        hoverLeaveTimerRef.current = null;
        return;
      }

      if (pointerStillLinked) {
        hoverReleaseClearPopupRef.current = false;
        hoverLeaveTimerRef.current = null;
        return;
      }

      setHoveredMachineAreaId(null);
      if (hoverReleaseClearPopupRef.current) setHoveredPopupId(null);
      hoverReleaseClearPopupRef.current = false;
      hoverLeaveTimerRef.current = null;
    }, POPUP_HOVER_RELEASE_DELAY);
  }

  function releaseHoveredMachineArea(event) {
    rememberPointerPosition(event);
    if (machineAreaDragRef.current.active) return;
    scheduleHoverRelease();
  }

  function enterSafetyPopup(popupId, event) {
    rememberPointerPosition(event);
    clearHoverLeaveTimer();
    setHoveredPopupId(popupId);
  }

  function leaveSafetyPopup(event) {
    rememberPointerPosition(event);
    if (popupDragRef.current.active) return;
    scheduleHoverRelease({ clearPopup: true });
  }


  function isInsideInteractionZone(x, y, zone) {
    return (
      zone &&
      x >= zone.left &&
      x <= zone.right &&
      y >= zone.top &&
      y <= zone.bottom
    );
  }

  function handleViewerPointerMove(event) {
    rememberPointerPosition(event);
    if (viewerMode !== "safety") return;

    const activeAreaId = hoveredMachineAreaIdRef.current;
    if (!activeAreaId) return;

    const shell = shellRef.current;
    if (!shell) return;

    const rect = shell.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const insideLinkedZone = sceneSafetyPopups.some((popup) => {
      if (getPopupMachineAreaId(popup, machineAreas) !== activeAreaId) {
        return false;
      }

      return isInsideInteractionZone(
        x,
        y,
        popupInteractionZonesRef.current.get(popup.id),
      );
    });

    if (insideLinkedZone || hoveredPopupIdRef.current) {
      clearHoverLeaveTimer();
      return;
    }

    scheduleHoverRelease({ clearPopup: true });
  }

  function handleViewerPointerLeave(event) {
    rememberPointerPosition(event);
    if (viewerMode === "safety") {
      scheduleHoverRelease({ clearPopup: true });
    }
  }

  function handlePopupWheel(event) {
    const viewer = pannellumInstanceRef.current;
    if (!viewer?.getHfov || !viewer?.setHfov) return;

    event.preventDefault();
    event.stopPropagation();
    clearHoverLeaveTimer();

    const wheelEvent = event.nativeEvent || event;
    const multiplier =
      wheelEvent.deltaMode === 1
        ? 16
        : wheelEvent.deltaMode === 2
          ? window.innerHeight
          : 1;
    const delta = normalizeNumber(wheelEvent.deltaY, 0) * multiplier;
    if (!delta) return;

    const currentHfov = normalizeNumber(viewer.getHfov(), 100);
    const zoomStep = clamp(Math.abs(delta) * 0.045, 1.5, 10);
    const nextHfov =
      delta > 0 ? currentHfov + zoomStep : currentHfov - zoomStep;

    viewer.setHfov(clamp(nextHfov, 35, 120), false);
  }

  function beginViewerDrag(event, dragRef, node) {
    if (event.button !== 0) return false;

    const viewer = pannellumInstanceRef.current;
    if (!viewer?.getYaw || !viewer?.getPitch) return false;

    dragRef.current = {
      active: true,
      moved: false,
      pointerId: event.pointerId,
      node,
      startX: event.clientX,
      startY: event.clientY,
      startYaw: normalizeNumber(viewer.getYaw(), 0),
      startPitch: normalizeNumber(viewer.getPitch(), 0),
    };

    node?.setPointerCapture?.(event.pointerId);
    node?.classList.add("is-dragging");
    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  function moveViewerDrag(event, dragRef) {
    const drag = dragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return false;

    const viewer = pannellumInstanceRef.current;
    const element = viewerRef.current;
    if (!viewer || !element) return false;

    const width = Math.max(1, element.clientWidth);
    const height = Math.max(1, element.clientHeight);
    const hfov = clamp(normalizeNumber(viewer.getHfov?.(), 100), 35, 120);
    const horizontalRadians = (hfov * Math.PI) / 180;
    const verticalRadians =
      2 * Math.atan(Math.tan(horizontalRadians / 2) / (width / height));
    const verticalFov = (verticalRadians * 180) / Math.PI;
    const yawPerPixel = hfov / width;
    const pitchPerPixel = verticalFov / height;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;

    if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
      drag.moved = true;
    }

    viewer.setYaw?.(normalizeYaw(drag.startYaw - deltaX * yawPerPixel), false);
    viewer.setPitch?.(
      clamp(drag.startPitch + deltaY * pitchPerPixel, -85, 85),
      false,
    );

    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  function endViewerDrag(event, dragRef) {
    const drag = dragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return null;

    drag.node?.releasePointerCapture?.(event.pointerId);
    drag.node?.classList.remove("is-dragging");

    const result = { moved: drag.moved, node: drag.node };
    dragRef.current = {
      active: false,
      moved: false,
      pointerId: null,
      node: null,
      startX: 0,
      startY: 0,
      startYaw: 0,
      startPitch: 0,
    };

    event.preventDefault();
    event.stopPropagation();
    return result;
  }

  function handleMachineAreaPointerDown(event, machineAreaId) {
    clearHoverLeaveTimer();
    setHoveredMachineAreaId(machineAreaId);
    beginViewerDrag(event, machineAreaDragRef, event.currentTarget);
  }

  function handleMachineAreaPointerMove(event) {
    moveViewerDrag(event, machineAreaDragRef);
  }

  function finishMachineAreaPointerDrag(event) {
    const dragNode = machineAreaDragRef.current.node;
    const result = endViewerDrag(event, machineAreaDragRef);
    if (!result) return;

    const pointerTarget = document.elementFromPoint(event.clientX, event.clientY);
    const remainsInsideArea = Boolean(
      dragNode && pointerTarget && dragNode.contains(pointerTarget),
    );

    if (result.moved) {
      suppressMachineAreaClickRef.current = true;
      window.setTimeout(() => {
        suppressMachineAreaClickRef.current = false;
      }, 0);
    }

    if (!remainsInsideArea) {
      scheduleHoverRelease();
    }
  }

  function handlePopupPointerDown(event, popupId) {
    clearHoverLeaveTimer();
    enterSafetyPopup(popupId);
    beginViewerDrag(event, popupDragRef, event.currentTarget);
  }

  function handlePopupPointerMove(event) {
    moveViewerDrag(event, popupDragRef);
  }

  function finishPopupPointerDrag(event) {
    const dragNode = popupDragRef.current.node;
    const result = endViewerDrag(event, popupDragRef);
    if (!result) return;

    const pointerTarget = document.elementFromPoint(event.clientX, event.clientY);
    const remainsInsidePopup = Boolean(
      dragNode && pointerTarget && dragNode.contains(pointerTarget),
    );

    if (!remainsInsidePopup) {
      setHoveredPopupId(null);
      scheduleHoverRelease({ clearPopup: true });
    }
  }

  function rememberCurrentView() {
    const viewer = pannellumInstanceRef.current;
    if (!viewer || !currentScene) return;

    const rawYaw = normalizeNumber(viewer.getYaw?.(), 0);
    const rawPitch = normalizeNumber(viewer.getPitch?.(), 0);
    const rawHfov = normalizeNumber(
      viewer.getHfov?.(),
      normalizeNumber(mapData?.settings?.defaultHfov, 110),
    );

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
    clearHoverLeaveTimer();
    setSelectedMachineArea(null);
    setHoveredPopupId(null);
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
    clearHoverLeaveTimer();
    setSelectedMachineArea(null);
    setHoveredMachineAreaId(null);
    setHoveredPopupId(null);
    hoveredMachineAreaIdRef.current = null;
    hoveredPopupIdRef.current = null;
  }, [viewerMode, currentSceneIdResolved]);

  useEffect(() => {
    hoveredMachineAreaIdRef.current = hoveredMachineAreaId;
  }, [hoveredMachineAreaId]);

  useEffect(() => {
    hoveredPopupIdRef.current = hoveredPopupId;
  }, [hoveredPopupId]);

  useEffect(() => {
    setSelectedMachineArea(null);
    setHoveredMachineAreaId(null);
    setHoveredPopupId(null);

    let animationFrame = 0;

    function updateOverlayPositions() {
      const viewer = pannellumInstanceRef.current;
      const element = viewerRef.current;

      if (viewer && element) {
        machineAreas.forEach((machineArea) => {
          const id = machineArea.id || getMachineAreaTitle(machineArea);
          const projected = getProjectedMachineAreas(
            [machineArea],
            viewer,
            element,
          )[0];
          const polygon = machinePolygonRefs.current.get(id);
          const clip = machineClipRefs.current.get(id);
          const imageElement = machineImageRefs.current.get(id);

          if (!projected) {
            projectedMachineBoundsRef.current.delete(id);
            polygon?.setAttribute("visibility", "hidden");
            clip?.setAttribute("visibility", "hidden");
            imageElement?.setAttribute("visibility", "hidden");
            return;
          }

          projectedMachineBoundsRef.current.set(id, projected.bounds);
          polygon?.setAttribute("visibility", "visible");
          polygon?.setAttribute("points", projected.pointsAttr);
          clip?.setAttribute("visibility", "visible");
          clip?.setAttribute("points", projected.pointsAttr);

          if (imageElement) {
            imageElement.setAttribute("visibility", "visible");
            imageElement.setAttribute("x", String(projected.bounds.x));
            imageElement.setAttribute("y", String(projected.bounds.y));
            imageElement.setAttribute("width", String(projected.bounds.width));
            imageElement.setAttribute("height", String(projected.bounds.height));
          }
        });

        if (viewerMode === "safety") {
          const hoveredAreaId = hoveredMachineAreaIdRef.current;

          sceneSafetyPopups.forEach((popup) => {
            const projected = getProjectedSafetyPopup(popup, viewer, element);
            const box = popupBoxRefs.current.get(popup.id);
            const line = popupLineRefs.current.get(popup.id);
            const arrow = popupArrowRefs.current.get(popup.id);
            const popupAreaId = getPopupMachineAreaId(popup, machineAreas);
            const isPopupHovered = hoveredPopupIdRef.current === popup.id;
            const isAreaHovered = hoveredAreaId && popupAreaId === hoveredAreaId;
            const shouldShow = Boolean(
              projected && (isAreaHovered || isPopupHovered),
            );

            if (projected) {
              const areaBounds = popupAreaId
                ? projectedMachineBoundsRef.current.get(popupAreaId)
                : null;
              const halfWidth = Math.max(box?.offsetWidth || 150, 150) / 2;
              const halfHeight = Math.max(box?.offsetHeight || 46, 46) / 2;
              const zones = [
                {
                  left: projected.boxPosition.x - halfWidth,
                  right: projected.boxPosition.x + halfWidth,
                  top: projected.boxPosition.y - halfHeight,
                  bottom: projected.boxPosition.y + halfHeight,
                },
              ];

              if (areaBounds) {
                zones.push({
                  left: areaBounds.x,
                  right: areaBounds.x + areaBounds.width,
                  top: areaBounds.y,
                  bottom: areaBounds.y + areaBounds.height,
                });
              }

              if (projected.arrowPosition) {
                zones.push({
                  left: projected.arrowPosition.x,
                  right: projected.arrowPosition.x,
                  top: projected.arrowPosition.y,
                  bottom: projected.arrowPosition.y,
                });
              }

              popupInteractionZonesRef.current.set(popup.id, {
                left:
                  Math.min(...zones.map((zone) => zone.left)) -
                  POPUP_INTERACTION_PADDING,
                right:
                  Math.max(...zones.map((zone) => zone.right)) +
                  POPUP_INTERACTION_PADDING,
                top:
                  Math.min(...zones.map((zone) => zone.top)) -
                  POPUP_INTERACTION_PADDING,
                bottom:
                  Math.max(...zones.map((zone) => zone.bottom)) +
                  POPUP_INTERACTION_PADDING,
              });
            } else {
              popupInteractionZonesRef.current.delete(popup.id);
            }

            if (!shouldShow) {
              if (box) {
                box.style.visibility = "hidden";
                box.classList.remove("is-visible", "is-expanded");
              }
              line?.setAttribute("visibility", "hidden");
              arrow?.setAttribute("visibility", "hidden");
              return;
            }

            if (box) {
              box.style.visibility = "visible";
              box.style.transform = `translate3d(${projected.boxPosition.x}px, ${projected.boxPosition.y}px, 0)`;
              box.classList.add("is-visible");
              box.classList.toggle("is-expanded", isPopupHovered);
            }

            if (line && projected.arrowPosition) {
              line.setAttribute("visibility", "visible");
              line.setAttribute("x1", String(projected.boxPosition.x));
              line.setAttribute("y1", String(projected.boxPosition.y));
              line.setAttribute("x2", String(projected.arrowPosition.x));
              line.setAttribute("y2", String(projected.arrowPosition.y));
            } else {
              line?.setAttribute("visibility", "hidden");
            }

            if (arrow && projected.arrowPosition) {
              arrow.setAttribute("visibility", "visible");
              arrow.setAttribute("cx", String(projected.arrowPosition.x));
              arrow.setAttribute("cy", String(projected.arrowPosition.y));
            } else {
              arrow?.setAttribute("visibility", "hidden");
            }
          });
        }
      }

      animationFrame = window.requestAnimationFrame(updateOverlayPositions);
    }

    updateOverlayPositions();
    return () => {
      window.cancelAnimationFrame(animationFrame);
      projectedMachineBoundsRef.current.clear();
      popupInteractionZonesRef.current.clear();
      clearHoverLeaveTimer();
    };
  }, [machineAreas, sceneSafetyPopups, viewerMode, currentSceneIdResolved]);

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

    setSelectedMachineArea(null);

    const remembered = viewMemoryRef.current;

    const targetYaw = normalizeYaw(
      remembered
        ? toSceneYaw(remembered.worldYaw, currentScene)
        : normalizeNumber(currentScene?.view?.initialYaw, 0),
    );

    const targetPitch = clamp(
      normalizeNumber(
        remembered?.pitch,
        normalizeNumber(currentScene?.view?.initialPitch, 0),
      ),
      -85,
      85,
    );

    const targetHfov = clamp(
      normalizeNumber(
        remembered?.hfov,
        normalizeNumber(
          currentScene?.view?.initialHfov,
          normalizeNumber(mapData?.settings?.defaultHfov, 110),
        ),
      ),
      35,
      120,
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
            button.innerHTML =
              '<span class="street-floor-arrow-core" aria-hidden="true"></span>';
            bindLiveArrowRotation(
              button,
              args.hotspotYaw,
              () => pannellumInstanceRef.current,
            );
            hotSpotDiv.appendChild(button);
          },
          createTooltipArgs: {
            title:
              connection.label || labelForScene(targetScene, connection.to),
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
  }, [
    currentSceneIdResolved,
    currentPanorama,
    mapData,
    sceneConnections,
    scenes,
  ]);

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
    <div
      ref={shellRef}
      className={`street-viewer-shell ${isTransitioning ? "is-speed-transitioning" : ""}`}
      onPointerMoveCapture={handleViewerPointerMove}
      onPointerLeave={handleViewerPointerLeave}
    >
      <div ref={viewerRef} className="street-pannellum-stage" />

      <div className="street-right-stack">
        <div className="street-location-pill">
          <span>{site?.name || mapData?.name || "Street View"}</span>
          <strong>{labelForScene(currentScene, currentSceneIdResolved)}</strong>
        </div>

        <div
          className={`street-mode-switch is-${viewerMode}`}
          role="group"
          aria-label="Viewer mode"
        >
          <button
            type="button"
            className={viewerMode === "tutor" ? "active" : ""}
            onClick={() => setViewerMode("tutor")}
          >
            Tour
          </button>
          <button
            type="button"
            className={viewerMode === "safety" ? "active safety" : ""}
            onClick={() => setViewerMode("safety")}
          >
            Safety
          </button>
        </div>

        {selectedMachineArea && viewerMode === "tutor" && (
          <aside className="machine-area-info-card is-tutor">
            <strong>{getMachineAreaTitle(selectedMachineArea)}</strong>
            <p>
              {getMachineAreaPurpose(selectedMachineArea, viewerMode) ||
                "No purpose added."}
            </p>
          </aside>
        )}

      </div>

      {viewerMode === "safety" && sceneSafetyPopups.length > 0 && (
        <>
          <svg className="viewer-safety-popup-links" aria-hidden="true">
            <defs>
              <marker
                id="viewer-safety-popup-arrowhead"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="5"
                markerHeight="5"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" />
              </marker>
            </defs>
            {sceneSafetyPopups.map((popup) => (
              <g key={`popup-link-${popup.id}`}>
                <line
                  ref={(node) => {
                    if (node) popupLineRefs.current.set(popup.id, node);
                    else popupLineRefs.current.delete(popup.id);
                  }}
                  markerEnd="url(#viewer-safety-popup-arrowhead)"
                />
                <circle
                  ref={(node) => {
                    if (node) popupArrowRefs.current.set(popup.id, node);
                    else popupArrowRefs.current.delete(popup.id);
                  }}
                  r="4"
                />
              </g>
            ))}
          </svg>
          <div className="viewer-safety-popup-markers" aria-live="polite">
            {sceneSafetyPopups.map((popup) => (
              <article
                key={popup.id}
                ref={(node) => {
                  if (node) popupBoxRefs.current.set(popup.id, node);
                  else popupBoxRefs.current.delete(popup.id);
                }}
                data-popup-id={popup.id}
                className={`viewer-safety-popup-marker ${hoveredPopupId === popup.id ? "is-expanded" : ""}`}
                onMouseEnter={(event) => enterSafetyPopup(popup.id, event)}
                onMouseLeave={leaveSafetyPopup}
                onWheelCapture={handlePopupWheel}
                onPointerDown={(event) =>
                  handlePopupPointerDown(event, popup.id)
                }
                onPointerMove={handlePopupPointerMove}
                onPointerUp={finishPopupPointerDrag}
                onPointerCancel={finishPopupPointerDrag}
              >
                <strong>{popup.title || "Safety information"}</strong>
                {popup.content && <p>{popup.content}</p>}
                {(popup.hazard || popup.safetyNote) && (
                  <dl>
                    {popup.hazard && (
                      <div>
                        <dt>Hazard</dt>
                        <dd>{popup.hazard}</dd>
                      </div>
                    )}
                    {popup.safetyNote && (
                      <div>
                        <dt>Safety</dt>
                        <dd>{popup.safetyNote}</dd>
                      </div>
                    )}
                  </dl>
                )}
              </article>
            ))}
          </div>
        </>
      )}

      {machineAreas.length > 0 && (
        <svg
          className={`machine-area-screen-overlay viewer-machine-area-screen-overlay is-${viewerMode}`}
        >
          <defs>
            {machineAreas.map((machineArea) => {
              const id = machineArea.id || getMachineAreaTitle(machineArea);
              return (
                <clipPath key={`clip-${id}`} id={`viewer-machine-clip-${id}`}>
                  <polygon
                    ref={(node) => {
                      if (node) machineClipRefs.current.set(id, node);
                      else machineClipRefs.current.delete(id);
                    }}
                  />
                </clipPath>
              );
            })}
          </defs>

          {viewerMode === "safety" &&
            machineAreas.map((machineArea) => {
              const id = machineArea.id || getMachineAreaTitle(machineArea);
              const hoverImage = resolveAssetUrl(machineArea.hoverImage);
              if (!hoverImage) return null;

              return (
                <image
                  key={`hover-${id}`}
                  ref={(node) => {
                    if (node) machineImageRefs.current.set(id, node);
                    else machineImageRefs.current.delete(id);
                  }}
                  className={`machine-area-hover-image ${hoveredMachineAreaId === machineArea.id ? "is-visible" : ""}`}
                  href={hoverImage}
                  preserveAspectRatio="xMidYMid slice"
                  clipPath={`url(#viewer-machine-clip-${id})`}
                />
              );
            })}

          {machineAreas.map((machineArea) => {
            const id = machineArea.id || getMachineAreaTitle(machineArea);
            const isSelected = selectedMachineArea?.id === machineArea.id;
            const isHovered = hoveredMachineAreaId === machineArea.id;
            return (
              <polygon
                key={id}
                ref={(node) => {
                  if (node) machinePolygonRefs.current.set(id, node);
                  else machinePolygonRefs.current.delete(id);
                }}
                data-machine-area-id={machineArea.id}
                className={`machine-area-screen-polygon ${isSelected || isHovered ? "is-active" : ""}`}
                onMouseEnter={(event) =>
                  setHoveredMachineAreaSafe(machineArea.id, event)
                }
                onMouseLeave={releaseHoveredMachineArea}
                onWheelCapture={handlePopupWheel}
                onPointerDown={(event) =>
                  handleMachineAreaPointerDown(event, machineArea.id)
                }
                onPointerMove={handleMachineAreaPointerMove}
                onPointerUp={finishMachineAreaPointerDrag}
                onPointerCancel={finishMachineAreaPointerDrag}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (suppressMachineAreaClickRef.current) return;
                  showMachineArea(machineArea);
                }}
              />
            );
          })}
        </svg>
      )}

      <div
        className="street-viewer-controls-clean street-viewer-controls-by-map"
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" onClick={() => zoomBy(-10)} title="Zoom in">
          +
        </button>
        <button type="button" onClick={() => zoomBy(10)} title="Zoom out">
          −
        </button>
        <button type="button" onClick={toggleFullscreen} title="Fullscreen">
          ⛶
        </button>
      </div>

      <div className="street-minimap-card raw-only">
        <div className="street-minimap-window">
          {mapImage ? (
            <div
              className="street-minimap-world"
              style={{ transform: getMiniMapTransform(activeMapPoint) }}
              onClick={handleMiniMapTeleport}
              title="Click the map to jump to the closest location"
            >
              <img
                src={mapImage}
                alt="Site map"
                className="street-minimap-image"
              />

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
