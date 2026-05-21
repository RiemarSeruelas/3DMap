import { factoryMaps } from "../data/mapData";

export const ADMIN_STORAGE_KEY = "streetViewAdminData";
export const LEGACY_FACTORY_MAPS_KEY = "streetViewAdminFactoryMaps";

export function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function clone(value) {
  return deepClone(value);
}

function safeParse(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

export function makeSlug(text, fallback = "item") {
  const slug = String(text || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || `${fallback}-${Date.now()}`;
}

export function getAdminData() {
  const data = safeParse(localStorage.getItem(ADMIN_STORAGE_KEY), null);

  if (data && typeof data === "object") {
    return {
      version: data.version || 1,
      sites: data.sites || {},
    };
  }

  return { version: 1, sites: {} };
}

export function saveAdminData(nextData) {
  localStorage.setItem(
    ADMIN_STORAGE_KEY,
    JSON.stringify(
      {
        version: 1,
        sites: nextData?.sites || {},
      },
      null,
      2
    )
  );

  window.dispatchEvent(new Event("streetViewAdminDataChanged"));
}

export function resetAdminData() {
  localStorage.removeItem(ADMIN_STORAGE_KEY);
  localStorage.removeItem(LEGACY_FACTORY_MAPS_KEY);
  localStorage.removeItem("streetViewAdminTours");
  localStorage.removeItem("streetViewAdminMapData");
  window.dispatchEvent(new Event("streetViewAdminDataChanged"));
}

function getLegacyFullFactoryMaps() {
  return safeParse(localStorage.getItem(LEGACY_FACTORY_MAPS_KEY), null);
}

function getLegacyTour(siteId, areaId) {
  const legacyKeys = ["streetViewAdminTours", "streetViewAdminMapData"];

  for (const key of legacyKeys) {
    const data = safeParse(localStorage.getItem(key), null);
    if (!data) continue;

    const keyedTour = data[`${siteId}:${areaId}`];
    if (keyedTour) return keyedTour;

    const siteTour = data?.sites?.[siteId]?.areas?.find?.((area) => area.id === areaId)?.tour;
    if (siteTour) return siteTour;
  }

  return null;
}

export function getMergedSite(sourceFactoryMaps = factoryMaps, siteId) {
  const legacyFactoryMaps = getLegacyFullFactoryMaps();
  const baseSource = legacyFactoryMaps || sourceFactoryMaps || factoryMaps;
  const baseSite = baseSource?.[siteId];

  if (!baseSite) return null;

  const mergedSite = deepClone(baseSite);
  const adminData = getAdminData();
  const savedSite = adminData.sites?.[siteId];

  if (savedSite) {
    mergedSite.id = savedSite.id || mergedSite.id;
    mergedSite.name = savedSite.name || mergedSite.name;
    mergedSite.subtitle = savedSite.subtitle || mergedSite.subtitle;
    mergedSite.image = savedSite.image || mergedSite.image;
    mergedSite.mapImage = savedSite.mapImage || mergedSite.mapImage;

    if (Array.isArray(savedSite.areas)) {
      mergedSite.areas = savedSite.areas;
    }
  }

  mergedSite.areas = Array.isArray(mergedSite.areas) ? mergedSite.areas : [];

  mergedSite.areas = mergedSite.areas.map((area) => {
    const legacyTour = getLegacyTour(siteId, area.id);
    return legacyTour ? { ...area, tour: legacyTour } : area;
  });

  return mergedSite;
}

export function getMergedFactoryMaps(sourceFactoryMaps = factoryMaps) {
  const legacyFactoryMaps = getLegacyFullFactoryMaps();
  const baseSource = legacyFactoryMaps || sourceFactoryMaps || factoryMaps;
  const result = deepClone(baseSource);

  Object.keys(result).forEach((siteId) => {
    const mergedSite = getMergedSite(baseSource, siteId);
    if (mergedSite) result[siteId] = mergedSite;
  });

  return result;
}

export function getMergedArea(sourceFactoryMaps = factoryMaps, siteId, areaId) {
  const site = getMergedSite(sourceFactoryMaps, siteId);
  return site?.areas?.find((area) => area.id === areaId) || null;
}

export function getSavedFactoryMaps() {
  return getMergedFactoryMaps(factoryMaps);
}

export function saveFactoryMaps(nextFactoryMaps) {
  if (!nextFactoryMaps || typeof nextFactoryMaps !== "object") return false;

  const nextData = { version: 1, sites: {} };
  Object.keys(nextFactoryMaps).forEach((siteId) => {
    nextData.sites[siteId] = nextFactoryMaps[siteId];
  });

  saveAdminData(nextData);
  return true;
}

export function clearSavedFactoryMaps() {
  resetAdminData();
}

export function getEffectiveFactoryMaps() {
  return getMergedFactoryMaps(factoryMaps);
}

export function getEffectiveSite(siteId) {
  return getMergedSite(factoryMaps, siteId);
}

export function getEffectiveArea(siteId, areaId) {
  return getMergedArea(factoryMaps, siteId, areaId);
}

export function getEffectiveTour(siteId, areaId) {
  return getEffectiveArea(siteId, areaId)?.tour || null;
}

export function createEmptyTour({ areaId, areaName }) {
  return {
    id: `${areaId}-tour`,
    name: `${areaName} Tour`,
    version: 1,
    settings: {
      firstScene: null,
      defaultHfov: 110,
      mobileHfov: 90,
    },
    scenes: {},
    connections: [],
  };
}

export function createSceneFromUpload({ sceneId, title, label, panorama, mapPoint }) {
  return {
    id: sceneId,
    title,
    label,
    panorama,
    mapPoint: mapPoint || { x: 50, y: 50 },
    view: {
      initialYaw: 0,
      initialPitch: 0,
      initialHfov: 110,
    },
  };
}

export function createConnection({ from, to, label, hotspot }) {
  return {
    id: `${from}-to-${to}-${Date.now()}`,
    from,
    to,
    label: label || "Next Location",
    type: "move",
    hotspot: hotspot || {
      x: 50,
      y: 50,
      icon: "→",
    },
  };
}
