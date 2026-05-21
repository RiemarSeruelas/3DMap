import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getEffectiveFactoryMaps } from "../utils/streetViewAdminStorage";

function KioskPage() {
  const navigate = useNavigate();
  const [selectedSite, setSelectedSite] = useState(null);
  const userRole = sessionStorage.getItem("streetViewRole");

  const siteOptions = useMemo(() => {
    const effectiveFactoryMaps = getEffectiveFactoryMaps();

    return Object.values(effectiveFactoryMaps).map((site) => ({
      id: site.id,
      name: site.name,
      subtitle: site.subtitle || `${site.areas?.length || 0} mapped areas`,
      image: site.image || site.mapImage,
    }));
  }, []);

  function openSite(site) {
    setSelectedSite(site);

    setTimeout(() => {
      navigate(`/map/${site.id}`);
    }, 700);
  }

  function logout() {
    sessionStorage.removeItem("streetViewAuth");
    sessionStorage.removeItem("streetViewRole");
    navigate("/login", { replace: true });
  }

  return (
    <div className={`kiosk-page clean-kiosk-page ${selectedSite ? "site-switching" : ""}`}>
      <button className="floating-logout-btn" onClick={logout}>
        Logout
      </button>

      {userRole === "admin" && (
        <button className="floating-admin-btn" onClick={() => navigate("/admin")}>
          Admin
        </button>
      )}

      <main className="clean-kiosk-body">
        <section className="clean-kiosk-hero">
          <div className="clean-kiosk-badge">360</div>

          <div>
            <p className="clean-kiosk-kicker">FACTORY STREET VIEW</p>
            <h1>Select Area</h1>
            <p className="clean-kiosk-subtitle">
              Choose a factory block to open its interactive map.
            </p>
          </div>
        </section>

        <section className="kiosk-selection-panel">
          <div className="kiosk-grid">
            {siteOptions.map((site) => (
              <button
                key={site.id}
                className={`kiosk-card ${selectedSite?.id === site.id ? "is-selected" : ""}`}
                onClick={() => openSite(site)}
              >
                <div className="kiosk-card-glow"></div>

                <div className="kiosk-card-top">
                  <div className="kiosk-card-icon">
                    {site.name
                      .split(" ")
                      .map((word) => word[0])
                      .join("")
                      .slice(0, 2)}
                  </div>

                  <span className="kiosk-arrow">→</span>
                </div>

                <div className="kiosk-card-bottom">
                  <h2>{site.name}</h2>
                  <p>{site.subtitle}</p>
                </div>
              </button>
            ))}
          </div>
        </section>
      </main>

      {selectedSite && (
        <div className="site-open-transition">
          <div className="site-open-ring"></div>
          <div className="site-open-pulse"></div>

          <div className="site-open-label">
            <span>OPENING MAP</span>
            <strong>{selectedSite.name}</strong>
          </div>
        </div>
      )}
    </div>
  );
}

export default KioskPage;
