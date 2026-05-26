import { factoryMaps } from "../data/mapData";

export const STORAGE_KEY = "streetViewAdminFactoryMaps";

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

function normalizeMaps(maps) {
  const next = clone(maps || factoryMaps);

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
    return {
      ...tour,
      version: tour.version || 1,
      settings: {
        firstScene: tour.settings.firstScene || Object.keys(tour.scenes)[0] || null,
        defaultHfov: tour.settings.defaultHfov || 110,
        mobileHfov: tour.settings.mobileHfov || 90,
        ...tour.settings,
      },
      scenes: tour.scenes || {},
      connections: Array.isArray(tour.connections) ? tour.connections : [],
    };
  }

  return {
    id: `${areaSlug}-tour`,
    name: `${area.name || "Area"} Tour`,
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

export function getSavedFactoryMaps() {
  const saved = safeParse(localStorage.getItem(STORAGE_KEY));
  return saved ? normalizeMaps(saved) : null;
}

export function saveFactoryMaps(nextMaps) {
  const normalized = normalizeMaps(nextMaps);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new Event("streetview-admin-storage-updated"));
  return normalized;
}

export function resetSavedFactoryMaps() {
  localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event("streetview-admin-storage-updated"));
}

export function getEffectiveFactoryMaps() {
  return getSavedFactoryMaps() || normalizeMaps(factoryMaps);
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
    area.id === areaId
      ? {
          ...area,
          tour: ensureTour(nextTour, area),
        }
      : area
  );

  return saveFactoryMaps(maps);
}

export function createId(text = "item") {
  return text
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || `item-${Date.now()}`;
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
