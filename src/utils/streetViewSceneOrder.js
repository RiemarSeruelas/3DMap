export function getSceneTitle(scene, fallback = "Untitled Location") {
  return scene?.title || scene?.name || scene?.label || scene?.id || fallback;
}

export function getAlphabeticalScenes(tourOrMapData) {
  const scenes = Object.values(tourOrMapData?.scenes || {}).filter(Boolean);

  return [...scenes].sort((a, b) =>
    getSceneTitle(a, a?.id).localeCompare(getSceneTitle(b, b?.id), undefined, {
      numeric: true,
      sensitivity: "base",
    })
  );
}

export function getAlphabeticalFirstSceneId(tourOrMapData) {
  return getAlphabeticalScenes(tourOrMapData)[0]?.id || null;
}

export function getAlphabeticalFirstScene(area) {
  return getAlphabeticalScenes(area?.tour)[0] || null;
}
