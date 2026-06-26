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
  createUniqueId,
} from "../utils/streetViewAdminStorage";
import "../styles/admin.css";

const CARD_PAGE_SIZE = 40;
const MAP_ZOOM_MIN = 1;
const MAP_ZOOM_MAX = 4;
const MAP_ZOOM_STEP = 0.35;

function getSaveAssetBase() {
  if (typeof window === "undefined") return "http://localhost:3010";

  const override = window.__STREETVIEW_SAVE_API_BASE__;
  if (typeof override === "string" && override.trim()) {
    return override.trim().replace(/\/$/, "");
  }

  // Same-origin mode: /uploads and /data load through the Vite proxy on port 5055.
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

  // Files uploaded by the admin save server load from the same app port.
  // Vite proxies these paths internally to the save server.
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

function PannellumStage({ image, scene, scenesById, isPicking, pickLabel, onPickPoint, onGoToScene }) {
  const mountRef = useRef(null);
  const viewerRef = useRef(null);
  const viewMemoryRef = useRef(null);
  const onGoToSceneRef = useRef(onGoToScene);
  const onPickPointRef = useRef(onPickPoint);
  const selectedSceneId = scene?.id || "";

  const hotspotSignature = useMemo(() => {
    return (scene?.hotspots || [])
      .filter((hotspot) => hotspot?.targetSceneId)
      .map((hotspot) => `${hotspot.id}:${hotspot.targetSceneId}:${hotspot.pitch}:${hotspot.yaw}:${hotspot.x}:${hotspot.y}`)
      .join("|");
  }, [scene?.hotspots]);

  useEffect(() => {
    onGoToSceneRef.current = onGoToScene;
  }, [onGoToScene]);

  useEffect(() => {
    onPickPointRef.current = onPickPoint;
  }, [onPickPoint]);

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

      // Pannellum sometimes applies default/initial view after image load.
      // Force the remembered admin yaw/pitch/hfov more than once.
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

    const hotSpots = (scene?.hotspots || [])
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
            button.innerHTML = "➜";
            button.title = args.title;
            button.addEventListener("click", (event) => {
              event.preventDefault();
              event.stopPropagation();

              // Save the current admin view BEFORE switching panoramas.
              goToSceneWithRememberedView(args.targetSceneId);
            });
            hotSpotDiv.appendChild(button);
          },
          createTooltipArgs: {
            title: targetScene ? `Go to ${getSceneTitle(targetScene)}` : "Go to location",
            targetSceneId: hotspot.targetSceneId,
          },
        };
      });

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
      hotSpots,
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
    const mount = mountRef.current;
    if (!mount) return;

    function handleClick(event) {
      if (!isPicking) return;
      if (event.target.closest(".admin-config-pnlm-hotspot-button-v2")) return;

      if (viewerRef.current?.mouseEventToCoords) {
        const coords = viewerRef.current.mouseEventToCoords(event);
        if (Array.isArray(coords) && coords.length >= 2) {
          onPickPointRef.current?.({
            pitch: Number(coords[0].toFixed(2)),
            yaw: Number(coords[1].toFixed(2)),
          });
        }
      }
    }

    mount.addEventListener("click", handleClick);
    return () => mount.removeEventListener("click", handleClick);
  }, [isPicking]);

  function handleFallbackClick(event) {
    if (!isPicking) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    onPickPointRef.current?.(legacyPercentToPano({ x, y }));
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

      <div className="admin-config-pannellum-controls-v2" onClick={(event) => event.stopPropagation()}>
        <button type="button" onClick={() => zoomBy(-10)} title="Zoom in">+</button>
        <button type="button" onClick={() => zoomBy(10)} title="Zoom out">−</button>
        <button type="button" onClick={toggleFullscreen} title="Fullscreen">⛶</button>
      </div>

      {isPicking && (
        <div className="admin-config-picking-banner-v2">
          {pickLabel || "Click inside the panorama to place the button"}
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
          view: { initialYaw: 0, initialPitch: 0, initialHfov: 110 },
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
    setIsLinkModalOpen(true);
  }

  function chooseTargetScene(targetSceneId) {
    setPendingTargetSceneId(targetSceneId);
    setIsLinkModalOpen(false);
    setMode("mark-location");
  }

  const handlePanoPick = useCallback((point) => {
    if (!selectedScene?.id) return;
    if (mode === "mark-location" && pendingTargetSceneId) {
      const targetScene = tour?.scenes?.[pendingTargetSceneId];
      const currentHotspots = selectedScene.hotspots || [];
      const existingHotspot = currentHotspots.find((hotspot) => hotspot?.targetSceneId === pendingTargetSceneId);
      const legacyPoint = toLegacyPercentPoint(point.pitch, point.yaw);
      const nextHotspot = {
        ...(existingHotspot || {}),
        id: existingHotspot?.id || createUniqueId(`to-${pendingTargetSceneId}`, currentHotspots.map((hotspot) => hotspot.id)),
        type: "scene",
        targetSceneId: pendingTargetSceneId,
        text: targetScene ? getSceneTitle(targetScene) : "Go to location",
        coordinateMode: "pannellum",
        pitch: point.pitch,
        yaw: point.yaw,
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

  function openMapModal() {
    if (!siteMapImage) return alert("No site map image found for this site yet.");
    setMode("preview");
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
    // Right click drag, middle mouse drag, or Space + left drag can move the zoomed map.
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

  function handleMapPlacementClick(event) {
    if (!selectedScene?.id) return;
    if (event.button !== 0) return;
    if (mapPanGestureRef.current.moved) return;

    const viewport = mapViewportRef.current;
    if (!viewport) return;

    const rect = viewport.getBoundingClientRect();
    const mapX = (event.clientX - rect.left - mapPan.x) / mapZoom;
    const mapY = (event.clientY - rect.top - mapPan.y) / mapZoom;

    const point = {
      x: Number(Math.min(100, Math.max(0, (mapX / rect.width) * 100)).toFixed(2)),
      y: Number(Math.min(100, Math.max(0, (mapY / rect.height) * 100)).toFixed(2)),
    };

    const nextScene = { ...selectedScene, mapPoint: point, minimap: point };
    saveTour({ ...tour, scenes: { ...tour.scenes, [selectedScene.id]: nextScene } }, `Map dot saved at ${point.x}, ${point.y}`);
    setIsMapModalOpen(false);
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
              return (
                <button key={scene.id} type="button" className={`admin-config-location-row-v2 ${isActive ? "active" : ""}`} onClick={() => { setSelectedSceneId(scene.id); setMode("preview"); setPendingTargetSceneId(null); }}>
                  <span className="admin-config-location-index-v2">{String(index + 1).padStart(2, "0")}</span>
                  <strong>{getSceneTitle(scene)}</strong>
                  <span className="admin-config-location-badges-v2">
                    {isMapped && <em>MAP</em>}
                    {linkCount > 0 && <em>{linkCount} LINK{linkCount > 1 ? "S" : ""}</em>}
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
              {mode !== "preview" && <div className="admin-config-mode-pill-v2 active">{mode === "mark-location" && pendingTargetScene && `Click panorama to place button to ${getSceneTitle(pendingTargetScene)}`}</div>}
            </div>
          </div>

          <div className="admin-config-main-preview-v2">
            <PannellumStage
              image={selectedImage}
              scene={selectedScene}
              scenesById={scenesById}
              isPicking={mode === "mark-location"}
              pickLabel={mode === "mark-location" && pendingTargetScene ? `Click where the button to ${getSceneTitle(pendingTargetScene)} should appear` : "Click inside the panorama"}
              onPickPoint={handlePanoPick}
              onGoToScene={goToScene}
            />
          </div>

          <div className="admin-config-preview-actions-bar-v2">
            <button type="button" onClick={openMapModal} disabled={!selectedScene}>Mark in Map</button>
            <button type="button" onClick={openMarkLocationPicker} disabled={!selectedScene} className={mode === "mark-location" ? "active" : ""}>Mark Locations</button>
            <button type="button" onClick={openEditName} disabled={!selectedScene}>Edit</button>
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

      {isEditOpen && (
        <div className="admin-config-modal-backdrop-v2" onMouseDown={() => setIsEditOpen(false)}>
          <form className="admin-config-add-modal-v2 admin-config-edit-modal-v2" onMouseDown={(event) => event.stopPropagation()} onSubmit={saveEditedName}>
            <div className="admin-config-modal-header-v2"><div><span>Edit Location</span><strong>Rename / remove links</strong></div><button type="button" onClick={() => setIsEditOpen(false)}>×</button></div>
            <label className="admin-config-form-field-v2"><span>Location Name</span><input value={editLocationName} onChange={(event) => setEditLocationName(event.target.value)} placeholder="Example: Engineering Room" autoFocus /></label>

            <div className="admin-config-edit-map-v2">
              <div>
                <span>Map Mark</span>
                <strong>{getSceneMapPoint(selectedScene) ? `Saved at ${getSceneMapPoint(selectedScene).x}, ${getSceneMapPoint(selectedScene).y}` : "No map mark saved"}</strong>
              </div>
              {getSceneMapPoint(selectedScene) && (
                <button type="button" onClick={removeMapPoint}>Remove Map Mark</button>
              )}
            </div>

            <div className="admin-config-edit-links-v2">
              <div className="admin-config-edit-links-title-v2">
                <span>Marked Location Buttons</span>
                {selectedHotspots.length > 0 && <button type="button" onClick={removeAllHotspots}>Remove All</button>}
              </div>

              {selectedHotspots.length === 0 ? (
                <p>No marked location buttons on this image.</p>
              ) : (
                selectedHotspots.map((hotspot) => {
                  const target = tour?.scenes?.[hotspot.targetSceneId];
                  return (
                    <div key={hotspot.id} className="admin-config-edit-link-row-v2">
                      <strong>{getSceneTitle(target, hotspot.targetSceneId)}</strong>
                      <button type="button" onClick={() => removeHotspot(hotspot.id)}>Remove</button>
                    </div>
                  );
                })
              )}
            </div>

            <div className="admin-config-modal-actions-v2"><button type="button" onClick={() => setIsEditOpen(false)}>Cancel</button><button type="submit" className="primary">Save Name</button></div>
          </form>
        </div>
      )}

      {isMapModalOpen && (
        <div className="admin-config-modal-backdrop-v2" onMouseDown={() => setIsMapModalOpen(false)}>
          <section className="admin-config-map-modal-v2" onMouseDown={(event) => event.stopPropagation()}>
            <div className="admin-config-modal-header-v2">
              <div><span>Mark in Map</span><strong>{getSceneTitle(selectedScene)}</strong></div>
              <button type="button" onClick={() => setIsMapModalOpen(false)}>×</button>
            </div>

            <div className="admin-config-map-toolbar-v2">
              <p className="admin-config-map-help-v2">Scroll to zoom. Hold right click and drag to move, then left click the exact location.</p>
              <div className="admin-config-map-zoom-controls-v2">
                <button type="button" onClick={() => updateMapZoom(-MAP_ZOOM_STEP)} disabled={mapZoom <= MAP_ZOOM_MIN}>−</button>
                <span>{Math.round(mapZoom * 100)}%</span>
                <button type="button" onClick={() => updateMapZoom(MAP_ZOOM_STEP)} disabled={mapZoom >= MAP_ZOOM_MAX}>+</button>
                <button type="button" onClick={resetMapZoom}>Reset</button>
                {getSceneMapPoint(selectedScene) && (
                  <button type="button" className="danger" onClick={(event) => { event.stopPropagation(); removeMapPoint(); }}>Remove Mark</button>
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
                  return <span key={scene.id} className={`admin-config-site-dot-v2 ${scene.id === selectedScene?.id ? "is-selected" : ""}`} style={{ left: `${point.x}%`, top: `${point.y}%` }} title={getSceneTitle(scene)} />;
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
