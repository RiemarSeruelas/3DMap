import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import {
  ensureTour,
  getEffectiveFactoryMapsAsync,
  getEffectiveFactoryMaps,
} from "../utils/streetViewAdminStorage";
import "../styles/admin-map-dot-patch.css";

function normalizeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function getSceneTitle(scene, sceneId = "Location") {
  return scene?.title || scene?.name || scene?.label || sceneId || "Location";
}

function getSceneMapPoint(scene) {
  return scene?.mapPoint || scene?.minimap || null;
}

function getFirstSceneId(area) {
  const tour = ensureTour(area?.tour, area);
  return tour?.settings?.firstScene || Object.keys(tour?.scenes || {})[0] || null;
}

function getMarkedLocationDots(site) {
  return (site?.areas || []).flatMap((area) => {
    const tour = ensureTour(area?.tour, area);

    return Object.values(tour?.scenes || {})
      .filter((scene) => getSceneMapPoint(scene))
      .map((scene) => {
        const point = getSceneMapPoint(scene);

        return {
          areaId: area.id,
          areaName: area.name,
          sceneId: scene.id,
          sceneName: getSceneTitle(scene, scene.id),
          x: normalizeNumber(point.x, 50),
          y: normalizeNumber(point.y, 50),
        };
      });
  });
}

function AreaMapPage() {
  const navigate = useNavigate();
  const { siteId } = useParams();

  const [factoryMaps, setFactoryMaps] = useState(null);
  const [hoveredArea, setHoveredArea] = useState(null);
  const [selectedArea, setSelectedArea] = useState(null);
  const [hoveredDot, setHoveredDot] = useState(null);
  const [loading, setLoading] = useState(true);

  async function loadMaps({ force = false } = {}) {
    const maps = await getEffectiveFactoryMapsAsync({ force });
    setFactoryMaps(maps);
    setLoading(false);
  }

  useEffect(() => {
    let cancelled = false;

    async function initialLoad() {
      const maps = await getEffectiveFactoryMapsAsync({ force: true });
      if (!cancelled) {
        setFactoryMaps(maps);
        setLoading(false);
      }
    }

    initialLoad();

    function refresh() {
      setFactoryMaps(getEffectiveFactoryMaps());
    }

    window.addEventListener("streetview-admin-storage-updated", refresh);
    window.addEventListener("storage", refresh);

    return () => {
      cancelled = true;
      window.removeEventListener("streetview-admin-storage-updated", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const site = factoryMaps?.[siteId];
  const markedDots = useMemo(() => getMarkedLocationDots(site), [site]);

  const selectedAreaName = useMemo(() => {
    if (selectedArea) return `Opening ${selectedArea.name}`;
    if (hoveredDot) return hoveredDot.sceneName;
    if (hoveredArea) return hoveredArea.name;
    return "Click a mapped area or a location dot";
  }, [hoveredArea, selectedArea, hoveredDot]);

  if (loading) {
    return <div className="viewer-error-page">Loading map...</div>;
  }

  if (!site) {
    return <Navigate to="/" replace />;
  }

  function openArea(area) {
    const firstSceneId = getFirstSceneId(area);
    setSelectedArea(area);

    setTimeout(() => {
      const query = firstSceneId ? `?scene=${encodeURIComponent(firstSceneId)}` : "";
      navigate(`/viewer/${site.id}/${area.id}${query}`);
    }, 250);
  }

  function openDot(dot) {
    const area = site.areas?.find((item) => item.id === dot.areaId);
    setSelectedArea(area || { id: dot.areaId, name: dot.areaName });

    setTimeout(() => {
      navigate(`/viewer/${site.id}/${dot.areaId}?scene=${encodeURIComponent(dot.sceneId)}`);
    }, 150);
  }

  return (
    <div className={`area-page simple-map-page ${selectedArea ? "area-switching" : ""}`}>
      <main className="simple-map-body">
        <section className="area-map-card simple-map-card">
          {site.mapImage ? (
            <img src={site.mapImage} alt={site.name} className="area-map-image" />
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
                onClick={() => openArea(area)}
              />
            ))}
          </svg>

          <div className="site-location-dot-layer">
            {markedDots.map((dot) => (
              <button
                key={`${dot.areaId}-${dot.sceneId}`}
                type="button"
                className="site-location-dot"
                style={{
                  left: `${dot.x}%`,
                  top: `${dot.y}%`,
                }}
                onMouseEnter={() => setHoveredDot(dot)}
                onMouseLeave={() => setHoveredDot(null)}
                onClick={(event) => {
                  event.stopPropagation();
                  openDot(dot);
                }}
                title={`${dot.sceneName} (${dot.areaName})`}
              />
            ))}
          </div>

          <div className="map-floating-info">
            <button type="button" className="map-back-btn" onClick={() => navigate("/")}>← Back</button>

            <div>
              <div className="map-floating-kicker">SELECT AREA</div>
              <div className="map-floating-title">{site.name}</div>
              <div className="map-floating-subtitle">{selectedAreaName}</div>
            </div>

            <div className="map-floating-dot-count">
              <strong>{markedDots.length}</strong>
              <span>location dot(s)</span>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

export default AreaMapPage;
