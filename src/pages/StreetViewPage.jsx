import { Navigate, useNavigate, useParams } from "react-router-dom";
import { factoryMaps } from "../data/mapData";
import StreetViewer from "../components/StreetViewer";

function StreetViewPage() {
  const navigate = useNavigate();
  const { siteId, areaId } = useParams();

  const site = factoryMaps[siteId];
  const area = site?.areas.find((item) => item.id === areaId);

  if (!site) {
    return <Navigate to="/" replace />;
  }

  if (!area) {
    return <Navigate to={`/map/${siteId}`} replace />;
  }

  if (!area.tour) {
    return (
      <div className="viewer-error-page">
        <div className="viewer-error-card">
          <h1>No tour found</h1>
          <p>
            The selected area exists, but it does not have a <code>tour</code>{" "}
            assigned in <code>mapData.js</code>.
          </p>

          <button onClick={() => navigate(`/map/${siteId}`)}>
            ← Back to Map
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="viewer-page">
      <div className="viewer-page-inner">
        <header className="viewer-page-header">
          <button
            className="back-btn"
            onClick={() => navigate(`/map/${siteId}`)}
          >
            ← Back to Map
          </button>

          <div>
            <div className="viewer-kicker">{site.name}</div>
            <h1>{area.name}</h1>
          </div>
        </header>

        <StreetViewer mapData={area.tour} />
      </div>
    </div>
  );
}

export default StreetViewPage;