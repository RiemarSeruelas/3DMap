import { Navigate, useNavigate, useParams } from "react-router-dom";
import StreetViewer from "../components/StreetViewer";
import { getMergedArea, getMergedSite, getEffectiveTour } from "../utils/streetViewAdminStorage";

function StreetViewPage() {
  const navigate = useNavigate();
  const { siteId, areaId } = useParams();

  const site = getMergedSite(siteId);
  const area = getMergedArea(siteId, areaId);
  const tour = getEffectiveTour(siteId, areaId);

  if (!site) {
    return <Navigate to="/" replace />;
  }

  if (!area) {
    return <Navigate to={`/map/${siteId}`} replace />;
  }

  const hasScenes = tour?.scenes && Object.keys(tour.scenes).length > 0;

  if (!hasScenes) {
    return (
      <div className="viewer-error-page">
        <div className="viewer-error-card">
          <h1>No locations configured</h1>
          <p>This mapped area exists, but it does not have panorama locations yet.</p>
          <button onClick={() => navigate(`/map/${siteId}`)}>← Back to Map</button>
        </div>
      </div>
    );
  }

  return (
    <div className="viewer-page clean-viewer-page">
      <button className="floating-back-btn" onClick={() => navigate(`/map/${siteId}`)}>← Map</button>

      <div className="viewer-area-pill">
        <span>{site.name}</span>
        <strong>{area.name}</strong>
      </div>

      <main className="clean-viewer-body">
        <StreetViewer mapData={tour} />
      </main>
    </div>
  );
}

export default StreetViewPage;
