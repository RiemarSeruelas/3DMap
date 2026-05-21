import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { factoryMaps } from "../data/mapData";
import {
  clone,
  createEmptyTour,
  getEffectiveFactoryMaps,
  makeSlug,
  saveFactoryMaps,
} from "../utils/streetViewAdminStorage";

function getPointFromMapClick(event) {
  const rect = event.currentTarget.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * 100;
  const y = ((event.clientY - rect.top) / rect.height) * 100;

  return `${Math.max(0, Math.min(100, x)).toFixed(2)},${Math.max(0, Math.min(100, y)).toFixed(2)}`;
}

function AdminPage() {
  const navigate = useNavigate();
  const [maps, setMaps] = useState(() => getEffectiveFactoryMaps());
  const [selectedSiteId, setSelectedSiteId] = useState(() => Object.keys(factoryMaps)[0] || "");
  const [selectedAreaId, setSelectedAreaId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [isMapping, setIsMapping] = useState(false);

  const site = maps[selectedSiteId];
  const selectedArea = site?.areas?.find((area) => area.id === selectedAreaId) || null;
  const draftPoints = draft?.points || [];

  useEffect(() => {
    function reloadMaps() {
      setMaps(getEffectiveFactoryMaps());
    }

    reloadMaps();
    window.addEventListener("focus", reloadMaps);
    window.addEventListener("streetViewAdminDataChanged", reloadMaps);

    return () => {
      window.removeEventListener("focus", reloadMaps);
      window.removeEventListener("streetViewAdminDataChanged", reloadMaps);
    };
  }, []);

  function persist(nextMaps) {
    setMaps(nextMaps);
    saveFactoryMaps(nextMaps);
  }

  function logout() {
    sessionStorage.removeItem("streetViewAuth");
    sessionStorage.removeItem("streetViewRole");
    navigate("/login", { replace: true });
  }

  function startNewArea() {
    setSelectedAreaId(null);
    setDraft({ id: null, name: "", points: [] });
    setIsMapping(false);
  }

  function editArea(area) {
    setSelectedAreaId(area.id);
    setDraft({
      id: area.id,
      name: area.name || "",
      points: String(area.points || "").trim().split(" ").filter(Boolean),
    });
    setIsMapping(false);
  }

  function cancelEdit() {
    setDraft(null);
    setIsMapping(false);
  }

  function deleteArea(areaId) {
    const confirmed = window.confirm("Delete this mapped area and its configuration?");
    if (!confirmed) return;

    const nextMaps = clone(maps);
    nextMaps[selectedSiteId].areas = nextMaps[selectedSiteId].areas.filter((area) => area.id !== areaId);
    persist(nextMaps);

    if (selectedAreaId === areaId) {
      setSelectedAreaId(null);
      setDraft(null);
      setIsMapping(false);
    }
  }

  function undoPoint() {
    setDraft((prev) => {
      if (!prev) return prev;
      return { ...prev, points: prev.points.slice(0, -1) };
    });
  }

  function handleMapClick(event) {
    if (!isMapping || !draft) return;
    const point = getPointFromMapClick(event);
    setDraft((prev) => ({ ...prev, points: [...prev.points, point] }));
  }

  function saveArea() {
    if (!draft?.name?.trim()) {
      alert("Add an area name first.");
      return;
    }

    if ((draft.points || []).length < 3) {
      alert("Map at least 3 points for the area.");
      return;
    }

    const nextMaps = clone(maps);
    const nextSite = nextMaps[selectedSiteId];
    const points = draft.points.join(" ");
    let areaId = draft.id;

    if (!areaId) {
      const baseId = `${selectedSiteId}-${makeSlug(draft.name, "area")}`;
      let finalId = baseId;
      let count = 2;

      while (nextSite.areas.some((area) => area.id === finalId)) {
        finalId = `${baseId}-${count}`;
        count += 1;
      }

      areaId = finalId;
      nextSite.areas.push({
        id: areaId,
        name: draft.name.trim(),
        points,
        tour: createEmptyTour({ areaId, areaName: draft.name.trim() }),
      });
    } else {
      nextSite.areas = nextSite.areas.map((area) =>
        area.id === areaId
          ? {
              ...area,
              name: draft.name.trim(),
              points,
              tour: area.tour || createEmptyTour({ areaId, areaName: draft.name.trim() }),
            }
          : area
      );
    }

    persist(nextMaps);
    setSelectedAreaId(areaId);
    setDraft(null);
    setIsMapping(false);
  }

  function openConfiguration(area) {
    if (isMapping || draft) return;
    navigate(`/admin/config/${selectedSiteId}/${area.id}`);
  }

  return (
    <div className="admin-split-page">
      <header className="admin-topbar">
        <div>
          <p className="admin-eyebrow">360 Street View Admin</p>
          <h1>Area Mapping</h1>
          <p>Draw parent areas. Click a saved area card to configure its panorama locations.</p>
        </div>

        <div className="admin-topbar-actions">
          <button onClick={() => navigate("/")}>Open Viewer</button>
          <button className="danger-soft" onClick={logout}>Logout</button>
        </div>
      </header>

      <main className="admin-split-layout">
        <aside className="admin-left-panel">
          <section className="admin-panel-section">
            <label className="admin-field-label">Site</label>
            <select
              value={selectedSiteId}
              onChange={(event) => {
                setSelectedSiteId(event.target.value);
                setSelectedAreaId(null);
                setDraft(null);
                setIsMapping(false);
              }}
            >
              {Object.values(maps).map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </section>

          <section className="admin-panel-section">
            <div className="admin-section-head">
              <div>
                <h2>Mapped Areas</h2>
                <p>Click a card to configure locations.</p>
              </div>
              <button className="primary" onClick={startNewArea}>+ Add Area</button>
            </div>

            <div className="mapped-area-list">
              {site?.areas?.map((area) => (
                <div
                  key={area.id}
                  className={`mapped-area-card ${selectedAreaId === area.id ? "active" : ""}`}
                  onClick={() => openConfiguration(area)}
                >
                  <div className="mapped-area-main">
                    <strong>{area.name}</strong>
                    <span>{Object.keys(area.tour?.scenes || {}).length} panorama location(s)</span>
                  </div>

                  <div className="mapped-area-actions" onClick={(event) => event.stopPropagation()}>
                    <button onClick={() => editArea(area)}>Edit</button>
                    <button className="danger-soft" onClick={() => deleteArea(area.id)}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {draft && (
            <section className="area-editor-card">
              <div className="admin-section-head compact">
                <div>
                  <h2>{draft.id ? "Edit Mapped Area" : "New Mapped Area"}</h2>
                  <p>This section is only for polygon mapping.</p>
                </div>
              </div>

              <label className="admin-field-label">Area Name</label>
              <input
                value={draft.name}
                onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="Example: Packing Area"
              />

              <div className="point-summary">
                <strong>{draftPoints.length}</strong>
                <span>points mapped</span>
              </div>

              <div className="editor-button-grid">
                <button className={isMapping ? "active-map-btn" : ""} onClick={() => setIsMapping((value) => !value)}>
                  {isMapping ? "Stop Mapping" : "Map Area"}
                </button>
                <button onClick={undoPoint} disabled={draftPoints.length === 0}>Undo Point</button>
              </div>

              <div className="editor-button-grid bottom">
                <button onClick={cancelEdit}>Cancel</button>
                <button className="primary" onClick={saveArea}>Save Area</button>
              </div>
            </section>
          )}
        </aside>

        <section className="admin-map-workspace">
          <div className="map-workspace-header">
            <div>
              <h2>{site?.name}</h2>
              <p>{isMapping ? "Click the map to add polygon points." : "Click a saved area to configure panorama locations."}</p>
            </div>
            {draft && (
              <div className="mapping-status-pill">
                {isMapping ? "Mapping active" : "Editing area"} · {draftPoints.length} point(s)
              </div>
            )}
          </div>

          <div className={`admin-map-canvas ${isMapping ? "is-mapping" : ""}`} onClick={handleMapClick}>
            {site?.mapImage && <img src={site.mapImage} alt={site.name} />}

            <svg className="admin-map-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
              {site?.areas?.map((area) => (
                <polygon
                  key={area.id}
                  points={area.points}
                  className={`admin-area-shape ${selectedAreaId === area.id ? "selected" : ""}`}
                  onClick={(event) => {
                    if (isMapping || draft) return;
                    event.stopPropagation();
                    openConfiguration(area);
                  }}
                />
              ))}

              {draftPoints.length > 0 && (
                <>
                  <polyline points={draftPoints.join(" ")} className="admin-draft-line" />
                  {draftPoints.length >= 3 && <polygon points={draftPoints.join(" ")} className="admin-draft-shape" />}
                  {draftPoints.map((point, index) => {
                    const [x, y] = point.split(",");
                    return <circle key={`${point}-${index}`} cx={x} cy={y} r="1.1" className="admin-draft-dot" />;
                  })}
                </>
              )}
            </svg>
          </div>
        </section>
      </main>
    </div>
  );
}

export default AdminPage;
