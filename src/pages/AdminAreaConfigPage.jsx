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
  uploadAdminImage,
  getEffectiveFactoryMaps,
  saveFactoryMaps,
  createUniqueId,
} from "../utils/streetViewAdminStorage";
import { logout as logoutSession } from "../utils/auth";
import "../styles/admin.css";

const CARD_PAGE_SIZE = 20;
const MAP_ZOOM_MIN = 1;
const MAP_ZOOM_MAX = 4;
const MAP_ZOOM_STEP = 0.35;
const DIRECTION_MARKER_PITCH = -42;
const DIRECTION_ORBIT_YAW_RANGE = 68;
const DIRECTION_ARROW_MAX_ROTATION = 48;
const EMPTY_MACHINE_FORM = {
  machineName: "",
  purpose: "",
  hazard: "",
  safetyNote: "",
  image: "",
  hoverImage: "",
};

const EMPTY_SAFETY_POPUP_FORM = {
  title: "",
  content: "",
  hazard: "",
  safetyNote: "",
  images: [],
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
  return resolveAssetUrl(
    scene?.panorama || scene?.image || scene?.url || scene?.publicPath || "",
  );
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
      "",
  );
}

function sortScenesAlphabetically(sceneList) {
  return [...sceneList].sort((a, b) => {
    const nameA = getSceneTitle(a).toLowerCase();
    const nameB = getSceneTitle(b).toLowerCase();
    return nameA.localeCompare(nameB, undefined, {
      numeric: true,
      sensitivity: "base",
    });
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
  if (
    Number.isFinite(Number(hotspot?.pitch)) &&
    Number.isFinite(Number(hotspot?.yaw))
  ) {
    return { pitch: Number(hotspot.pitch), yaw: Number(hotspot.yaw) };
  }
  return legacyPercentToPano(hotspot);
}

function getSceneMapPoint(scene) {
  return scene?.mapPoint || scene?.minimap || null;
}

function getSceneLinkCount(scene) {
  return (scene?.hotspots || []).filter((hotspot) => hotspot?.targetSceneId)
    .length;
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
      0,
  );
}

function adminSceneYawToWorldYaw(sceneYaw, scene) {
  return normalizeAdminYaw(
    normalizeAdminNumber(sceneYaw, 0) + getAdminSceneNorthOffset(scene),
  );
}

function adminWorldYawToSceneYaw(worldYaw, scene) {
  return normalizeAdminYaw(
    normalizeAdminNumber(worldYaw, 0) - getAdminSceneNorthOffset(scene),
  );
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
      const relativeYaw = normalizeAdminYaw(
        normalizeAdminNumber(hotspotYaw, 0) - currentYaw,
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

function getMachineAreaTitle(area = {}) {
  return area.machineName || area.name || "Machine Area";
}

function getMachineAreaPurpose(area = {}, mode = getMachineAreaMode(area)) {
  if (mode === "safety") {
    return (
      area.safetyPurpose || (area.mode === "safety" ? area.purpose : "") || ""
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
    Number.isFinite(Number(point?.pitch)) && Number.isFinite(Number(point?.yaw))
  );
}

function unwrapAdminYawAround(yaw, referenceYaw) {
  let value = normalizeAdminYaw(yaw);
  const reference = normalizeAdminYaw(referenceYaw);
  while (value - reference > 180) value -= 360;
  while (value - reference < -180) value += 360;
  return value;
}

function isPointInsideMachineArea(point, machineArea) {
  if (!hasPopupPoint(point)) return false;
  const points = getMachineAreaPoints(machineArea);
  if (points.length < 3) return false;

  const pointYaw = normalizeAdminYaw(point.yaw);
  const pointPitch = normalizeAdminNumber(point.pitch, 0);
  const polygon = points.map((polygonPoint) => ({
    x: unwrapAdminYawAround(polygonPoint.yaw, pointYaw),
    y: normalizeAdminNumber(polygonPoint.pitch, 0),
  }));

  let inside = false;
  for (
    let currentIndex = 0, previousIndex = polygon.length - 1;
    currentIndex < polygon.length;
    previousIndex = currentIndex, currentIndex += 1
  ) {
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
  const pointYaw = normalizeAdminYaw(point.yaw);
  const pointPitch = normalizeAdminNumber(point.pitch, 0);
  const points = getMachineAreaPoints(machineArea);
  if (!points.length) return Number.POSITIVE_INFINITY;

  return Math.min(
    ...points.map((areaPoint) => {
      const yawDistance =
        unwrapAdminYawAround(areaPoint.yaw, pointYaw) - pointYaw;
      const pitchDistance =
        normalizeAdminNumber(areaPoint.pitch, 0) - pointPitch;
      return Math.hypot(yawDistance, pitchDistance);
    }),
  );
}

function getSafetyAreaIdForPoint(point, machineAreas = []) {
  if (!hasPopupPoint(point)) return null;

  const safetyAreas = machineAreas.filter(
    (machineArea) => getMachineAreaMode(machineArea) === "safety",
  );
  const containingArea = safetyAreas.find((machineArea) =>
    isPointInsideMachineArea(point, machineArea),
  );

  if (containingArea?.id) return containingArea.id;

  const nearestArea = [...safetyAreas].sort(
    (firstArea, secondArea) =>
      getPointDistanceToMachineArea(point, firstArea) -
      getPointDistanceToMachineArea(point, secondArea),
  )[0];

  return nearestArea?.id || null;
}

function ensureSafetyPopupParents(popups = [], machineAreas = []) {
  const validAreaIds = new Set(
    machineAreas
      .filter((machineArea) => getMachineAreaMode(machineArea) === "safety")
      .map((machineArea) => machineArea.id)
      .filter(Boolean),
  );

  return popups.map((popup) => {
    const existingParentId = popup.machineAreaId || popup.safetyAreaId || null;
    if (existingParentId && validAreaIds.has(existingParentId)) {
      return { ...popup, machineAreaId: existingParentId };
    }

    const targetPoint = hasPopupPoint(getPopupArrowPoint(popup))
      ? getPopupArrowPoint(popup)
      : getPopupAreaPoint(popup);
    const parentId = getSafetyAreaIdForPoint(targetPoint, machineAreas);

    return parentId ? { ...popup, machineAreaId: parentId } : popup;
  });
}

function getSafetyPopups(area = {}) {
  return Array.isArray(area.safetyPopups) ? area.safetyPopups : [];
}

function getSafetyPopupImages(popup = {}) {
  const candidates = [
    ...(Array.isArray(popup.images) ? popup.images : []),
    popup.image,
    popup.popupImage,
  ];
  const seen = new Set();

  return candidates
    .map((image) =>
      typeof image === "string"
        ? image
        : image?.publicPath || image?.url || image?.src || "",
    )
    .map((image) => image.trim())
    .filter((image) => {
      if (!image || seen.has(image)) return false;
      seen.add(image);
      return true;
    });
}

function getSceneSafetyPopups(scene = {}) {
  const directPopups = Array.isArray(scene.safetyPopups)
    ? scene.safetyPopups
    : [];
  const legacyPopups = Array.isArray(scene.machineAreas)
    ? scene.machineAreas.flatMap((machineArea) => getSafetyPopups(machineArea))
    : [];
  const seen = new Set();

  return [...directPopups, ...legacyPopups].filter((popup) => {
    const key =
      popup?.id || `${popup?.title || "popup"}-${popup?.yaw}-${popup?.pitch}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function projectPanoPointToScreen(point, viewer, element) {
  if (!point || !viewer || !element) return null;

  const width =
    element.clientWidth || element.getBoundingClientRect().width || 1;
  const height =
    element.clientHeight || element.getBoundingClientRect().height || 1;
  const yaw = normalizeAdminYaw(point.yaw);
  const pitch = clampAdminNumber(normalizeAdminNumber(point.pitch, 0), -89, 89);
  const viewYaw = normalizeAdminYaw(viewer.getYaw?.() || 0);
  const viewPitch = clampAdminNumber(
    normalizeAdminNumber(viewer.getPitch?.(), 0),
    -89,
    89,
  );
  const hfov = clampAdminNumber(
    normalizeAdminNumber(viewer.getHfov?.(), 100),
    35,
    120,
  );

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

  const screenX =
    width / 2 + ((width / 2) * (relX / relZ)) / Math.tan(hFovRad / 2);
  const screenY =
    height / 2 - ((height / 2) * (relY / relZ)) / Math.tan(vFovRad / 2);

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

function PannellumStage({
  image,
  scene,
  scenesById,
  showAreaLayer = false,
  areaMode = "safety",
  isPicking,
  pickLabel,
  onPickPoint,
  onGoToScene,
  machineDraftPoints = [],
  machineAreas = [],
  safetyPopups = [],
  onEditMachineArea,
  onRemoveMachineArea,
  onEditSafetyPopup,
  isDirectionPicking = false,
  directionTargetTitle = "",
}) {
  const mountRef = useRef(null);
  const viewerRef = useRef(null);
  const viewMemoryRef = useRef(null);
  const onGoToSceneRef = useRef(onGoToScene);
  const onPickPointRef = useRef(onPickPoint);
  const machinePolygonRefs = useRef(new Map());
  const machineClipRefs = useRef(new Map());
  const machineImageRefs = useRef(new Map());
  const popupBoxRefs = useRef(new Map());
  const popupLineRefs = useRef(new Map());
  const popupArrowRefs = useRef(new Map());
  const [hoveredMachineArea, setHoveredMachineArea] = useState(null);
  const [hoveredMachineAreaId, setHoveredMachineAreaId] = useState(null);
  const selectedSceneId = scene?.id || "";

  const hotspotSignature = useMemo(() => {
    const linkSignature = (scene?.hotspots || [])
      .filter((hotspot) => hotspot?.targetSceneId)
      .map(
        (hotspot) =>
          `${hotspot.id}:${hotspot.targetSceneId}:${hotspot.pitch}:${hotspot.yaw}:${hotspot.x}:${hotspot.y}:${hotspot.directionAngle}`,
      )
      .join("|");

    const draftSignature = (machineDraftPoints || [])
      .map((point) => `${point.pitch},${point.yaw}`)
      .join("|");

    return `${linkSignature}::${draftSignature}`;
  }, [scene?.hotspots, machineDraftPoints]);

  useEffect(() => {
    onGoToSceneRef.current = onGoToScene;
  }, [onGoToScene]);

  useEffect(() => {
    onPickPointRef.current = onPickPoint;
  }, [onPickPoint]);

  function showMachineArea(machineArea) {
    setHoveredMachineArea(machineArea);
  }

  useEffect(() => {
    setHoveredMachineArea(null);
    setHoveredMachineAreaId(null);
  }, [showAreaLayer, areaMode, selectedSceneId]);

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
        : normalizeAdminNumber(scene?.view?.initialYaw, 0),
    );

    const targetPitch = clampAdminNumber(
      normalizeAdminNumber(
        remembered?.pitch,
        normalizeAdminNumber(scene?.view?.initialPitch, 0),
      ),
      -85,
      85,
    );

    const targetHfov = clampAdminNumber(
      normalizeAdminNumber(
        remembered?.hfov,
        normalizeAdminNumber(scene?.view?.initialHfov, 105),
      ),
      35,
      120,
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
            button.innerHTML =
              '<span class="street-floor-arrow-core" aria-hidden="true"></span>';
            button.title = args.title;
            button.setAttribute("aria-label", args.title);
            bindAdminLiveArrowRotation(
              button,
              args.hotspotYaw,
              () => viewerRef.current,
            );
            button.addEventListener("click", (event) => {
              event.preventDefault();
              event.stopPropagation();
              goToSceneWithRememberedView(args.targetSceneId);
            });
            hotSpotDiv.appendChild(button);
          },
          createTooltipArgs: {
            title: targetScene
              ? `Go to ${getSceneTitle(targetScene)}`
              : "Go to location",
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

    const useMultiRes =
      scene?.panoramaType === "multires" && scene?.multiRes && typeof scene.multiRes === "object";

    viewerRef.current = window.pannellum.viewer(mount, {
      type: useMultiRes ? "multires" : "equirectangular",
      ...(useMultiRes ? { multiRes: scene.multiRes } : { panorama: image }),
      ...(scene?.thumbnail ? { preview: scene.thumbnail } : {}),
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
      viewerRef.current?.on?.("load", () =>
        applyRememberedAdminView(viewerRef.current),
      );
    } catch {}

    return () => {
      rememberCurrentAdminView();
      try {
        viewerRef.current?.destroy?.();
      } catch {}
      viewerRef.current = null;
    };
  }, [
    image,
    selectedSceneId,
    hotspotSignature,
    scenesById,
    scene?.panoramaType,
    scene?.multiRes,
    scene?.thumbnail,
  ]);

  useEffect(() => {
    setHoveredMachineArea(null);

    let animationFrame = 0;

    function updateOverlayPositions() {
      const viewer = viewerRef.current;
      const element = mountRef.current;

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
            polygon?.setAttribute("visibility", "hidden");
            clip?.setAttribute("visibility", "hidden");
            imageElement?.setAttribute("visibility", "hidden");
            return;
          }

          polygon?.setAttribute("visibility", "visible");
          polygon?.setAttribute("points", projected.pointsAttr);
          clip?.setAttribute("visibility", "visible");
          clip?.setAttribute("points", projected.pointsAttr);

          if (imageElement) {
            imageElement.setAttribute("visibility", "visible");
            imageElement.setAttribute("x", String(projected.bounds.x));
            imageElement.setAttribute("y", String(projected.bounds.y));
            imageElement.setAttribute("width", String(projected.bounds.width));
            imageElement.setAttribute(
              "height",
              String(projected.bounds.height),
            );
          }
        });

        safetyPopups.forEach((popup) => {
          const areaPoint = getPopupAreaPoint(popup);
          const arrowPoint = getPopupArrowPoint(popup);
          const boxPosition = hasPopupPoint(areaPoint)
            ? projectPanoPointToScreen(areaPoint, viewer, element)
            : null;
          const arrowPosition = hasPopupPoint(arrowPoint)
            ? projectPanoPointToScreen(arrowPoint, viewer, element)
            : null;
          const box = popupBoxRefs.current.get(popup.id);
          const line = popupLineRefs.current.get(popup.id);
          const arrow = popupArrowRefs.current.get(popup.id);

          if (!boxPosition) {
            if (box) box.style.visibility = "hidden";
            line?.setAttribute("visibility", "hidden");
            arrow?.setAttribute("visibility", "hidden");
            return;
          }

          if (box) {
            box.style.visibility = "visible";
            box.style.transform = `translate3d(${boxPosition.x}px, ${boxPosition.y}px, 0)`;
          }

          if (line && arrowPosition) {
            line.setAttribute("visibility", "visible");
            line.setAttribute("x1", String(boxPosition.x));
            line.setAttribute("y1", String(boxPosition.y));
            line.setAttribute("x2", String(arrowPosition.x));
            line.setAttribute("y2", String(arrowPosition.y));
          } else {
            line?.setAttribute("visibility", "hidden");
          }

          if (arrow && arrowPosition) {
            arrow.setAttribute("visibility", "visible");
            arrow.setAttribute("cx", String(arrowPosition.x));
            arrow.setAttribute("cy", String(arrowPosition.y));
          } else {
            arrow?.setAttribute("visibility", "hidden");
          }
        });
      }

      animationFrame = window.requestAnimationFrame(updateOverlayPositions);
    }

    updateOverlayPositions();
    return () => window.cancelAnimationFrame(animationFrame);
  }, [machineAreas, safetyPopups, selectedSceneId]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    function handleClick(event) {
      if (!isPicking) return;
      if (
        event.target.closest(
          ".admin-config-pnlm-hotspot-button-v2, .machine-area-hotspot-button, .machine-draft-point",
        )
      )
        return;

      if (viewerRef.current?.mouseEventToCoords) {
        const coords = viewerRef.current.mouseEventToCoords(event);
        if (Array.isArray(coords) && coords.length >= 2) {
          if (isDirectionPicking) {
            const rect = mount.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const clickOffsetX = event.clientX - centerX;
            const directionStrength = clampAdminNumber(
              clickOffsetX / Math.max(1, rect.width * 0.38),
              -1,
              1,
            );
            const centerYaw = normalizeAdminNumber(
              viewerRef.current?.getYaw?.(),
              Number(coords[1]),
            );
            const directionYaw = normalizeAdminYaw(
              centerYaw + directionStrength * DIRECTION_ORBIT_YAW_RANGE,
            );
            const directionAngle = Number(
              (directionStrength * DIRECTION_ARROW_MAX_ROTATION).toFixed(2),
            );

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
      const directionYaw = normalizeAdminYaw(
        directionStrength * DIRECTION_ORBIT_YAW_RANGE,
      );
      const directionAngle = Number(
        (directionStrength * DIRECTION_ARROW_MAX_ROTATION).toFixed(2),
      );
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

  const hasPannellum =
    typeof window !== "undefined" && !!window?.pannellum?.viewer;

  return (
    <div
      className={`admin-config-pannellum-wrap-v2 ${isPicking ? "is-marking" : ""}`}
      onClick={!hasPannellum ? handleFallbackClick : undefined}
    >
      {hasPannellum ? (
        <div ref={mountRef} className="admin-config-pannellum-mount-v2" />
      ) : (
        <img
          src={image}
          alt={getSceneTitle(scene)}
          className="admin-config-fallback-panorama-v2"
        />
      )}

      {showAreaLayer && machineAreas.length > 0 && (
        <svg
          className={`machine-area-screen-overlay admin-machine-area-screen-overlay is-${areaMode}`}
        >
          <defs>
            {machineAreas.map((machineArea) => {
              const id = machineArea.id || getMachineAreaTitle(machineArea);
              return (
                <clipPath key={`clip-${id}`} id={`admin-machine-clip-${id}`}>
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

          {areaMode === "safety" &&
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
                  clipPath={`url(#admin-machine-clip-${id})`}
                />
              );
            })}

          {machineAreas.map((machineArea) => {
            const id = machineArea.id || getMachineAreaTitle(machineArea);
            const isActive = hoveredMachineArea?.id === machineArea.id;
            const isHovered = hoveredMachineAreaId === machineArea.id;
            return (
              <polygon
                key={id}
                ref={(node) => {
                  if (node) machinePolygonRefs.current.set(id, node);
                  else machinePolygonRefs.current.delete(id);
                }}
                className={`machine-area-screen-polygon ${isActive || isHovered ? "is-active" : ""}`}
                onMouseEnter={() => setHoveredMachineAreaId(machineArea.id)}
                onMouseLeave={() => setHoveredMachineAreaId(null)}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  showMachineArea(machineArea);
                }}
              />
            );
          })}
        </svg>
      )}

      {areaMode === "safety" && safetyPopups.length > 0 && (
        <>
          <svg className="admin-safety-popup-links" aria-hidden="true">
            <defs>
              <marker
                id="admin-safety-popup-arrowhead"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" />
              </marker>
            </defs>
            {safetyPopups.map((popup) => (
              <g key={`link-${popup.id}`}>
                <line
                  ref={(node) => {
                    if (node) popupLineRefs.current.set(popup.id, node);
                    else popupLineRefs.current.delete(popup.id);
                  }}
                  markerEnd="url(#admin-safety-popup-arrowhead)"
                />
                <circle
                  ref={(node) => {
                    if (node) popupArrowRefs.current.set(popup.id, node);
                    else popupArrowRefs.current.delete(popup.id);
                  }}
                  r="5"
                />
              </g>
            ))}
          </svg>
          <div className="admin-safety-popup-boxes">
            {safetyPopups.map((popup) => (
              <button
                key={popup.id}
                ref={(node) => {
                  if (node) popupBoxRefs.current.set(popup.id, node);
                  else popupBoxRefs.current.delete(popup.id);
                }}
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onEditSafetyPopup?.(popup);
                }}
              >
                {popup.title || "Popup"}
              </button>
            ))}
          </div>
        </>
      )}

      <div
        className="admin-config-pannellum-controls-v2"
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

      {showAreaLayer && hoveredMachineArea && (
        <aside
          className={`machine-area-info-card admin-machine-area-info-card is-${areaMode}`}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="machine-area-info-header">
            <span>
              {areaMode === "safety" ? "Safety Machine" : "Tour Machine"}
            </span>
            <button type="button" onClick={() => setHoveredMachineArea(null)}>
              ×
            </button>
          </div>
          {areaMode === "safety" && hoveredMachineArea.image && (
            <img
              className="machine-area-popup-image"
              src={resolveAssetUrl(hoveredMachineArea.image)}
              alt={getMachineAreaTitle(hoveredMachineArea)}
            />
          )}
          <dl className="machine-area-details">
            <div>
              <dt>Machine Name</dt>
              <dd>{getMachineAreaTitle(hoveredMachineArea)}</dd>
            </div>
            <div>
              <dt>{areaMode === "safety" ? "Safety Purpose" : "Purpose"}</dt>
              <dd>
                {getMachineAreaPurpose(hoveredMachineArea, areaMode) ||
                  "No purpose added."}
              </dd>
            </div>
            {areaMode === "safety" && hoveredMachineArea.hazard && (
              <div>
                <dt>Hazard</dt>
                <dd>{hoveredMachineArea.hazard}</dd>
              </div>
            )}
            {areaMode === "safety" && hoveredMachineArea.safetyNote && (
              <div>
                <dt>Safety</dt>
                <dd>{hoveredMachineArea.safetyNote}</dd>
              </div>
            )}
          </dl>
          <div className="machine-area-card-actions">
            <button
              type="button"
              onClick={() => {
                setHoveredMachineArea(null);
                onEditMachineArea?.(hoveredMachineArea);
              }}
            >
              Edit
            </button>
            <button
              type="button"
              className="danger"
              onClick={() => {
                setHoveredMachineArea(null);
                onRemoveMachineArea?.(hoveredMachineArea.id);
              }}
            >
              Remove
            </button>
          </div>
        </aside>
      )}

      {isDirectionPicking && (
        <div className="direction-marking-guide" aria-hidden="true">
          <div className="direction-marking-orbit">
            <span className="direction-person-dot" />
            <span className="direction-orbit-arrow direction-orbit-arrow-up">
              ⌃
            </span>
            <span className="direction-orbit-arrow direction-orbit-arrow-right">
              ›
            </span>
            <span className="direction-orbit-arrow direction-orbit-arrow-left">
              ‹
            </span>
          </div>
          <strong>Click the direction</strong>
          <span>
            {directionTargetTitle
              ? `toward ${directionTargetTitle}`
              : "toward the next panorama"}
          </span>
        </div>
      )}

      {isPicking && (
        <div
          className={`admin-config-picking-banner-v2 ${isDirectionPicking ? "direction-picking-banner" : "machine-picking-banner"}`}
        >
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
  const siteMapInputRef = useRef(null);
  const sceneListRef = useRef(null);
  const sceneListSentinelRef = useRef(null);

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
  const [isMapModalOpen, setIsMapModalOpen] = useState(false);
  const [pendingTargetSceneId, setPendingTargetSceneId] = useState(null);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editLocationName, setEditLocationName] = useState("");
  const [editLocationFile, setEditLocationFile] = useState(null);
  const [saveMessage, setSaveMessage] = useState("");
  const [mapZoom, setMapZoom] = useState(1);
  const [mapPan, setMapPan] = useState({ x: 0, y: 0 });
  const [isMapPanning, setIsMapPanning] = useState(false);

  const [machineAreaDraftPoints, setMachineAreaDraftPoints] = useState([]);
  const [isMachineModalOpen, setIsMachineModalOpen] = useState(false);
  const [machineForm, setMachineForm] = useState(EMPTY_MACHINE_FORM);
  const [machineImageFile, setMachineImageFile] = useState(null);
  const [machineHoverImageFile, setMachineHoverImageFile] = useState(null);
  const [safetyPopups, setSafetyPopups] = useState([]);
  const [safetyPopupForm, setSafetyPopupForm] = useState(
    EMPTY_SAFETY_POPUP_FORM,
  );
  const [safetyPopupImageFiles, setSafetyPopupImageFiles] = useState([]);
  const [editingSafetyPopupId, setEditingSafetyPopupId] = useState(null);
  const [safetyEditorTab, setSafetyEditorTab] = useState("safety");
  const [editingMachineAreaId, setEditingMachineAreaId] = useState(null);
  const [isLocationManagerOpen, setIsLocationManagerOpen] = useState(false);
  const [mapModalMode, setMapModalMode] = useState("jump");
  const [adminStationMode, setAdminStationMode] = useState("tutor");

  const mapViewportRef = useRef(null);
  const mapPanGestureRef = useRef({
    active: false,
    moved: false,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
  });
  const safetyPopupImageFilesRef = useRef([]);

  useEffect(() => {
    safetyPopupImageFilesRef.current = safetyPopupImageFiles;
  }, [safetyPopupImageFiles]);

  useEffect(
    () => () => {
      safetyPopupImageFilesRef.current.forEach(({ previewUrl }) => {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
      });
    },
    [],
  );

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
  const scenes = useMemo(
    () => sortScenesAlphabetically(Object.values(tour?.scenes || {})),
    [tour],
  );

  const filteredScenes = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    if (!query) return scenes;
    return scenes.filter((scene) =>
      getSceneTitle(scene).toLowerCase().includes(query),
    );
  }, [scenes, searchText]);

  const visibleScenes = useMemo(
    () => filteredScenes.slice(0, visibleCount),
    [filteredScenes, visibleCount],
  );
  const selectedScene = selectedSceneId
    ? tour?.scenes?.[selectedSceneId]
    : scenes[0];
  const selectedImage = getSceneImage(selectedScene);
  const pendingTargetScene = pendingTargetSceneId
    ? tour?.scenes?.[pendingTargetSceneId]
    : null;
  const siteMapImage = getSiteMapImage(site, area, tour);
  const selectedMachineAreas = Array.isArray(selectedScene?.machineAreas)
    ? selectedScene.machineAreas
    : [];
  const activeMachineAreas = useMemo(
    () =>
      selectedMachineAreas.filter(
        (machineArea) => getMachineAreaMode(machineArea) === adminStationMode,
      ),
    [selectedMachineAreas, adminStationMode],
  );
  const activeSafetyPopup = editingSafetyPopupId
    ? safetyPopups.find((popup) => popup.id === editingSafetyPopupId) || null
    : null;

  const selectedHotspots = useMemo(() => {
    return (selectedScene?.hotspots || []).filter(
      (hotspot) => hotspot?.targetSceneId,
    );
  }, [selectedScene]);

  const linkTargetScenes = useMemo(() => {
    return scenes.filter((scene) => scene.id !== selectedScene?.id);
  }, [scenes, selectedScene?.id]);

  useEffect(() => {
    setVisibleCount(CARD_PAGE_SIZE);
  }, [searchText, scenes.length]);

  useEffect(() => {
    const root = sceneListRef.current;
    const target = sceneListSentinelRef.current;
    if (!root || !target || visibleCount >= filteredScenes.length)
      return undefined;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setVisibleCount((current) =>
          Math.min(current + CARD_PAGE_SIZE, filteredScenes.length),
        );
      },
      { root, rootMargin: "140px 0px", threshold: 0.01 },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [filteredScenes.length, visibleCount]);

  async function logout() {
    await logoutSession();
    navigate("/login", { replace: true });
  }

  function showSaved(text = "Saved") {
    setSaveMessage(text);
    window.clearTimeout(window.__streetViewConfigSaveTimer);
    window.__streetViewConfigSaveTimer = window.setTimeout(
      () => setSaveMessage(""),
      1600,
    );
  }

  function saveTour(nextTour, message = "Saved") {
    setTour(nextTour);
    updateAreaTour(siteId, areaId, nextTour);
    showSaved(message);
  }

  function clearSafetyPopupImageFiles() {
    setSafetyPopupImageFiles((currentFiles) => {
      currentFiles.forEach(({ previewUrl }) => {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
      });
      return [];
    });
  }

  function handleSafetyPopupImagesSelect(event) {
    const files = Array.from(event.target.files || []).filter((file) =>
      file.type.startsWith("image/"),
    );

    if (files.length) {
      const queuedFiles = files.map((file) => ({
        id: `${file.name}-${file.size}-${file.lastModified}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        previewUrl: URL.createObjectURL(file),
      }));
      setSafetyPopupImageFiles((currentFiles) => [
        ...currentFiles,
        ...queuedFiles,
      ]);
    }

    event.target.value = "";
  }

  function removeQueuedSafetyPopupImage(imageId) {
    setSafetyPopupImageFiles((currentFiles) =>
      currentFiles.filter((image) => {
        if (image.id !== imageId) return true;
        if (image.previewUrl) URL.revokeObjectURL(image.previewUrl);
        return false;
      }),
    );
  }

  function removeSavedSafetyPopupImage(imageIndex) {
    setSafetyPopupForm((current) => ({
      ...current,
      images: getSafetyPopupImages(current).filter(
        (_, index) => index !== imageIndex,
      ),
    }));
  }

  function handleFileSelect(event) {
    const files = Array.from(event.target.files || []).filter((file) =>
      file.type.startsWith("image/"),
    );
    setNewLocationFiles(files);
  }

  async function handleSiteMapUpload(event) {
    const file = event.target.files?.[0];
    if (!file || !site?.id) return;

    try {
      showSaved("Uploading map...");
      const imagePath = await uploadAdminImage(file, "maps");
      const currentMaps = getEffectiveFactoryMaps();
      const currentSite = currentMaps?.[site.id] || site;

      const nextMaps = {
        ...currentMaps,
        [site.id]: {
          ...currentSite,
          mapImage: imagePath,
        },
      };

      const savedMaps = saveFactoryMaps(nextMaps);
      setSite(savedMaps?.[site.id] || { ...site, mapImage: imagePath });
      showSaved("Map image saved");
    } catch (error) {
      console.error(error);
      alert("Failed to upload map image.");
    } finally {
      event.target.value = "";
    }
  }

  async function handleAddLocation(event) {
    event.preventDefault();
    if (!newLocationFiles.length) {
      alert("Please choose at least one 360 image first.");
      return;
    }

    setIsSaving(true);
    setUploadProgress({
      current: 0,
      total: newLocationFiles.length,
      name: "Preparing...",
    });

    try {
      const nextTour = {
        ...tour,
        scenes: { ...(tour?.scenes || {}) },
        settings: { ...(tour?.settings || {}) },
      };
      let selectedFirstNewScene = null;

      for (let index = 0; index < newLocationFiles.length; index += 1) {
        const file = newLocationFiles[index];
        setUploadProgress({
          current: index + 1,
          total: newLocationFiles.length,
          name: file.name,
        });

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
          panoramaAssetId: uploaded.panoramaAssetId || null,
          panoramaType: uploaded.panoramaType || "equirectangular",
          multiRes: uploaded.multiRes || undefined,
          mapPoint: null,
          minimap: null,
          hotspots: [],
          machineAreas: [],
          view: {
            initialYaw: 0,
            initialPitch: 0,
            initialHfov: 110,
            northOffset: 0,
          },
        };

        if (!nextTour.settings.firstScene)
          nextTour.settings.firstScene = sceneId;
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

  function openEditLocation() {
    if (!selectedScene?.id) return;
    setEditLocationName(getSceneTitle(selectedScene));
    setEditLocationFile(null);
    setIsEditOpen(true);
  }

  async function saveEditedLocation(event) {
    event.preventDefault();
    if (!selectedScene?.id || isSaving) return;

    const cleanName = editLocationName.trim();
    if (!cleanName) return alert("Location name cannot be blank.");

    setIsSaving(true);
    try {
      let panorama = selectedScene.panorama;
      let thumbnail = selectedScene.thumbnail;
      let panoramaAssetId = selectedScene.panoramaAssetId || null;
      let panoramaType = selectedScene.panoramaType || (selectedScene.multiRes ? "multires" : "equirectangular");
      let multiRes = selectedScene.multiRes || undefined;

      if (editLocationFile) {
        const uploaded = await uploadPanoramaAsset(editLocationFile);
        panorama = uploaded.panorama;
        thumbnail = uploaded.thumbnail;
        panoramaAssetId = uploaded.panoramaAssetId || null;
        panoramaType = uploaded.panoramaType || "equirectangular";
        multiRes = uploaded.multiRes || undefined;
      }

      const nextScene = {
        ...selectedScene,
        title: cleanName,
        name: cleanName,
        label: cleanName,
        panorama,
        thumbnail,
        panoramaAssetId,
        panoramaType,
        multiRes,
      };

      saveTour(
        { ...tour, scenes: { ...tour.scenes, [selectedScene.id]: nextScene } },
        editLocationFile ? "Location and 360 image saved" : "Location saved",
      );
      setEditLocationFile(null);
      setIsEditOpen(false);
    } catch (error) {
      console.error(error);
      alert("Failed to update the location.");
    } finally {
      setIsSaving(false);
    }
  }

  function openEditLocationMap() {
    setIsEditOpen(false);
    openMapModal("place");
  }

  function openEditLocationLinks() {
    setMode("preview");
    setPendingTargetSceneId(null);
    setIsEditOpen(false);
    setIsLocationManagerOpen(true);
  }

  function removeMachineArea(machineAreaId) {
    if (!selectedScene?.id) return;
    const machineArea = selectedMachineAreas.find(
      (item) => item.id === machineAreaId,
    );
    if (
      !window.confirm(
        `Remove machine area "${getMachineAreaTitle(machineArea)}"?`,
      )
    )
      return;

    const nextScene = {
      ...selectedScene,
      machineAreas: selectedMachineAreas.filter(
        (item) => item.id !== machineAreaId,
      ),
    };

    saveTour(
      { ...tour, scenes: { ...tour.scenes, [selectedScene.id]: nextScene } },
      "Machine area removed",
    );

    if (editingMachineAreaId === machineAreaId) {
      setEditingMachineAreaId(null);
      setMachineAreaDraftPoints([]);
      setMachineForm(EMPTY_MACHINE_FORM);
    }
  }

  function removeHotspot(hotspotId) {
    if (!selectedScene?.id) return;
    const hotspot = selectedHotspots.find((item) => item.id === hotspotId);
    const ok = window.confirm(
      `Remove button to ${getSceneTitle(tour?.scenes?.[hotspot?.targetSceneId], hotspot?.targetSceneId)}?`,
    );
    if (!ok) return;

    const nextScene = {
      ...selectedScene,
      hotspots: (selectedScene.hotspots || []).filter(
        (item) => item.id !== hotspotId,
      ),
    };

    saveTour(
      { ...tour, scenes: { ...tour.scenes, [selectedScene.id]: nextScene } },
      "Marked location removed",
    );
  }

  function removeMapPoint() {
    if (!selectedScene?.id) return;
    const hasMapPoint = !!getSceneMapPoint(selectedScene);
    if (!hasMapPoint) return;

    const ok = window.confirm(
      `Remove map mark for "${getSceneTitle(selectedScene)}"?`,
    );
    if (!ok) return;

    const nextScene = {
      ...selectedScene,
      mapPoint: null,
      minimap: null,
    };

    saveTour(
      { ...tour, scenes: { ...tour.scenes, [selectedScene.id]: nextScene } },
      "Map mark removed",
    );
  }

  function deleteSelectedLocation() {
    if (!selectedScene?.id) return;
    if (!confirm(`Delete "${getSceneTitle(selectedScene)}"?`)) return;

    const nextScenes = { ...(tour?.scenes || {}) };
    delete nextScenes[selectedScene.id];

    Object.keys(nextScenes).forEach((sceneId) => {
      nextScenes[sceneId] = {
        ...nextScenes[sceneId],
        hotspots: (nextScenes[sceneId].hotspots || []).filter(
          (hotspot) => hotspot?.targetSceneId !== selectedScene.id,
        ),
      };
    });

    const remainingIds = Object.keys(nextScenes);
    const nextFirstScene =
      tour?.settings?.firstScene === selectedScene.id
        ? remainingIds[0] || null
        : tour?.settings?.firstScene || remainingIds[0] || null;

    saveTour(
      {
        ...tour,
        settings: { ...tour.settings, firstScene: nextFirstScene },
        scenes: nextScenes,
      },
      "Image deleted",
    );
    setSelectedSceneId(nextFirstScene);
    setMode("preview");
  }

  function chooseTargetScene(targetSceneId) {
    setPendingTargetSceneId(targetSceneId);
    setIsLocationManagerOpen(false);
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
    setSafetyPopups(
      ensureSafetyPopupParents(
        getSceneSafetyPopups(selectedScene),
        selectedScene?.machineAreas || [],
      ),
    );
    setSafetyPopupForm(EMPTY_SAFETY_POPUP_FORM);
    clearSafetyPopupImageFiles();
    setEditingSafetyPopupId(null);
    setEditingMachineAreaId(null);
    setSafetyEditorTab("safety");
    setIsMachineModalOpen(true);
  }

  function openMachineAreaEditor(machineArea) {
    if (!machineArea?.id) return;
    setAdminStationMode(getMachineAreaMode(machineArea));
    setEditingMachineAreaId(machineArea.id);
    const machineMode = getMachineAreaMode(machineArea);
    setMachineForm({
      machineName: machineArea.machineName || machineArea.name || "",
      purpose: getMachineAreaPurpose(machineArea, machineMode),
      hazard: machineArea.hazard || "",
      safetyNote: machineArea.safetyNote || machineArea.safety || "",
      image: machineArea.image || machineArea.machineImage || "",
      hoverImage:
        machineArea.hoverImage ||
        machineArea.openImage ||
        machineArea.overlayImage ||
        "",
    });
    setMachineImageFile(null);
    setMachineHoverImageFile(null);
    setSafetyPopups(
      ensureSafetyPopupParents(
        getSceneSafetyPopups(selectedScene),
        selectedScene?.machineAreas || [],
      ),
    );
    setSafetyPopupForm(EMPTY_SAFETY_POPUP_FORM);
    clearSafetyPopupImageFiles();
    setEditingSafetyPopupId(null);
    setMachineAreaDraftPoints(getMachineAreaPoints(machineArea));
    setMode("preview");
    setSafetyEditorTab("safety");
    setIsMachineModalOpen(true);
  }

  function startNewMachineAreaForm() {
    if (!selectedScene?.id) return;
    setEditingMachineAreaId(null);
    setMachineForm(EMPTY_MACHINE_FORM);
    setMachineImageFile(null);
    setMachineHoverImageFile(null);
    setSafetyPopups(
      ensureSafetyPopupParents(
        getSceneSafetyPopups(selectedScene),
        selectedScene?.machineAreas || [],
      ),
    );
    setSafetyPopupForm(EMPTY_SAFETY_POPUP_FORM);
    clearSafetyPopupImageFiles();
    setEditingSafetyPopupId(null);
    setMachineAreaDraftPoints([]);
    setMode("preview");
    setSafetyEditorTab("safety");
    setIsMachineModalOpen(true);
  }

  function openSafetyPopupEditor(popup) {
    if (!popup?.id) return;
    setAdminStationMode("safety");
    setSafetyPopups(
      ensureSafetyPopupParents(
        getSceneSafetyPopups(selectedScene),
        selectedScene?.machineAreas || [],
      ),
    );
    setEditingSafetyPopupId(popup.id);
    setSafetyEditorTab("popup");
    clearSafetyPopupImageFiles();
    setSafetyPopupForm({
      title: popup.title || "",
      content: popup.content || popup.paragraph || popup.description || "",
      hazard: popup.hazard || "",
      safetyNote: popup.safetyNote || popup.safety || "",
      images: getSafetyPopupImages(popup),
    });
    setMode("preview");
    setIsMachineModalOpen(true);
  }

  function saveSceneSafetyPopups(nextPopups, message = "Popup saved") {
    if (!selectedScene?.id) return;

    const nextMachineAreas = Array.isArray(selectedScene.machineAreas)
      ? selectedScene.machineAreas.map((machineArea) => {
          const { safetyPopups: legacySafetyPopups, ...rest } = machineArea;
          return rest;
        })
      : [];
    const normalizedPopups = ensureSafetyPopupParents(
      nextPopups,
      nextMachineAreas,
    );
    const nextScene = {
      ...selectedScene,
      machineAreas: nextMachineAreas,
      safetyPopups: normalizedPopups,
    };

    setSafetyPopups(normalizedPopups);
    saveTour(
      { ...tour, scenes: { ...tour.scenes, [selectedScene.id]: nextScene } },
      message,
    );
  }

  function removeSafetyPopup(popupId) {
    const nextPopups = safetyPopups.filter((popup) => popup.id !== popupId);
    saveSceneSafetyPopups(nextPopups, "Popup removed");
    if (editingSafetyPopupId === popupId) {
      setEditingSafetyPopupId(null);
      setSafetyPopupForm(EMPTY_SAFETY_POPUP_FORM);
      clearSafetyPopupImageFiles();
    }
  }

  function startNewSafetyPopup() {
    setEditingSafetyPopupId(null);
    setSafetyEditorTab("popup");
    setSafetyPopupForm(EMPTY_SAFETY_POPUP_FORM);
    clearSafetyPopupImageFiles();
  }

  function startSafetyPopupAreaPick() {
    if (adminStationMode !== "safety") return;
    if (!safetyPopupForm.title.trim()) return alert("Popup title is required.");
    setIsMachineModalOpen(false);
    setMode("mark-safety-popup-area");
  }

  function startSafetyPopupArrowPick() {
    if (adminStationMode !== "safety") return;
    if (!safetyPopupForm.title.trim()) return alert("Popup title is required.");

    const existingPopup = editingSafetyPopupId
      ? safetyPopups.find((popup) => popup.id === editingSafetyPopupId)
      : null;
    if (!existingPopup || !hasPopupPoint(getPopupAreaPoint(existingPopup))) {
      alert("Map the popup rectangle first.");
      return;
    }

    setIsMachineModalOpen(false);
    setMode("mark-safety-popup-arrow");
  }

  async function saveSafetyPopupDetails() {
    if (!safetyPopupForm.title.trim()) {
      alert("Popup title is required.");
      return false;
    }

    const existingPopup = editingSafetyPopupId
      ? safetyPopups.find((popup) => popup.id === editingSafetyPopupId)
      : null;

    if (!existingPopup || !hasPopupPoint(getPopupAreaPoint(existingPopup))) {
      alert(
        "Click Map Popup, then click once in the panorama to place the rectangle.",
      );
      return false;
    }

    if (!hasPopupPoint(getPopupArrowPoint(existingPopup))) {
      alert("Click Map Arrow, then choose where the arrow should point.");
      return false;
    }

    const targetPoint = hasPopupPoint(getPopupArrowPoint(existingPopup))
      ? getPopupArrowPoint(existingPopup)
      : getPopupAreaPoint(existingPopup);
    const parentAreaId =
      existingPopup.machineAreaId ||
      getSafetyAreaIdForPoint(targetPoint, selectedScene?.machineAreas || []);
    setIsSaving(true);

    try {
      const uploadedImages = await Promise.all(
        safetyPopupImageFiles.map(({ file }) =>
          uploadAdminImage(file, "safety-popups"),
        ),
      );
      const images = getSafetyPopupImages({
        images: [...getSafetyPopupImages(safetyPopupForm), ...uploadedImages],
      });
      const nextPopup = {
        ...existingPopup,
        machineAreaId: parentAreaId || null,
        title: safetyPopupForm.title.trim(),
        content: safetyPopupForm.content.trim(),
        hazard: safetyPopupForm.hazard.trim(),
        safetyNote: safetyPopupForm.safetyNote.trim(),
        images,
      };
      const nextPopups = safetyPopups.map((popup) =>
        popup.id === nextPopup.id ? nextPopup : popup,
      );

      saveSceneSafetyPopups(nextPopups, "Popup updated");
      setIsMachineModalOpen(false);
      setSafetyPopupForm(EMPTY_SAFETY_POPUP_FORM);
      clearSafetyPopupImageFiles();
      setEditingSafetyPopupId(null);
      setMode("preview");
      return true;
    } catch (error) {
      console.error(error);
      alert("Failed to upload the Safety popup images.");
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  function startMachineAreaPick({ reset = false } = {}) {
    if (!selectedScene?.id) return;
    setIsMachineModalOpen(false);
    setMode("mark-machine-area");
    setPendingTargetSceneId(null);
    if (reset) setMachineAreaDraftPoints([]);
  }

  function finishMachineAreaDraft() {
    if (machineAreaDraftPoints.length < 3)
      return alert(
        `Click at least 3 points around the ${adminStationMode} area first.`,
      );
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
    setSafetyPopups([]);
    setSafetyPopupForm(EMPTY_SAFETY_POPUP_FORM);
    clearSafetyPopupImageFiles();
    setEditingSafetyPopupId(null);
    setSafetyEditorTab("safety");
    setMachineForm(EMPTY_MACHINE_FORM);
  }

  async function saveMachineArea(event) {
    event.preventDefault();
    if (!selectedScene?.id) return;

    if (adminStationMode === "safety" && safetyEditorTab === "popup") {
      await saveSafetyPopupDetails();
      return;
    }

    if (machineAreaDraftPoints.length < 3)
      return alert(
        `Please mark at least 3 points around the ${adminStationMode} area.`,
      );
    if (!machineForm.machineName.trim())
      return alert("Machine name is required.");

    setIsSaving(true);

    try {
      const currentMachineAreas = Array.isArray(selectedScene.machineAreas)
        ? selectedScene.machineAreas
        : [];
      const existing = editingMachineAreaId
        ? currentMachineAreas.find((item) => item.id === editingMachineAreaId)
        : null;
      const machineId =
        existing?.id ||
        createUniqueId(
          `machine-${machineForm.machineName}`,
          currentMachineAreas.map((item) => item.id),
        );

      let image = machineForm.image ?? existing?.image ?? "";
      let hoverImage = machineForm.hoverImage ?? existing?.hoverImage ?? "";

      if (adminStationMode === "safety" && machineImageFile) {
        image = await uploadAdminImage(machineImageFile, "machines");
      }

      if (adminStationMode === "safety" && machineHoverImageFile) {
        hoverImage = await uploadAdminImage(machineHoverImageFile, "machines");
      }

      const purpose = machineForm.purpose.trim();
      const nextMachineArea = {
        ...(existing || {}),
        id: machineId,
        type: "machineArea",
        mode: adminStationMode,
        machineName: machineForm.machineName.trim(),
        purpose,
        tutorPurpose: adminStationMode === "tutor" ? purpose : "",
        safetyPurpose: adminStationMode === "safety" ? purpose : "",
        hazard: adminStationMode === "safety" ? machineForm.hazard.trim() : "",
        safetyNote:
          adminStationMode === "safety" ? machineForm.safetyNote.trim() : "",
        image: adminStationMode === "safety" ? image : "",
        hoverImage: adminStationMode === "safety" ? hoverImage : "",
        points: machineAreaDraftPoints,
      };

      const nextMachineAreas = existing
        ? currentMachineAreas.map((item) =>
            item.id === existing.id ? nextMachineArea : item,
          )
        : [...currentMachineAreas, nextMachineArea];

      const nextScene = {
        ...selectedScene,
        machineAreas: nextMachineAreas,
        safetyPopups: getSceneSafetyPopups(selectedScene),
      };

      const modeLabel = adminStationMode === "safety" ? "Safety" : "Tour";
      saveTour(
        { ...tour, scenes: { ...tour.scenes, [selectedScene.id]: nextScene } },
        existing ? `${modeLabel} area updated` : `${modeLabel} area saved`,
      );
      setIsMachineModalOpen(false);
      setMachineAreaDraftPoints([]);
      setMachineImageFile(null);
      setMachineHoverImageFile(null);
      setSafetyPopups([]);
      setSafetyPopupForm(EMPTY_SAFETY_POPUP_FORM);
      clearSafetyPopupImageFiles();
      setEditingSafetyPopupId(null);
      setSafetyEditorTab("safety");
      setMachineForm(EMPTY_MACHINE_FORM);
      setEditingMachineAreaId(null);
      setMode("preview");
    } catch (error) {
      console.error(error);
      alert(`Failed to save ${adminStationMode} area.`);
    } finally {
      setIsSaving(false);
    }
  }

  const handlePanoPick = useCallback(
    (point) => {
      if (!selectedScene?.id) return;

      if (mode === "mark-machine-area") {
        setMachineAreaDraftPoints((currentPoints) => [...currentPoints, point]);
        return;
      }

      if (
        mode === "mark-safety-popup-area" ||
        mode === "mark-safety-popup-arrow"
      ) {
        const popupId =
          editingSafetyPopupId ||
          createUniqueId(
            `safety-popup-${safetyPopupForm.title}`,
            safetyPopups.map((popup) => popup.id),
          );
        const existingPopup =
          safetyPopups.find((popup) => popup.id === popupId) || {};
        const popupArea =
          mode === "mark-safety-popup-area"
            ? point
            : getPopupAreaPoint(existingPopup);
        const arrowPoint =
          mode === "mark-safety-popup-arrow"
            ? point
            : getPopupArrowPoint(existingPopup);
        const parentTargetPoint =
          mode === "mark-safety-popup-arrow"
            ? point
            : hasPopupPoint(arrowPoint)
              ? arrowPoint
              : popupArea;
        const machineAreaId =
          getSafetyAreaIdForPoint(
            parentTargetPoint,
            selectedScene?.machineAreas || [],
          ) ||
          existingPopup.machineAreaId ||
          null;
        const nextPopup = {
          ...existingPopup,
          id: popupId,
          machineAreaId,
          title: safetyPopupForm.title.trim(),
          content: safetyPopupForm.content.trim(),
          hazard: safetyPopupForm.hazard.trim(),
          safetyNote: safetyPopupForm.safetyNote.trim(),
          images: getSafetyPopupImages(safetyPopupForm),
          popupArea,
          arrowPoint: hasPopupPoint(arrowPoint) ? arrowPoint : null,
          pitch: popupArea.pitch,
          yaw: popupArea.yaw,
          x: popupArea.x,
          y: popupArea.y,
        };

        const nextPopups = safetyPopups.some((popup) => popup.id === popupId)
          ? safetyPopups.map((popup) =>
              popup.id === popupId ? nextPopup : popup,
            )
          : [...safetyPopups, nextPopup];

        saveSceneSafetyPopups(
          nextPopups,
          mode === "mark-safety-popup-area"
            ? "Popup rectangle mapped"
            : "Popup arrow mapped",
        );
        setSafetyPopupForm({
          title: nextPopup.title,
          content: nextPopup.content,
          hazard: nextPopup.hazard,
          safetyNote: nextPopup.safetyNote,
          images: getSafetyPopupImages(nextPopup),
        });
        setEditingSafetyPopupId(popupId);
        setSafetyEditorTab("popup");
        setMode("preview");
        setIsMachineModalOpen(true);
        return;
      }

      if (mode === "mark-location" && pendingTargetSceneId) {
        const targetScene = tour?.scenes?.[pendingTargetSceneId];
        const currentHotspots = selectedScene.hotspots || [];
        const existingHotspot = currentHotspots.find(
          (hotspot) => hotspot?.targetSceneId === pendingTargetSceneId,
        );

        const directionPoint = {
          pitch: DIRECTION_MARKER_PITCH,
          yaw: normalizeAdminYaw(point.directionYaw ?? point.yaw),
        };
        const directionAngle = Number.isFinite(Number(point.directionAngle))
          ? Number(point.directionAngle)
          : 0;
        const legacyPoint = toLegacyPercentPoint(
          directionPoint.pitch,
          directionPoint.yaw,
        );
        const nextHotspot = {
          ...(existingHotspot || {}),
          id:
            existingHotspot?.id ||
            createUniqueId(
              `to-${pendingTargetSceneId}`,
              currentHotspots.map((hotspot) => hotspot.id),
            ),
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
            ? currentHotspots.map((hotspot) =>
                hotspot.id === existingHotspot.id ? nextHotspot : hotspot,
              )
            : [...currentHotspots, nextHotspot],
        };
        saveTour(
          {
            ...tour,
            scenes: { ...tour.scenes, [selectedScene.id]: nextScene },
          },
          existingHotspot
            ? "Location button relocated"
            : "Location button added",
        );
        setPendingTargetSceneId(null);
        setMode("preview");
      }
    },
    [
      editingSafetyPopupId,
      mode,
      pendingTargetSceneId,
      safetyPopupForm.content,
      safetyPopupForm.hazard,
      safetyPopupForm.images,
      safetyPopupForm.safetyNote,
      safetyPopupForm.title,
      safetyPopups,
      selectedScene,
      tour,
    ],
  );

  function changeStationMode(nextMode) {
    setAdminStationMode(nextMode);
    setMode("preview");
    setPendingTargetSceneId(null);
    setMachineAreaDraftPoints([]);
    setIsMachineModalOpen(false);
    setEditingMachineAreaId(null);
    setMachineImageFile(null);
    setMachineHoverImageFile(null);
    setSafetyPopups([]);
    setSafetyPopupForm(EMPTY_SAFETY_POPUP_FORM);
    clearSafetyPopupImageFiles();
    setEditingSafetyPopupId(null);
    setSafetyEditorTab("safety");
    setMachineForm(EMPTY_MACHINE_FORM);
  }

  const goToScene = useCallback(
    (targetSceneId) => {
      if (!tour?.scenes?.[targetSceneId]) return;
      setSelectedSceneId(targetSceneId);
      setMode("preview");
      setPendingTargetSceneId(null);
      setMachineAreaDraftPoints([]);
      setIsMapModalOpen(false);
    },
    [tour],
  );

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
    const cleanZoom = Number(
      Math.min(MAP_ZOOM_MAX, Math.max(MAP_ZOOM_MIN, nextZoom)).toFixed(2),
    );
    setMapZoom(cleanZoom);
    setMapPan(clampMapPan(nextPan, cleanZoom));
  }

  function openMapModal(nextMode = "jump") {
    if (!siteMapImage)
      return alert("No site map image found for this site yet.");
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
    const nextZoom = Number(
      Math.min(MAP_ZOOM_MAX, Math.max(MAP_ZOOM_MIN, mapZoom + delta)).toFixed(
        2,
      ),
    );
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

    setMapPan(
      clampMapPan({
        x: gesture.originX + dx,
        y: gesture.originY + dy,
      }),
    );
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
    const shouldPan =
      event.button === 2 ||
      event.button === 1 ||
      (event.button === 0 && event.shiftKey);
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
      x: Number(
        Math.min(100, Math.max(0, (mapX / rect.width) * 100)).toFixed(2),
      ),
      y: Number(
        Math.min(100, Math.max(0, (mapY / rect.height) * 100)).toFixed(2),
      ),
    };
  }

  function findClosestSceneByMapPoint(point) {
    if (!point) return null;
    return (
      scenes
        .map((scene) => ({ scene, point: getSceneMapPoint(scene) }))
        .filter((item) => item.point && tour?.scenes?.[item.scene?.id])
        .map((item) => {
          const dx = normalizeAdminNumber(item.point.x, 50) - point.x;
          const dy = normalizeAdminNumber(item.point.y, 50) - point.y;
          return { ...item, distance: Math.sqrt(dx * dx + dy * dy) };
        })
        .sort((a, b) => a.distance - b.distance)[0]?.scene || null
    );
  }

  function handleMapPlacementClick(event) {
    if (!selectedScene?.id) return;
    if (event.button !== 0) return;
    if (mapPanGestureRef.current.moved) return;

    const point = getClickedMapPoint(event);
    if (!point) return;

    if (mapModalMode === "place") {
      const nextScene = { ...selectedScene, mapPoint: point, minimap: point };
      saveTour(
        { ...tour, scenes: { ...tour.scenes, [selectedScene.id]: nextScene } },
        `Map dot saved at ${point.x}, ${point.y}`,
      );
      setMapModalMode("jump");
      return;
    }

    const closestScene = findClosestSceneByMapPoint(point);
    if (closestScene?.id) {
      goToScene(closestScene.id);
    }
  }

  return (
    <div className="admin-config-page-v2 youtube-admin-config-page">
      <input
        ref={siteMapInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={handleSiteMapUpload}
      />
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
          <button type="button" onClick={() => navigate("/admin")}>
            Open Map
          </button>
          <button
            type="button"
            onClick={() =>
              navigate(
                `/viewer/${siteId}/${areaId}${selectedScene?.id ? `?scene=${selectedScene.id}` : ""}`,
              )
            }
          >
            Open Viewer
          </button>
          <button type="button" className="danger" onClick={logout}>
            Logout
          </button>
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
              <strong>Add 360 Images</strong>
              <small>Batch upload panoramas</small>
            </div>
          </button>

          <div className="admin-config-rail-title-v2">
            <span>Uploaded Images</span>
            <strong>{scenes.length}</strong>
          </div>

          <div
            ref={sceneListRef}
            className="admin-config-text-location-list-v2"
          >
            {filteredScenes.length === 0 ? (
              <div className="admin-config-empty-list-v2">
                No image names match your search.
              </div>
            ) : (
              visibleScenes.map((scene, index) => {
                const isActive = selectedScene?.id === scene.id;
                const isMapped = !!getSceneMapPoint(scene);
                const linkCount = getSceneLinkCount(scene);
                const machineCount = getSceneMachineAreaCount(scene);
                const thumbnail = resolveAssetUrl(
                  scene.thumbnail ||
                    scene.panorama ||
                    scene.image ||
                    scene.url ||
                    "",
                );
                return (
                  <button
                    key={scene.id}
                    type="button"
                    className={`admin-config-location-row-v2 admin-video-thumb-row ${isActive ? "active" : ""}`}
                    onClick={() => {
                      setSelectedSceneId(scene.id);
                      setMode("preview");
                      setPendingTargetSceneId(null);
                      setMachineAreaDraftPoints([]);
                    }}
                  >
                    <span className="admin-thumb-frame-v2">
                      {thumbnail ? (
                        <img src={thumbnail} alt="" />
                      ) : (
                        <b>{String(index + 1).padStart(2, "0")}</b>
                      )}
                    </span>
                    <span className="admin-thumb-copy-v2">
                      <strong>{getSceneTitle(scene)}</strong>
                      <small>
                        {isMapped ? "Mapped" : "No map mark"}
                        {linkCount > 0
                          ? ` • ${linkCount} link${linkCount > 1 ? "s" : ""}`
                          : ""}
                        {machineCount > 0
                          ? ` • ${machineCount} edit${machineCount > 1 ? "s" : ""}`
                          : ""}
                      </small>
                    </span>
                  </button>
                );
              })
            )}

            {visibleCount < filteredScenes.length && (
              <div
                ref={sceneListSentinelRef}
                className="admin-config-list-sentinel"
                aria-hidden="true"
              >
                <span />
              </div>
            )}
          </div>
        </aside>

        <section className="admin-config-center-stage-v2">
          <div className="admin-config-stage-header-v2 admin-station-header-v3">
            <div className="admin-station-title-v3">
              <span>Selected panorama</span>
              <strong>
                {selectedScene
                  ? getSceneTitle(selectedScene)
                  : "No image selected"}
              </strong>
            </div>

            <div className="admin-config-stage-right-v2">
              {saveMessage && (
                <span className="admin-config-save-flash-v2">
                  {saveMessage}
                </span>
              )}

              <div
                className={`admin-mode-switch-v3 ${adminStationMode === "safety" ? "is-safety" : "is-tutor"}`}
                role="group"
                aria-label="Admin station mode"
              >
                <button
                  type="button"
                  className={adminStationMode === "tutor" ? "active" : ""}
                  onClick={() => changeStationMode("tutor")}
                >
                  Tour Mode
                </button>
                <button
                  type="button"
                  className={
                    adminStationMode === "safety" ? "active safety" : ""
                  }
                  onClick={() => changeStationMode("safety")}
                >
                  Safety Mode
                </button>
              </div>

              {mode === "mark-machine-area" && (
                <div className="machine-area-draft-toolbar">
                  <button
                    type="button"
                    onClick={undoMachineAreaPoint}
                    disabled={!machineAreaDraftPoints.length}
                  >
                    Undo
                  </button>
                  <button
                    type="button"
                    className="primary"
                    onClick={finishMachineAreaDraft}
                    disabled={machineAreaDraftPoints.length < 3}
                  >
                    Finish
                  </button>
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
              showAreaLayer={mode !== "mark-location"}
              areaMode={adminStationMode}
              isPicking={
                mode === "mark-location" ||
                mode === "mark-machine-area" ||
                mode === "mark-safety-popup-area" ||
                mode === "mark-safety-popup-arrow"
              }
              pickLabel={
                mode === "mark-machine-area"
                  ? `Click ${adminStationMode} area corners (${machineAreaDraftPoints.length} point(s))`
                  : mode === "mark-safety-popup-area"
                    ? "Click where the popup rectangle should appear"
                    : mode === "mark-safety-popup-arrow"
                      ? "Click where the popup arrow should point"
                      : mode === "mark-location" && pendingTargetScene
                        ? `Click direction toward ${getSceneTitle(pendingTargetScene)}`
                        : "Click inside the panorama"
              }
              onPickPoint={handlePanoPick}
              onGoToScene={goToScene}
              machineDraftPoints={machineAreaDraftPoints}
              machineAreas={activeMachineAreas}
              safetyPopups={getSceneSafetyPopups(selectedScene)}
              onEditMachineArea={openMachineAreaEditor}
              onRemoveMachineArea={removeMachineArea}
              onEditSafetyPopup={openSafetyPopupEditor}
              isDirectionPicking={mode === "mark-location"}
              directionTargetTitle={
                pendingTargetScene ? getSceneTitle(pendingTargetScene) : ""
              }
            />
          </div>

          <div className="admin-station-details-v3 compact-admin-actions-v5">
            <button
              type="button"
              onClick={openEditLocation}
              disabled={!selectedScene}
            >
              <span>Location</span>
              <strong>Edit Location</strong>
            </button>

            <button
              type="button"
              className={`edit ${adminStationMode}`}
              onClick={openMachineAreaPicker}
              disabled={!selectedScene}
            >
              <span>Mode</span>
              <strong>
                {mode === "mark-machine-area"
                  ? `Cancel ${adminStationMode === "safety" ? "Safety" : "Tour"} Edit`
                  : `Edit ${adminStationMode === "safety" ? "Safety" : "Tour"} Mode`}
              </strong>
            </button>

            <button
              type="button"
              className="danger"
              onClick={deleteSelectedLocation}
              disabled={!selectedScene}
            >
              <span>Remove</span>
              <strong>Delete</strong>
            </button>
          </div>
        </section>
      </main>

      {isAddOpen && (
        <div
          className="admin-config-modal-backdrop-v2"
          onMouseDown={() => !isSaving && setIsAddOpen(false)}
        >
          <form
            className="admin-config-add-modal-v2"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={handleAddLocation}
          >
            <div className="admin-config-modal-header-v2">
              <div>
                <span>Add Location</span>
                <strong>Upload 360 image batch</strong>
              </div>
              <button
                type="button"
                disabled={isSaving}
                onClick={() => setIsAddOpen(false)}
              >
                ×
              </button>
            </div>

            <label className="admin-config-form-field-v2">
              <span>Location Name</span>
              <input
                value={newLocationName}
                onChange={(event) => setNewLocationName(event.target.value)}
                placeholder="Used only when uploading one image"
                disabled={isSaving}
              />
            </label>

            <label className="admin-config-upload-box-v2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleFileSelect}
                disabled={isSaving}
              />
              <b>
                {newLocationFiles.length
                  ? `${newLocationFiles.length} image(s) selected`
                  : "Choose 360 Images"}
              </b>
              <span>Batch upload JPG, PNG, WEBP panoramas</span>
            </label>

            {uploadProgress && (
              <div className="admin-config-upload-progress-v2">
                <strong>
                  Uploading {uploadProgress.current} / {uploadProgress.total}
                </strong>
                <span>{uploadProgress.name}</span>
                <div>
                  <i
                    style={{
                      width: `${(uploadProgress.current / uploadProgress.total) * 100}%`,
                    }}
                  />
                </div>
              </div>
            )}

            <div className="admin-config-modal-actions-v2">
              <button
                type="button"
                disabled={isSaving}
                onClick={() => setIsAddOpen(false)}
              >
                Cancel
              </button>
              <button type="submit" className="primary" disabled={isSaving}>
                {isSaving ? "Uploading..." : "Add Image(s)"}
              </button>
            </div>
          </form>
        </div>
      )}

      {isEditOpen && (
        <div
          className="admin-config-modal-backdrop-v2"
          onMouseDown={() => !isSaving && setIsEditOpen(false)}
        >
          <form
            className="admin-config-add-modal-v2 admin-config-edit-modal-v2 edit-location-modal-v6"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={saveEditedLocation}
          >
            <div className="admin-config-modal-header-v2">
              <div>
                <span>Location</span>
                <strong>Edit Location</strong>
              </div>
              <button
                type="button"
                disabled={isSaving}
                onClick={() => setIsEditOpen(false)}
              >
                ×
              </button>
            </div>

            <label className="admin-config-form-field-v2">
              <span>Location Name</span>
              <input
                value={editLocationName}
                onChange={(event) => setEditLocationName(event.target.value)}
                disabled={isSaving}
                autoFocus
              />
            </label>

            <label className="admin-config-upload-box-v2 edit-location-image-upload-v6">
              <input
                type="file"
                accept="image/*"
                disabled={isSaving}
                onChange={(event) =>
                  setEditLocationFile(event.target.files?.[0] || null)
                }
              />
              <b>
                {editLocationFile
                  ? editLocationFile.name
                  : "Change 360 Image"}
              </b>
              <span>
                {editLocationFile
                  ? "This image will replace the current panorama when you save."
                  : "Choose a new panorama only when you need to replace the current 360 image."}
              </span>
            </label>

            <div className="edit-location-tools-v6">
              <button
                type="button"
                disabled={isSaving || !siteMapImage}
                onClick={openEditLocationMap}
              >
                <span>Site Position</span>
                <strong>Map</strong>
                <small>Place or update this location on the site map.</small>
              </button>
              <button
                type="button"
                disabled={isSaving}
                onClick={openEditLocationLinks}
              >
                <span>Navigation</span>
                <strong>Map Locations</strong>
                <small>Add or relocate links to other panoramas.</small>
              </button>
            </div>

            <div className="admin-config-modal-actions-v2">
              <button
                type="button"
                disabled={isSaving}
                onClick={() => setIsEditOpen(false)}
              >
                Cancel
              </button>
              <button type="submit" className="primary" disabled={isSaving}>
                {isSaving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </form>
        </div>
      )}

      {isMachineModalOpen && (
        <div
          className="admin-config-modal-backdrop-v2"
          onMouseDown={() => !isSaving && cancelMachineAreaDraft()}
        >
          <form
            className={`admin-config-add-modal-v2 machine-area-modal ${adminStationMode === "safety" ? "is-safety" : "is-tour"}`}
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={saveMachineArea}
          >
            <div className="admin-config-modal-header-v2 machine-area-modal-header">
              <div>
                <span>
                  {adminStationMode === "safety" ? "Safety Area" : "Tour Area"}
                </span>
                <strong>
                  {editingMachineAreaId
                    ? "Edit information or area shape"
                    : "Add information first, then mark the area"}
                </strong>
              </div>

              <div className="machine-area-modal-header-actions">
                {adminStationMode === "safety" && (
                  <div
                    className={`admin-mode-switch-v3 machine-area-editor-switch ${safetyEditorTab === "popup" ? "is-safety" : "is-tutor"}`}
                    role="group"
                    aria-label="Safety editor section"
                  >
                    <button
                      type="button"
                      className={safetyEditorTab === "safety" ? "active" : ""}
                      onClick={() => setSafetyEditorTab("safety")}
                    >
                      Safety
                    </button>
                    <button
                      type="button"
                      className={
                        safetyEditorTab === "popup" ? "active safety" : ""
                      }
                      onClick={() => setSafetyEditorTab("popup")}
                    >
                      Pop up
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  className="machine-area-modal-close"
                  disabled={isSaving}
                  onClick={cancelMachineAreaDraft}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
            </div>

            <div className="machine-area-point-summary">
              {adminStationMode === "safety" && safetyEditorTab === "popup" ? (
                <>
                  <strong>2</strong> mapping steps: place the popup rectangle,
                  then place its connecting arrow.
                </>
              ) : (
                <>
                  <strong>{machineAreaDraftPoints.length}</strong> marked point
                  {machineAreaDraftPoints.length === 1 ? "" : "s"}. Fill the
                  fields, then click Mark Area whenever you are ready.
                </>
              )}
            </div>

            {adminStationMode === "safety" ? (
              <div className="machine-area-modal-layout is-safety">
                <section className="machine-area-main-panel is-editor-panel">
                  {safetyEditorTab === "safety" ? (
                    <>
                      <div className="machine-area-panel-head compact">
                        <div>
                          <span>Safety</span>
                          <strong>Area information</strong>
                        </div>
                      </div>

                      <div className="machine-area-field-grid machine-area-field-grid-safety">
                        <label className="admin-config-form-field-v2 machine-name-field">
                          <span>Machine Name</span>
                          <input
                            value={machineForm.machineName}
                            onChange={(event) =>
                              setMachineForm((current) => ({
                                ...current,
                                machineName: event.target.value,
                              }))
                            }
                            placeholder="Example: FD12A Filler"
                            autoFocus
                          />
                        </label>

                        <label className="admin-config-form-field-v2">
                          <span>Description</span>
                          <textarea
                            value={machineForm.purpose}
                            onChange={(event) =>
                              setMachineForm((current) => ({
                                ...current,
                                purpose: event.target.value,
                              }))
                            }
                            placeholder="Example: Prevents access to moving parts while the machine is running."
                          />
                        </label>
                      </div>

                      <div className="machine-area-media-grid compact-media-grid">
                        <div className="machine-area-media-field compact-media-field">
                          <div>
                            <strong>Popup Image</strong>
                            <span>Shown when the Safety area is opened.</span>
                          </div>
                          <label>
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(event) =>
                                setMachineImageFile(
                                  event.target.files?.[0] || null,
                                )
                              }
                            />
                            <b>
                              {machineImageFile?.name ||
                                (machineForm.image
                                  ? "Replace image"
                                  : "Choose image")}
                            </b>
                          </label>
                          {(machineForm.image || machineImageFile) && (
                            <button
                              type="button"
                              onClick={() => {
                                setMachineImageFile(null);
                                setMachineForm((current) => ({
                                  ...current,
                                  image: "",
                                }));
                              }}
                            >
                              Remove
                            </button>
                          )}
                        </div>

                        <div className="machine-area-media-field compact-media-field">
                          <div>
                            <strong>Hover Image</strong>
                            <span>
                              Shown while pointing at the marked area.
                            </span>
                          </div>
                          <label>
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(event) =>
                                setMachineHoverImageFile(
                                  event.target.files?.[0] || null,
                                )
                              }
                            />
                            <b>
                              {machineHoverImageFile?.name ||
                                (machineForm.hoverImage
                                  ? "Replace image"
                                  : "Choose image")}
                            </b>
                          </label>
                          {(machineForm.hoverImage ||
                            machineHoverImageFile) && (
                            <button
                              type="button"
                              onClick={() => {
                                setMachineHoverImageFile(null);
                                setMachineForm((current) => ({
                                  ...current,
                                  hoverImage: "",
                                }));
                              }}
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="machine-area-mark-card">
                        <div>
                          <strong>Mark area on panorama</strong>
                          <span>
                            Click the button, then mark the machine outline in
                            the panorama.
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => startMachineAreaPick({ reset: true })}
                        >
                          {machineAreaDraftPoints.length
                            ? "Re-mark Area"
                            : "Mark Area"}
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="machine-area-panel-head compact">
                        <div>
                          <span>Pop up</span>
                          <strong>Information details</strong>
                        </div>
                      </div>

                      <div className="machine-area-popup-form">
                        <label className="admin-config-form-field-v2">
                          <span>Popup Title</span>
                          <input
                            value={safetyPopupForm.title}
                            onChange={(event) =>
                              setSafetyPopupForm((current) => ({
                                ...current,
                                title: event.target.value,
                              }))
                            }
                            placeholder="Example: Keep Hands Clear"
                          />
                        </label>

                        <label className="admin-config-form-field-v2 popup-description-field">
                          <span>Popup Description</span>
                          <textarea
                            value={safetyPopupForm.content}
                            onChange={(event) =>
                              setSafetyPopupForm((current) => ({
                                ...current,
                                content: event.target.value,
                              }))
                            }
                            placeholder="Example: This area contains moving parts. Do not reach through the guard while the machine is running."
                          />
                        </label>

                        <label className="admin-config-form-field-v2">
                          <span>Hazard</span>
                          <textarea
                            value={safetyPopupForm.hazard}
                            onChange={(event) =>
                              setSafetyPopupForm((current) => ({
                                ...current,
                                hazard: event.target.value,
                              }))
                            }
                            placeholder="Example: Moving parts and pinch points."
                          />
                        </label>

                        <label className="admin-config-form-field-v2">
                          <span>Safety Instructions</span>
                          <textarea
                            value={safetyPopupForm.safetyNote}
                            onChange={(event) =>
                              setSafetyPopupForm((current) => ({
                                ...current,
                                safetyNote: event.target.value,
                              }))
                            }
                            placeholder="Example: Keep guards closed and isolate power before access."
                          />
                        </label>

                        <div className="safety-popup-image-field">
                          <div className="safety-popup-image-field-head">
                            <div>
                              <strong>Popup Images</strong>
                              <span>
                                Add one or more images to the full Safety popup.
                                These are separate from the area Hover Image.
                              </span>
                            </div>
                            <label className="safety-popup-image-picker">
                              <input
                                type="file"
                                accept="image/*"
                                multiple
                                onChange={handleSafetyPopupImagesSelect}
                              />
                              <b>+ Add Images</b>
                            </label>
                          </div>

                          {getSafetyPopupImages(safetyPopupForm).length > 0 ||
                          safetyPopupImageFiles.length > 0 ? (
                            <div className="safety-popup-image-preview-grid">
                              {getSafetyPopupImages(safetyPopupForm).map(
                                (image, index) => (
                                  <figure key={`${image}-${index}`}>
                                    <img
                                      src={resolveAssetUrl(image)}
                                      alt={`Saved popup image ${index + 1}`}
                                    />
                                    <button
                                      type="button"
                                      aria-label={`Remove saved popup image ${index + 1}`}
                                      title="Remove image"
                                      onClick={() =>
                                        removeSavedSafetyPopupImage(index)
                                      }
                                    >
                                      ×
                                    </button>
                                  </figure>
                                ),
                              )}
                              {safetyPopupImageFiles.map(
                                ({ id, file, previewUrl }) => (
                                  <figure className="is-new" key={id}>
                                    <img
                                      src={previewUrl}
                                      alt={file.name || "New popup image"}
                                    />
                                    <span>New</span>
                                    <button
                                      type="button"
                                      aria-label={`Remove ${file.name || "new popup image"}`}
                                      title="Remove image"
                                      onClick={() =>
                                        removeQueuedSafetyPopupImage(id)
                                      }
                                    >
                                      ×
                                    </button>
                                  </figure>
                                ),
                              )}
                            </div>
                          ) : (
                            <div className="safety-popup-image-empty">
                              No popup images added.
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="popup-placement-grid">
                        <div className="machine-area-mark-card popup-mark-card">
                          <div>
                            <strong>Map popup rectangle</strong>
                            <span>
                              {hasPopupPoint(
                                getPopupAreaPoint(activeSafetyPopup || {}),
                              )
                                ? "Popup position mapped. Click again to move it."
                                : "Click once where the popup rectangle should appear."}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={startSafetyPopupAreaPick}
                          >
                            {hasPopupPoint(
                              getPopupAreaPoint(activeSafetyPopup || {}),
                            )
                              ? "Re-map Popup"
                              : "Map Popup"}
                          </button>
                        </div>

                        <div className="machine-area-mark-card popup-mark-card">
                          <div>
                            <strong>Map connecting arrow</strong>
                            <span>
                              {hasPopupPoint(
                                getPopupArrowPoint(activeSafetyPopup || {}),
                              )
                                ? "Arrow target mapped. Click again to move it."
                                : "Click once where the arrow should point."}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={startSafetyPopupArrowPick}
                          >
                            {hasPopupPoint(
                              getPopupArrowPoint(activeSafetyPopup || {}),
                            )
                              ? "Re-map Arrow"
                              : "Map Arrow"}
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </section>

                <section className="machine-area-popup-panel is-list-panel">
                  <div className="machine-area-panel-head">
                    <div>
                      <span>
                        {safetyEditorTab === "safety"
                          ? "Safety areas"
                          : "Popup markers"}
                      </span>
                      <strong>
                        {safetyEditorTab === "safety"
                          ? "Marked machine areas"
                          : "Popup markers on panorama"}
                      </strong>
                    </div>

                    <button
                      type="button"
                      className="machine-area-new-button"
                      onClick={
                        safetyEditorTab === "safety"
                          ? startNewMachineAreaForm
                          : startNewSafetyPopup
                      }
                    >
                      {safetyEditorTab === "safety"
                        ? "+ New Area"
                        : "+ New Popup"}
                    </button>
                  </div>

                  <div className="safety-popup-help">
                    {safetyEditorTab === "safety"
                      ? "Manage your marked Safety areas here. Click Edit to load the selected area back into the form."
                      : "Manage your popup markers here. Click Edit to load the selected popup details back into the form."}
                  </div>

                  {safetyEditorTab === "safety" ? (
                    activeMachineAreas.length > 0 ? (
                      <div className="machine-area-saved-items machine-area-safety-list">
                        {activeMachineAreas.map((machineArea, index) => {
                          const isEditing =
                            editingMachineAreaId === machineArea.id;
                          const points =
                            getMachineAreaPoints(machineArea).length;
                          return (
                            <article
                              key={machineArea.id || index}
                              className={`machine-area-saved-item ${isEditing ? "is-editing" : ""}`}
                            >
                              <button
                                type="button"
                                className="machine-area-saved-main"
                                onClick={() =>
                                  openMachineAreaEditor(machineArea)
                                }
                              >
                                <b>{String(index + 1).padStart(2, "0")}</b>
                                <div>
                                  <strong>
                                    {getMachineAreaTitle(machineArea)}
                                  </strong>
                                  <span>
                                    {getMachineAreaPurpose(
                                      machineArea,
                                      getMachineAreaMode(machineArea),
                                    ) ||
                                      `${points} point${points === 1 ? "" : "s"}`}
                                  </span>
                                </div>
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  openMachineAreaEditor(machineArea)
                                }
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className="danger"
                                onClick={() =>
                                  removeMachineArea(machineArea.id)
                                }
                              >
                                Delete
                              </button>
                            </article>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="machine-area-empty-state">
                        No Safety areas yet.
                      </div>
                    )
                  ) : safetyPopups.length > 0 ? (
                    <div className="machine-area-saved-items safety-popup-saved-items">
                      {safetyPopups.map((popup, index) => {
                        const isEditingPopup =
                          editingSafetyPopupId === popup.id;
                        return (
                          <article
                            key={popup.id || index}
                            className={`machine-area-saved-item ${isEditingPopup ? "is-editing" : ""}`}
                          >
                            <button
                              type="button"
                              className="machine-area-saved-main"
                              onClick={() => openSafetyPopupEditor(popup)}
                            >
                              <b>{String(index + 1).padStart(2, "0")}</b>
                              <div>
                                <strong>{popup.title || "Popup"}</strong>
                                <span>
                                  {popup.content || "No details added."}
                                </span>
                              </div>
                            </button>
                            <button
                              type="button"
                              onClick={() => openSafetyPopupEditor(popup)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="danger"
                              onClick={() => removeSafetyPopup(popup.id)}
                            >
                              Delete
                            </button>
                          </article>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="machine-area-empty-state">
                      No popup markers yet.
                    </div>
                  )}
                </section>
              </div>
            ) : (
              <>
                {activeMachineAreas.length > 0 && (
                  <section className="machine-area-saved-list">
                    <div className="machine-area-saved-list-head">
                      <div>
                        <span>Marked Entries</span>
                        <strong>{activeMachineAreas.length} saved</strong>
                      </div>
                      <button type="button" onClick={startNewMachineAreaForm}>
                        New
                      </button>
                    </div>

                    <div className="machine-area-saved-items">
                      {activeMachineAreas.map((machineArea, index) => {
                        const isEditing =
                          editingMachineAreaId === machineArea.id;
                        const points = getMachineAreaPoints(machineArea).length;
                        return (
                          <article
                            key={machineArea.id || index}
                            className={`machine-area-saved-item ${isEditing ? "is-editing" : ""}`}
                          >
                            <button
                              type="button"
                              className="machine-area-saved-main"
                              onClick={() => openMachineAreaEditor(machineArea)}
                            >
                              <b>{String(index + 1).padStart(2, "0")}</b>
                              <div>
                                <strong>
                                  {getMachineAreaTitle(machineArea)}
                                </strong>
                                <span>
                                  {getMachineAreaPurpose(
                                    machineArea,
                                    getMachineAreaMode(machineArea),
                                  ) ||
                                    `${points} point${points === 1 ? "" : "s"}`}
                                </span>
                              </div>
                            </button>
                            <button
                              type="button"
                              onClick={() => openMachineAreaEditor(machineArea)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="danger"
                              onClick={() => removeMachineArea(machineArea.id)}
                            >
                              Delete
                            </button>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                )}

                <label className="admin-config-form-field-v2">
                  <span>Machine Name</span>
                  <input
                    value={machineForm.machineName}
                    onChange={(event) =>
                      setMachineForm((current) => ({
                        ...current,
                        machineName: event.target.value,
                      }))
                    }
                    placeholder="Example: FD12A Filler"
                    autoFocus
                  />
                </label>

                <label className="admin-config-form-field-v2">
                  <span>Purpose</span>
                  <textarea
                    value={machineForm.purpose}
                    onChange={(event) =>
                      setMachineForm((current) => ({
                        ...current,
                        purpose: event.target.value,
                      }))
                    }
                    placeholder="Example: Fills product into sachets before sealing."
                  />
                </label>
              </>
            )}

            <div className="admin-config-modal-actions-v2">
              <button
                type="button"
                disabled={isSaving}
                onClick={cancelMachineAreaDraft}
              >
                Cancel
              </button>
              {adminStationMode !== "safety" && (
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => startMachineAreaPick({ reset: true })}
                >
                  {machineAreaDraftPoints.length ? "Re-mark Area" : "Mark Area"}
                </button>
              )}
              <button type="submit" className="primary" disabled={isSaving}>
                {isSaving
                  ? "Saving..."
                  : adminStationMode === "safety" && safetyEditorTab === "popup"
                    ? "Save Popup"
                    : editingMachineAreaId
                      ? `Update ${adminStationMode === "safety" ? "Safety" : "Tour"} Area`
                      : `Save ${adminStationMode === "safety" ? "Safety" : "Tour"} Area`}
              </button>
            </div>
          </form>
        </div>
      )}

      {isLocationManagerOpen && (
        <div
          className="admin-config-modal-backdrop-v2"
          onMouseDown={() => setIsLocationManagerOpen(false)}
        >
          <section
            className="admin-config-link-modal-v2 direction-link-modal"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="admin-config-modal-header-v2">
              <div>
                <span>Mark Area</span>
                <strong>Choose panorama, then pick direction</strong>
              </div>
              <button
                type="button"
                onClick={() => setIsLocationManagerOpen(false)}
              >
                ×
              </button>
            </div>

            <div className="direction-marking-instructions">
              <strong>New marking logic</strong>
              <span>
                Click Add beside the destination panorama. Then click only the
                direction in the 360 image. The arrow will stay near the
                standing point instead of exactly where you clicked.
              </span>
            </div>

            <div className="admin-config-text-target-list-v2 direction-panorama-list">
              {linkTargetScenes.map((scene, index) => {
                const existingHotspot = selectedHotspots.find(
                  (hotspot) => hotspot?.targetSceneId === scene.id,
                );
                return (
                  <div key={scene.id} className="direction-panorama-row">
                    <button
                      type="button"
                      className="admin-config-target-row-v2"
                      onClick={() => chooseTargetScene(scene.id)}
                    >
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <strong>{getSceneTitle(scene)}</strong>
                      <em>{existingHotspot ? "Relocate" : "Add"}</em>
                    </button>
                    {existingHotspot && (
                      <button
                        type="button"
                        className="direction-remove-link"
                        onClick={() => removeHotspot(existingHotspot.id)}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      )}

      {isMapModalOpen && (
        <div
          className="admin-config-modal-backdrop-v2"
          onMouseDown={() => setIsMapModalOpen(false)}
        >
          <section
            className="admin-config-map-modal-v2"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="admin-config-modal-header-v2">
              <div>
                <span>Map</span>
                <strong>
                  {mapModalMode === "place"
                    ? `Place ${getSceneTitle(selectedScene)}`
                    : "View map, change map, or jump to closest location"}
                </strong>
              </div>
              <button type="button" onClick={() => setIsMapModalOpen(false)}>
                ×
              </button>
            </div>

            <div className="admin-config-map-toolbar-v2">
              <p className="admin-config-map-help-v2">
                Scroll to zoom. Right click-drag to move. Click anywhere to jump
                to the closest marked location, or press Add/Update to place the
                selected location.
              </p>
              <div className="admin-config-map-zoom-controls-v2">
                <button
                  type="button"
                  onClick={() => updateMapZoom(-MAP_ZOOM_STEP)}
                  disabled={mapZoom <= MAP_ZOOM_MIN}
                >
                  −
                </button>
                <span>{Math.round(mapZoom * 100)}%</span>
                <button
                  type="button"
                  onClick={() => updateMapZoom(MAP_ZOOM_STEP)}
                  disabled={mapZoom >= MAP_ZOOM_MAX}
                >
                  +
                </button>
                <button type="button" onClick={resetMapZoom}>
                  Reset
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    siteMapInputRef.current?.click();
                  }}
                >
                  Change Map
                </button>
                <button
                  type="button"
                  className={mapModalMode === "place" ? "primary" : ""}
                  onClick={(event) => {
                    event.stopPropagation();
                    setMapModalMode("place");
                  }}
                >
                  Add/Update Selected Mark
                </button>
                {getSceneMapPoint(selectedScene) && (
                  <button
                    type="button"
                    className="danger"
                    onClick={(event) => {
                      event.stopPropagation();
                      removeMapPoint();
                      setMapModalMode("jump");
                    }}
                  >
                    Remove Selected Mark
                  </button>
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
                <img
                  src={siteMapImage}
                  alt={site?.name || siteId}
                  draggable="false"
                />
                {area?.points && (
                  <svg
                    className="admin-config-map-area-overlay-v2"
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                  >
                    <polygon points={area.points} />
                  </svg>
                )}
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
                      onClick={(event) => {
                        event.stopPropagation();
                        goToScene(scene.id);
                      }}
                    />
                  );
                })}
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export default AdminAreaConfigPage;
