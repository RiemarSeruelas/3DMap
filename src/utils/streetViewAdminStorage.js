import { factoryMaps } from "../data/mapData";

export const STORAGE_KEY = "streetViewAdminFactoryMaps";

let memoryFactoryMaps = null;
let publicJsonHydrated = false;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function safeParse(value) {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function hasUsableMaps(value) {
  return value && typeof value === "object" && Object.keys(value).length > 0;
}

function getSaveApiBase() {
  if (typeof window === "undefined") return "http://localhost:3010";

  const override = window.__STREETVIEW_SAVE_API_BASE__;
  if (typeof override === "string" && override.trim()) {
    return override.trim().replace(/\/$/, "");
  }

  return "";
}

function normalizeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeSceneView(scene = {}) {
  const view = scene.view || {};
  return {
    initialYaw: normalizeNumber(
      view.initialYaw,
      normalizeNumber(scene.initialYaw, 0),
    ),
    initialPitch: normalizeNumber(
      view.initialPitch,
      normalizeNumber(scene.initialPitch, 0),
    ),
    initialHfov: normalizeNumber(
      view.initialHfov,
      normalizeNumber(scene.initialHfov, 110),
    ),
    northOffset: normalizeNumber(
      view.northOffset ??
        view.yawOffset ??
        scene.northOffset ??
        scene.yawOffset,
      0,
    ),
  };
}

function normalizePoint(point = {}) {
  return {
    pitch: normalizeNumber(point.pitch, 0),
    yaw: normalizeNumber(point.yaw, 0),
    x: normalizeNumber(point.x, 50),
    y: normalizeNumber(point.y, 50),
  };
}

function normalizeImageList(...values) {
  const seen = new Set();

  return values
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
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

function normalizeSafetyPopup(popup = {}) {
  const legacyPoint = normalizePoint(popup);
  const popupArea = normalizePoint(
    popup.popupArea || popup.areaPoint || popup.position || legacyPoint,
  );
  const arrowSource =
    popup.arrowPoint || popup.pointerPoint || popup.targetPoint || null;
  const arrowPoint = arrowSource ? normalizePoint(arrowSource) : null;

  return {
    ...popup,
    id: popup.id || createId(popup.title || "safety-popup"),
    title: popup.title || popup.name || "Popup",
    content: popup.content || popup.paragraph || popup.description || "",
    hazard: popup.hazard || "",
    safetyNote: popup.safetyNote || popup.safety || "",
    images: normalizeImageList(popup.images, popup.image, popup.popupImage),
    machineAreaId: popup.machineAreaId || popup.safetyAreaId || null,
    popupArea,
    arrowPoint,
    pitch: popupArea.pitch,
    yaw: popupArea.yaw,
    x: popupArea.x,
    y: popupArea.y,
  };
}

function normalizeMachineArea(area = {}) {
  const mode = area.mode === "tutor" ? "tutor" : "safety";
  const tutorPurpose =
    area.tutorPurpose ||
    (mode === "tutor" ? area.purpose : "") ||
    area.description ||
    area.machineType ||
    "";
  const safetyPurpose =
    area.safetyPurpose || (mode === "safety" ? area.purpose : "") || "";

  return {
    ...area,
    id: area.id || createId(area.machineName || area.name || "machine-area"),
    type: "machineArea",
    mode,
    machineName: area.machineName || area.name || "Machine",
    purpose: mode === "safety" ? safetyPurpose : tutorPurpose,
    tutorPurpose,
    safetyPurpose,
    hazard: area.hazard || "",
    safetyNote: area.safetyNote || area.safety || "",
    image: area.image || area.machineImage || area.popupImage || "",
    hoverImage: area.hoverImage || area.openImage || area.overlayImage || "",
    safetyPopups: Array.isArray(area.safetyPopups)
      ? area.safetyPopups.map(normalizeSafetyPopup)
      : [],
    points: Array.isArray(area.points) ? area.points.map(normalizePoint) : [],
  };
}

function normalizeScene(scene = {}) {
  return {
    ...scene,
    hotspots: Array.isArray(scene.hotspots) ? scene.hotspots : [],
    machineMarkers: Array.isArray(scene.machineMarkers)
      ? scene.machineMarkers
      : [],
    machineAreas: Array.isArray(scene.machineAreas)
      ? scene.machineAreas.map(normalizeMachineArea)
      : [],
    safetyPopups: Array.isArray(scene.safetyPopups)
      ? scene.safetyPopups.map(normalizeSafetyPopup)
      : [],
    mapPoint: scene.mapPoint || scene.minimap || null,
    minimap: scene.minimap || scene.mapPoint || null,
    view: normalizeSceneView(scene),
  };
}

function normalizeScenes(scenes = {}) {
  return Object.fromEntries(
    Object.entries(scenes || {}).map(([sceneId, scene]) => [
      sceneId,
      normalizeScene({ id: scene?.id || sceneId, ...scene }),
    ]),
  );
}

export function getBaseFactoryMaps() {
  return factoryMaps;
}

export async function hydrateFactoryMapsFromPublicJson({ force = false } = {}) {
  if (publicJsonHydrated && !force) return getEffectiveFactoryMaps();

  try {
    const response = await fetch(`/data/streetview-data.json?_=${Date.now()}`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const payload = await response.json();
    const maps = payload?.factoryMaps || payload;

    if (hasUsableMaps(maps)) {
      memoryFactoryMaps = normalizeMaps(maps);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(memoryFactoryMaps));
      } catch {}
      window.dispatchEvent(new Event("streetview-admin-storage-updated"));
    }
  } catch {
  } finally {
    publicJsonHydrated = true;
  }

  return getEffectiveFactoryMaps();
}

function dataUrlToFile(dataUrl, filename) {
  const [header, base64] = dataUrl.split(",");
  const mime = header.match(/data:(.*?);base64/)?.[1] || "image/jpeg";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return new File([bytes], filename, { type: mime });
}

export function createImageThumbnail(
  file,
  { maxWidth = 420, quality = 0.78 } = {},
) {
  return new Promise((resolve) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      try {
        const ratio = image.width ? maxWidth / image.width : 1;
        const width = Math.max(
          1,
          Math.round(Math.min(maxWidth, image.width || maxWidth)),
        );
        const height = Math.max(
          1,
          Math.round((image.height || maxWidth / 2) * Math.min(1, ratio)),
        );

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0, width, height);

        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        const thumbName = file.name.replace(/\.[^/.]+$/, "") + "-thumb.jpg";
        resolve(dataUrlToFile(dataUrl, thumbName));
      } catch {
        resolve(null);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(null);
    };

    image.src = objectUrl;
  });
}

