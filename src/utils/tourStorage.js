const STORAGE_KEY = "streetViewAdminTours";

export function makeAreaKey(siteId, areaId) {
  return `${siteId}:${areaId}`;
}

export function getAllSavedTours() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

export function saveAllTours(tours) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tours));
}

export function getSavedTour(siteId, areaId) {
  const savedTours = getAllSavedTours();
  return savedTours[makeAreaKey(siteId, areaId)] || null;
}

export function saveTour(siteId, areaId, tour) {
  const savedTours = getAllSavedTours();
  const nextTours = {
    ...savedTours,
    [makeAreaKey(siteId, areaId)]: tour,
  };

  saveAllTours(nextTours);
  return nextTours;
}

export function deleteSavedTour(siteId, areaId) {
  const savedTours = getAllSavedTours();
  delete savedTours[makeAreaKey(siteId, areaId)];
  saveAllTours(savedTours);
  return savedTours;
}

export function getTourForViewer(siteId, areaId, fallbackTour) {
  return getSavedTour(siteId, areaId) || fallbackTour;
}

export function slugify(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

export function toSceneId(value) {
  const slug = slugify(value);

  if (!slug) return `Scene${Date.now()}`;

  return slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

export function cloneTour(tour, site, area) {
  const safeFirstScene =
    tour?.settings?.firstScene || Object.keys(tour?.scenes || {})[0] || null;

  return {
    id: tour?.id || `${area?.id || "area"}-tour`,
    name: tour?.name || `${area?.name || "Area"} Tour`,
    version: tour?.version || 1,
    mapImage: tour?.mapImage || site?.mapImage || "",
    settings: {
      firstScene: safeFirstScene,
      defaultHfov: tour?.settings?.defaultHfov ?? 110,
      mobileHfov: tour?.settings?.mobileHfov ?? 90,
    },
    scenes: JSON.parse(JSON.stringify(tour?.scenes || {})),
    connections: JSON.parse(JSON.stringify(tour?.connections || [])),
  };
}

export function createBlankTour(site, area) {
  return {
    id: `${area?.id || "area"}-tour`,
    name: `${area?.name || "Area"} Tour`,
    version: 1,
    mapImage: site?.mapImage || "",
    settings: {
      firstScene: null,
      defaultHfov: 110,
      mobileHfov: 90,
    },
    scenes: {},
    connections: [],
  };
}

export function createScene({ title, label, panorama, mapPoint }) {
  const sceneId = toSceneId(title || label || `Scene ${Date.now()}`);

  return {
    id: sceneId,
    title: title || sceneId,
    label: label || title || sceneId,
    panorama: panorama || "/panos/sample.jpg",
    mapPoint: mapPoint || {
      x: 50,
      y: 50,
    },
    view: {
      initialYaw: 0,
      initialPitch: 0,
      initialHfov: 110,
    },
  };
}

export function makeConnectionId(from, to) {
  return `${slugify(from)}-to-${slugify(to)}-${Date.now()}`;
}

export function downloadTextFile(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function makeTourCode(tour, exportName = "generatedTour") {
  return `const ${exportName} = ${JSON.stringify(tour, null, 2)};`;
}
