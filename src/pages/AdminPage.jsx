import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getEffectiveFactoryMaps } from "../utils/streetViewAdminStorage";
import "../styles/admin.css";

function getSceneTitle(scene, sceneId = "Location") {
  return scene?.title || scene?.name || scene?.label || sceneId || "Location";
}

function getAlphabeticalFirstScene(area) {
  const scenes = Object.values(area?.tour?.scenes || {}).filter(Boolean);

  return scenes
    .sort((a, b) =>
      getSceneTitle(a, a.id).localeCompare(getSceneTitle(b, b.id), undefined, {
        numeric: true,
        sensitivity: "base",
      })
    )[0] || null;
}

function getAreaConfigUrl(siteId, area) {
  const firstScene = getAlphabeticalFirstScene(area);
  const sceneQuery = firstScene?.id ? `?scene=${encodeURIComponent(firstScene.id)}` : "";
  return `/admin/config/${siteId}/${area.id}${sceneQuery}`;
}

function getFirstArea(site) {
  return [...(site?.areas || [])].sort((a, b) =>
    String(a?.name || a?.id || "").localeCompare(String(b?.name || b?.id || ""), undefined, {
      numeric: true,
      sensitivity: "base",
    })
  )[0] || null;
}

function getSiteCode(site) {
  const name = String(site?.name || "Site").trim();
  const words = name.split(/\s+/).filter(Boolean);
  const initials = words.map((word) => word[0]).join("").slice(0, 2).toUpperCase();
  return initials || "360";
}

function AdminPage() {
  const navigate = useNavigate();
  const [maps, setMaps] = useState(() => getEffectiveFactoryMaps());

  const siteOptions = useMemo(() => Object.values(maps || {}), [maps]);

  useEffect(() => {
    function refresh() {
      setMaps(getEffectiveFactoryMaps());
    }

    window.addEventListener("streetview-admin-storage-updated", refresh);
    window.addEventListener("storage", refresh);

    return () => {
      window.removeEventListener("streetview-admin-storage-updated", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  function logout() {
    sessionStorage.removeItem("streetViewAuth");
    sessionStorage.removeItem("streetViewRole");
    navigate("/login", { replace: true });
  }

  function openSite(site) {
    const firstArea = getFirstArea(site);

    if (!firstArea?.id) {
      alert("This site has no area yet.");
      return;
    }

    navigate(getAreaConfigUrl(site.id, firstArea));
  }

  return (
    <div className="admin-viewer-select-page-v4 admin-select-area-match-viewer">
      <button type="button" className="admin-select-logout-v4" onClick={logout}>Logout</button>

      <main className="admin-select-content-v4">
        <div className="admin-select-title-row-v4">
          <div className="admin-select-logo-v4">360</div>
          <div>
            <p>Factory Street View</p>
            <h1>Select Area</h1>
            <span>Choose a factory block to open its admin location configuration.</span>
          </div>
        </div>

        <div className="admin-select-site-grid-v4">
          {siteOptions.map((site) => {
            const areaCount = site?.areas?.length || 0;
            return (
              <button key={site.id} className="admin-select-site-card-v4" onClick={() => openSite(site)}>
                <span className="admin-select-site-code-v4">{getSiteCode(site)}</span>
                <em>Admin</em>
                <strong>{site.name}</strong>
                <small>{areaCount} mapped area{areaCount === 1 ? "" : "s"}</small>
              </button>
            );
          })}
        </div>

        <div className="admin-select-footer-v4">
          <button type="button" onClick={() => navigate("/")}>Open Viewer</button>
        </div>
      </main>
    </div>
  );
}

export default AdminPage;
