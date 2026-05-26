import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { getMergedSite } from "../utils/streetViewAdminStorage";

function AreaMapPage() {
  const navigate = useNavigate();
  const { siteId } = useParams();

  const [site, setSite] = useState(() => getMergedSite(siteId));
  const [hoveredArea, setHoveredArea] = useState(null);
  const [selectedArea, setSelectedArea] = useState(null);

  useEffect(() => {
    function refresh() {
      setSite(getMergedSite(siteId));
    }

    window.addEventListener("streetview-admin-storage-updated", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("streetview-admin-storage-updated", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [siteId]);

  const selectedAreaName = useMemo(() => {
    if (selectedArea) return `Opening ${selectedArea.name}`;
    if (hoveredArea) return hoveredArea.name;
    return "Click a mapped area";
  }, [hoveredArea, selectedArea]);

  if (!site) {
    return <Navigate to="/" replace />;
  }

  function openArea(area) {
    setSelectedArea(area);
    setTimeout(() => navigate(`/viewer/${site.id}/${area.id}`), 500);
  }

  return (
    <div className={`area-page simple-map-page ${selectedArea ? "area-switching" : ""}`}>
      <main className="simple-map-body">
        <section className="area-map-card simple-map-card">
          <div className="viewer-map-canvas">
            <img src={site.mapImage} alt={site.name} className="area-map-image" />

            <svg className="area-map-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
              {site.areas.map((area) => (
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
          </div>

          <div className="map-floating-info">
            <button type="button" className="map-back-btn" onClick={() => navigate("/")}>← Back</button>
            <div>
              <div className="map-floating-kicker">SELECT AREA</div>
              <div className="map-floating-title">{site.name}</div>
              <div className="map-floating-subtitle">{selectedAreaName}</div>
            </div>
          </div>

          {selectedArea && (
            <div className="area-open-transition">
              <div className="area-open-ring" />
              <div className="area-open-pulse" />
              <div className="area-open-label">
                <span>ENTERING AREA</span>
                <strong>{selectedArea.name}</strong>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

export default AreaMapPage;
