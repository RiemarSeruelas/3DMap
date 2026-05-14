import { useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { factoryMaps } from "../data/mapData";

function AreaMapPage() {
  const navigate = useNavigate();
  const { siteId } = useParams();

  const site = factoryMaps[siteId];
  const [hoveredArea, setHoveredArea] = useState(null);

  const selectedAreaName = useMemo(() => {
    if (!hoveredArea) return "Click a highlighted mapped area";
    return hoveredArea.name;
  }, [hoveredArea]);

  if (!site) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="area-page">
      <header className="area-floating-header">
        <button className="back-btn" onClick={() => navigate("/")}>
          ← Back
        </button>

        <div className="area-header-info">
          <div className="area-kicker">SELECT AREA</div>
          <h1>{site.name}</h1>
          <p>{selectedAreaName}</p>
        </div>

        <div className="area-header-tip">
          Edit polygon <code>points</code> in <code>mapData.js</code>
        </div>
      </header>

      <main className="area-center-stage">
        <section className="area-map-card">
          <img src={site.mapImage} alt={site.name} className="area-map-image" />

          <svg
            className="area-map-svg"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            {site.areas.map((area) => (
              <polygon
                key={area.id}
                points={area.points}
                className="clickable-area"
                onMouseEnter={() => setHoveredArea(area)}
                onMouseLeave={() => setHoveredArea(null)}
                onClick={() => navigate(`/viewer/${site.id}/${area.id}`)}
              />
            ))}
          </svg>
        </section>
      </main>
    </div>
  );
}

export default AreaMapPage;