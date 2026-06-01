import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { getEffectiveFactoryMapsAsync } from "../utils/streetViewAdminStorage";

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
      const maps = await getEffectiveFactoryMapsAsync();
      if (!cancelled) {
        setFactoryMaps(maps);
        setLoading(false);
      }
    }

    loadMaps();

    return () => {
      cancelled = true;
    };
  }, []);

  const site = factoryMaps?.[siteId];

  const selectedAreaName = useMemo(() => {
    if (selectedArea) return `Opening ${selectedArea.name}`;
    if (hoveredArea) return hoveredArea.name;
    return "Click a mapped area";
  }, [hoveredArea, selectedArea]);

  if (loading) {
    return <div className="viewer-error-page">Loading map...</div>;
  }

  if (!site) {
    return <Navigate to="/" replace />;
  }

  function openArea(area) {
    setSelectedArea(area);
    setTimeout(() => {
      navigate(`/viewer/${site.id}/${area.id}`);
    }, 250);
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

          <div className="map-floating-info">
            <button type="button" className="map-back-btn" onClick={() => navigate("/")}>← Back</button>

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
