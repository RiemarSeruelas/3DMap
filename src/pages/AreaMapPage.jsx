import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { getEffectiveFactoryMapsAsync } from "../utils/streetViewAdminStorage";
import "../styles/admin.css";

function getSceneTitle(scene, fallback = "Untitled Location") {
  return scene?.title || scene?.name || scene?.label || fallback;
}

function getSceneMapPoint(scene) {
  return scene?.mapPoint || scene?.minimap || null;
}

function getAlphabeticalFirstScene(area) {
  const scenes = Object.values(area?.tour?.scenes || {}).filter(Boolean);
  return scenes.sort((a, b) => getSceneTitle(a, a.id).localeCompare(getSceneTitle(b, b.id), undefined, {
    numeric: true,
    sensitivity: "base",
  }))[0] || null;
}

function getClosestScene(area, clickedPoint) {
  const scenes = Object.values(area?.tour?.scenes || {}).filter(Boolean);
  if (!clickedPoint || !scenes.length) return getAlphabeticalFirstScene(area);

  const closestMapped = scenes
    .map((scene) => ({ scene, point: getSceneMapPoint(scene) }))
    .filter((item) => item.point)
    .map((item) => {
      const dx = Number(item.point.x || 50) - clickedPoint.x;
      const dy = Number(item.point.y || 50) - clickedPoint.y;
      return { ...item, distance: Math.sqrt(dx * dx + dy * dy) };
    })
    .sort((a, b) => a.distance - b.distance)[0]?.scene;

  return closestMapped || getAlphabeticalFirstScene(area);
}

function parseAreaPoints(points = "") {
  return String(points)
    .trim()
    .split(/\s+/)
    .map((pair) => {
      const [x, y] = pair.split(",").map(Number);
      return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
    })
    .filter(Boolean);
}

function getAreaCenter(area) {
  const points = parseAreaPoints(area?.points);
  if (!points.length) return { x: 50, y: 50 };
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

function getClosestArea(areas = [], clickedPoint) {
  if (!clickedPoint) return null;

  return areas
    .filter((area) => area?.points)
    .map((area) => {
      const center = getAreaCenter(area);
      const dx = center.x - clickedPoint.x;
      const dy = center.y - clickedPoint.y;
      return { area, distance: Math.sqrt(dx * dx + dy * dy) };
    })
    .sort((a, b) => a.distance - b.distance)[0]?.area || null;
}

function getClickPercent(event) {
  const rect = event.currentTarget.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * 100;
  const y = ((event.clientY - rect.top) / rect.height) * 100;
  return {
    x: Math.max(0, Math.min(100, x)),
    y: Math.max(0, Math.min(100, y)),
  };
}

function AreaMapPage() {
  const navigate = useNavigate();
  const { siteId } = useParams();

  const [factoryMaps, setFactoryMaps] = useState(null);
  const [hoveredArea, setHoveredArea] = useState(null);
  const [selectedArea, setSelectedArea] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function loadMaps() {
      const maps = await getEffectiveFactoryMapsAsync({ force: true });
      if (!cancelled) {
        setFactoryMaps(maps);
        setLoading(false);
      }
    }
    loadMaps();
    return () => { cancelled = true; };
  }, []);

  const site = factoryMaps?.[siteId];

  const selectedAreaName = useMemo(() => {
    if (selectedArea) return `Opening ${selectedArea.name}`;
    if (hoveredArea) return hoveredArea.name;
    return "Click anywhere on the map";
  }, [hoveredArea, selectedArea]);

  if (loading) return <div className="viewer-error-page">Loading map...</div>;
  if (!site) return <Navigate to="/" replace />;

  function openArea(area, clickedPoint = null) {
    if (!area) return;
    setSelectedArea(area);
    const targetScene = getClosestScene(area, clickedPoint);
    const sceneQuery = targetScene?.id ? `?scene=${encodeURIComponent(targetScene.id)}` : "";

    setTimeout(() => {
      navigate(`/viewer/${site.id}/${area.id}${sceneQuery}`);
    }, 250);
  }

  function handleMapClick(event) {
    const clickedPoint = getClickPercent(event);
    const closestArea = getClosestArea(site.areas || [], clickedPoint);
    if (closestArea) openArea(closestArea, clickedPoint);
  }

  return (
    <div className={`area-page simple-map-page ${selectedArea ? "area-switching" : ""}`}>
      <main className="simple-map-body">
        <section className="area-map-card simple-map-card" onClick={handleMapClick} title="Click anywhere to open the nearest mapped area">
          {site.mapImage ? (
            <img src={site.mapImage} alt={site.name} className="area-map-image" draggable="false" />
          ) : (
            <div className="area-map-image area-map-missing">No map image</div>
          )}

          <svg className="area-map-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
            {(site.areas || []).map((area) => (
              <polygon
                key={area.id}
                points={area.points}
                className={`clickable-area ${hoveredArea?.id === area.id ? "is-hovered" : ""} ${selectedArea?.id === area.id ? "is-selected" : ""}`}
                onMouseEnter={() => setHoveredArea(area)}
                onMouseLeave={() => setHoveredArea(null)}
                onClick={(event) => {
                  event.stopPropagation();
                  openArea(area, getClickPercent(event));
                }}
              />
            ))}
          </svg>

          <div className="map-floating-info">
            <button type="button" className="map-back-btn" onClick={(event) => { event.stopPropagation(); navigate("/"); }}>← Back</button>
            <div>
              <div className="map-floating-kicker">SELECT AREA</div>
              <div className="map-floating-title">{site.name}</div>
              <div className="map-floating-subtitle">{selectedAreaName}</div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

export default AreaMapPage;
