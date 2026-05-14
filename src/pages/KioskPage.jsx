import { useNavigate } from "react-router-dom";
import { siteOptions } from "../data/mapData";

function KioskPage() {
  const navigate = useNavigate();

  function logout() {
    sessionStorage.removeItem("streetViewAuth");
    navigate("/login", { replace: true });
  }

  return (
    <div className="kiosk-page">
      <header className="kiosk-header">
        <div>
          <div className="kiosk-kicker">COMPANY 360 STREET VIEW</div>
          <h1>Select Area</h1>
          <p>Choose which block you want to explore.</p>
        </div>

        <button className="logout-btn" onClick={logout}>
          Logout
        </button>
      </header>

      <main className="kiosk-grid">
        {siteOptions.map((site) => (
          <button
            key={site.id}
            className="kiosk-card"
            onClick={() => navigate(`/map/${site.id}`)}
          >
            <div className="kiosk-card-glow"></div>

            <div className="kiosk-card-icon">
              {site.name
                .split(" ")
                .map((word) => word[0])
                .join("")
                .slice(0, 2)}
            </div>

            <div>
              <h2>{site.name}</h2>
              <p>{site.subtitle}</p>
            </div>

            <span className="kiosk-arrow">→</span>
          </button>
        ))}
      </main>
    </div>
  );
}

export default KioskPage;