export async function uploadAdminImage(file, kind = "panos") {
  if (!file) return "";

  try {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("kind", kind);

    const response = await fetch(`${getSaveApiBase()}/api/admin/upload-asset`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(text || `Upload server responded ${response.status}`);
    }

    const payload = await response.json();
    return payload.publicPath || payload.path || payload.url || "";
  } catch (error) {
    console.warn(
      "[streetview-admin] Image upload server unavailable. Falling back to temporary browser URL.",
      error,
    );
    return URL.createObjectURL(file);
  }
}

export async function uploadAssetFile(file, folder = "panos") {
  const publicPath = await uploadAdminImage(file, folder);
  return {
    url: publicPath,
    publicPath,
    fallback: publicPath?.startsWith("blob:") || false,
  };
}

export async function uploadPanoramaAsset(file) {
  const [full, thumbnailFile] = await Promise.all([
    uploadAssetFile(file, "panos"),
    createImageThumbnail(file),
  ]);

  let thumbnail = null;
  if (thumbnailFile) {
    thumbnail = await uploadAssetFile(thumbnailFile, "thumbs");
  }

  return {
    panorama: full.publicPath || full.url,
    thumbnail:
      thumbnail?.publicPath || thumbnail?.url || full.publicPath || full.url,
  };
}

async function syncMapsToDataFile(nextMaps) {
  try {
    const response = await fetch(`${getSaveApiBase()}/api/admin/save-mapdata`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ factoryMaps: nextMaps }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(text || `Save server responded ${response.status}`);
    }

    const payload = await response.json().catch(() => ({}));
    if (hasUsableMaps(payload.factoryMaps)) {
      memoryFactoryMaps = normalizeMaps(payload.factoryMaps);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(memoryFactoryMaps));
      } catch (error) {
        console.error(
          "[streetview-admin] Failed to save maps to localStorage.",
          error,
        );
      }
    }

    window.dispatchEvent(
      new CustomEvent("streetview-admin-js-save-status", {
        detail: { ok: true, savedTo: payload.savedTo },
      }),
    );
  } catch (error) {
    window.dispatchEvent(
      new CustomEvent("streetview-admin-js-save-status", {
        detail: { ok: false, error: error.message },
      }),
    );
  }
}

function normalizeMaps(maps) {
  const source = hasUsableMaps(maps) ? maps : getBaseFactoryMaps();
  const next = clone(source);

  Object.values(next).forEach((site) => {
    site.areas = Array.isArray(site.areas) ? site.areas : [];
    site.areas = site.areas.map((area) => ({
      ...area,
      points: area.points || "",
      tour: ensureTour(area.tour, area),
    }));
  });

  return next;
}

