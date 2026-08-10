import { useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import StreetViewer from "../components/StreetViewer";
import { getEffectiveFactoryMapsAsync } from "../utils/streetViewAdminStorage";

function StreetViewPage() {
  const navigate = useNavigate();
  const { siteId, areaId } = useParams();
  const [factoryMaps, setFactoryMaps] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    getEffectiveFactoryMapsAsync({ force: true }).then((maps) => {
      if (alive) { setFactoryMaps(maps); setLoading(false); }
    });
    return () => { alive = false; };
  }, []);

  if (loading) return <div className="viewer-error-page">Loading 360 viewer...</div>;
  const site = factoryMaps?.[siteId];
  const area = site?.areas?.find((item) => item.id === areaId);
  if (!site) return <Navigate to="/" replace />;
  if (!area) return <Navigate to={`/map/${siteId}`} replace />;
  if (!area.tour) return (
    <div className="viewer-error-page"><div className="viewer-error-card"><h1>No tour found</h1><p>This mapped area does not have configured 360 locations yet.</p><button onClick={() => navigate(`/map/${siteId}`)}>← Back to Map</button></div></div>
  );

  return (
    <div className="viewer-page clean-viewer-page">
      <button className="floating-back-btn map-only-back-btn" onClick={() => navigate(`/map/${siteId}`)}>← Map</button>
      <main className="clean-viewer-body"><StreetViewer mapData={area.tour} site={site} area={area} /></main>
    </div>
  );
}
export default StreetViewPage;