export function ensureTour(tour, area = {}) {
  const areaSlug = area.id || `area-${Date.now()}`;

  if (tour?.scenes && tour?.settings) {
    const normalizedScenes = normalizeScenes(tour.scenes || {});

    return {
      ...tour,
      id: tour.id || `${areaSlug}-tour`,
      name: tour.name || `${area.name || "Area"} Tour`,
      version: tour.version || 1,
      mapImage: tour.mapImage || undefined,
      settings: {
        firstScene:
          tour.settings.firstScene ||
          Object.keys(normalizedScenes || {})[0] ||
          null,
        defaultHfov: tour.settings.defaultHfov || 110,
        mobileHfov: tour.settings.mobileHfov || 90,
        ...tour.settings,
      },
      scenes: normalizedScenes,
      connections: Array.isArray(tour.connections) ? tour.connections : [],
    };
  }

  return {
    id: `${areaSlug}-tour`,
    name: `${area.name || "Area"} Tour`,
    version: 1,
    settings: { firstScene: null, defaultHfov: 110, mobileHfov: 90 },
    scenes: {},
    connections: [],
  };
}

export function getSavedFactoryMaps() {
  if (hasUsableMaps(memoryFactoryMaps)) return normalizeMaps(memoryFactoryMaps);
  const saved = safeParse(localStorage.getItem(STORAGE_KEY));
  return hasUsableMaps(saved) ? normalizeMaps(saved) : null;
}

export function saveFactoryMaps(nextMaps) {
  const normalized = normalizeMaps(nextMaps);
  memoryFactoryMaps = normalized;
  syncMapsToDataFile(normalized);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  } catch (error) {
    console.warn(
      "[streetview-admin] localStorage save failed. The JSON save server is required for persistence.",
      error,
    );
  }
  window.dispatchEvent(new Event("streetview-admin-storage-updated"));
  return normalized;
}

export function resetSavedFactoryMaps() {
  memoryFactoryMaps = null;
  localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event("streetview-admin-storage-updated"));
}

export async function getEffectiveFactoryMapsAsync({ force = false } = {}) {
  return hydrateFactoryMapsFromPublicJson({ force });
}

export function getEffectiveFactoryMaps() {
  return getSavedFactoryMaps() || normalizeMaps(getBaseFactoryMaps());
}

export function getMergedSite(siteId) {
  return getEffectiveFactoryMaps()[siteId] || null;
}

export function getEffectiveSite(siteId) {
  return getMergedSite(siteId);
}

export function getMergedArea(siteId, areaId) {
  const site = getMergedSite(siteId);
  return site?.areas?.find((area) => area.id === areaId) || null;
}

export function getEffectiveArea(siteId, areaId) {
  return getMergedArea(siteId, areaId);
}

export function getEffectiveTour(siteId, areaId) {
  const area = getMergedArea(siteId, areaId);
  return ensureTour(area?.tour, area);
}

export function saveArea(siteId, area) {
  const maps = getEffectiveFactoryMaps();
  const site = maps[siteId];
  if (!site) return maps;

  const cleanArea = {
    ...area,
    id: area.id || createId(area.name || "area"),
    name: area.name || "Untitled Area",
    points: area.points || "",
    tour: ensureTour(area.tour, area),
  };

  const exists = site.areas.some((item) => item.id === cleanArea.id);
  site.areas = exists
    ? site.areas.map((item) => (item.id === cleanArea.id ? cleanArea : item))
    : [...site.areas, cleanArea];
  return saveFactoryMaps(maps);
}

export function deleteArea(siteId, areaId) {
  const maps = getEffectiveFactoryMaps();
  const site = maps[siteId];
  if (!site) return maps;
  site.areas = site.areas.filter((area) => area.id !== areaId);
  return saveFactoryMaps(maps);
}

export function updateAreaTour(siteId, areaId, nextTour) {
  const maps = getEffectiveFactoryMaps();
  const site = maps[siteId];
  if (!site) return maps;

  site.areas = site.areas.map((area) =>
    area.id === areaId ? { ...area, tour: ensureTour(nextTour, area) } : area,
  );

  return saveFactoryMaps(maps);
}

export function createId(text = "item") {
  return (
    text
      .toString()
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || `item-${Date.now()}`
  );
}

export function createUniqueId(base, existingIds = []) {
  const cleanBase = createId(base || "item");
  let candidate = cleanBase;
  let index = 2;
  while (existingIds.includes(candidate)) {
    candidate = `${cleanBase}-${index}`;
    index += 1;
  }
  return candidate;
}

export function pointsArrayToString(points) {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

export function pointsStringToArray(points = "") {
  return points
    .trim()
    .split(/\s+/)
    .map((pair) => {
      const [x, y] = pair.split(",").map(Number);
      return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
    })
    .filter(Boolean);
}

export function getPercentPoint(event, element) {
  const rect = element.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * 100;
  const y = ((event.clientY - rect.top) / rect.height) * 100;
  return {
    x: Number(Math.max(0, Math.min(100, x)).toFixed(2)),
    y: Number(Math.max(0, Math.min(100, y)).toFixed(2)),
  };
}
