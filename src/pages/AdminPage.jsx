import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createUniqueId,
  deleteArea,
  ensureTour,
  getEffectiveFactoryMaps,
  getPercentPoint,
  pointsArrayToString,
  pointsStringToArray,
  saveArea,
  saveFactoryMaps,
  uploadAdminImage,
} from "../utils/streetViewAdminStorage";
import "../styles/streetview-clean-viewer-map-admin.css";

function createBlankDraft(site) {
  const existingIds = site?.areas?.map((area) => area.id) || [];
  const id = createUniqueId("new-area", existingIds);

  return {
    id,
    name: "",
    points: [],
    original: null,
  };
}

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

function AdminPage() {
  const navigate = useNavigate();
  const mapUploadRef = useRef(null);

  const [maps, setMaps] = useState(() => getEffectiveFactoryMaps());
  const [selectedSiteId, setSelectedSiteId] = useState("");
  const [draftArea, setDraftArea] = useState(null);
  const [areasModalOpen, setAreasModalOpen] = useState(false);
  const [areaModalOpen, setAreaModalOpen] = useState(false);
  const [isMapping, setIsMapping] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");

  const site = selectedSiteId ? maps[selectedSiteId] : null;
  const siteOptions = useMemo(() => Object.values(maps), [maps]);
  const draftPolygon = draftArea?.points?.length ? pointsArrayToString(draftArea.points) : "";

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

  function showSaved(text = "Saved") {
    setSaveMessage(text);
    window.clearTimeout(window.__streetViewSaveTimer);
    window.__streetViewSaveTimer = window.setTimeout(() => setSaveMessage(""), 1600);
  }

  function selectSite(siteId) {
    setSelectedSiteId(siteId);
    setDraftArea(null);
    setAreasModalOpen(false);
    setAreaModalOpen(false);
    setIsMapping(false);
  }

  function updateSiteMapImage(imagePath) {
    if (!site) return;

    const nextMaps = {
      ...maps,
      [site.id]: {
        ...site,
        mapImage: imagePath,
      },
    };

    const saved = saveFactoryMaps(nextMaps);
    setMaps(saved);
    showSaved("Map image saved");
  }

  async function handleMapImageUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      showSaved("Uploading map...");
      const imagePath = await uploadAdminImage(file, "maps");
      updateSiteMapImage(imagePath);
    } finally {
      event.target.value = "";
    }
  }

  function openNewArea() {
    if (!site?.mapImage) {
      alert("Add a site map image first.");
      return;
    }

    setDraftArea(createBlankDraft(site));
    setAreasModalOpen(false);
    setAreaModalOpen(true);
    setIsMapping(false);
  }

  function openEditArea(area) {
    setDraftArea({
      id: area.id,
      name: area.name,
      points: pointsStringToArray(area.points),
      original: area,
    });
    setAreasModalOpen(false);
    setAreaModalOpen(true);
    setIsMapping(false);
  }

  function startMapping() {
    if (!site?.mapImage) {
      alert("Add a site map image first.");
      return;
    }

    setAreaModalOpen(false);
    setIsMapping(true);
  }

  function backToEdit() {
    setIsMapping(false);
    setAreaModalOpen(true);
  }

  function handleMapClick(event) {
    if (!isMapping || !draftArea) return;

    const point = getPercentPoint(event, event.currentTarget);
    setDraftArea((current) => ({
      ...current,
      points: [...current.points, point],
    }));
  }

  function undoPoint() {
    setDraftArea((current) => {
      if (!current) return current;
      return {
        ...current,
        points: current.points.slice(0, -1),
      };
    });
  }

  function saveMappedArea() {
    if (!site || !draftArea) return;

    const cleanName = draftArea.name.trim();

    if (!cleanName) {
      alert("Please enter an area name first.");
      setAreaModalOpen(true);
      setIsMapping(false);
      return;
    }

    if (draftArea.points.length < 3) {
      alert("Please map at least 3 points for the area.");
      return;
    }

    const existingIds = site.areas.map((area) => area.id).filter((id) => id !== draftArea.id);
    const safeId = draftArea.original ? draftArea.id : createUniqueId(cleanName, existingIds);

    const nextArea = {
      ...(draftArea.original || {}),
      id: safeId,
      name: cleanName,
      points: pointsArrayToString(draftArea.points),
      tour: draftArea.original?.tour,
    };

    const nextMaps = saveArea(site.id, nextArea);
    setMaps(nextMaps);
    setDraftArea(null);
    setAreaModalOpen(false);
    setIsMapping(false);
    setAreasModalOpen(true);
    showSaved("Mapped area saved");
  }

  function handleDeleteArea(area) {
    const ok = window.confirm(`Delete ${area.name}?`);
    if (!ok) return;

    const nextMaps = deleteArea(site.id, area.id);
    setMaps(nextMaps);
    setAreasModalOpen(true);
    showSaved("Mapped area deleted");
  }

  if (!selectedSiteId) {
    return (
      <div className="admin-site-start-page">
        <div className="admin-start-card">
          <div className="admin-start-logo">360</div>
          <p className="admin-eyebrow">STREET VIEW ADMIN</p>
          <h1>Choose Site</h1>
          <p>Pick a factory block first. After that, you can add or change its map image and create mapped areas.</p>

          <div className="admin-start-grid">
            {siteOptions.map((siteOption) => (
              <button key={siteOption.id} className="admin-start-site-card" onClick={() => selectSite(siteOption.id)}>
                <span>{siteOption.name}</span>
                <small>{siteOption.mapImage ? "Map image available" : "No map image yet"}</small>
              </button>
            ))}
          </div>

          <div className="admin-start-actions">
            <button onClick={() => navigate("/")}>Open Viewer</button>
            <button className="danger" onClick={logout}>Logout</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-page admin-map-only-page admin-side-nav-page">
      <aside className="admin-side-navbar">
        <div className="admin-side-brand">
          <div className="admin-nav-logo">360</div>
          <div>
            <p className="admin-eyebrow">STREET VIEW ADMIN</p>
            <h1>{site?.name || "Area Mapping"}</h1>
          </div>
        </div>

        {saveMessage && <span className="admin-save-pill side-save-pill">{saveMessage}</span>}

        {isMapping && draftArea && (
          <div className="admin-side-map-status">
            <p className="admin-eyebrow">Mapping Mode</p>
            <strong>{draftArea.name || "Unnamed Area"}</strong>
            <span>{draftArea.points.length} point(s)</span>
            <button onClick={undoPoint} disabled={draftArea.points.length === 0}>Undo Point</button>
            <button onClick={backToEdit}>Back to Edit</button>
            <button className="primary" onClick={saveMappedArea}>Save Area</button>
          </div>
        )}

        <nav className="admin-side-nav-actions">
          <input ref={mapUploadRef} type="file" accept="image/*" hidden onChange={handleMapImageUpload} />
          <button onClick={() => mapUploadRef.current?.click()}>
            {site?.mapImage ? "Change Map" : "Add Map"}
          </button>
          <button className="primary" onClick={() => setAreasModalOpen(true)}>Mapped Areas</button>
          <button onClick={() => setSelectedSiteId("")}>Change Site</button>
          <button onClick={() => navigate("/")}>Open Viewer</button>
          <button className="danger" onClick={logout}>Logout</button>
        </nav>
      </aside>

      <main className="admin-side-map-stage">
        <div className="admin-map-main-full">
          {!site?.mapImage && (
            <div className="admin-big-empty-map">
              <h2>Add a map image first</h2>
              <p>This area will show the site map once uploaded. After that, use Add Area to draw parent areas.</p>
              <button className="admin-primary-btn" onClick={() => mapUploadRef.current?.click()}>+ Add Map Image</button>
            </div>
          )}

          {site?.mapImage && (
            <div className={`admin-fixed-map-canvas ${isMapping ? "is-mapping" : ""}`} onClick={handleMapClick}>
              <img src={site.mapImage} alt={site.name} />

              <svg viewBox="0 0 100 100" preserveAspectRatio="none">
                {site.areas.map((area) => (
                  <polygon
                    key={area.id}
                    points={area.points}
                    className={`admin-existing-polygon ${!isMapping ? "is-clickable" : ""}`}
                    onClick={(event) => {
                      if (isMapping) return;
                      event.stopPropagation();
                      navigate(getAreaConfigUrl(site.id, area));
                    }}
                  />
                ))}

                {draftPolygon && <polygon points={draftPolygon} className="admin-draft-polygon" />}

                {draftArea?.points?.map((point, index) => (
                  <circle key={`${point.x}-${point.y}-${index}`} cx={point.x} cy={point.y} r="0.85" className="admin-point-dot" />
                ))}
              </svg>

              {isMapping && (
                <div className="admin-map-instruction-pill">
                  Click the map to add polygon points. Use the side bar to undo, go back, or save.
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {areasModalOpen && (
        <div className="admin-modal-layer area-list-modal-layer">
          <div className="admin-modal mapped-areas-modal">
            <div className="admin-modal-header">
              <div>
                <p className="admin-eyebrow">Parent Areas</p>
                <h2>Mapped Areas</h2>
                <p className="admin-modal-subtitle">These are the clickable parent areas on the site map.</p>
              </div>
              <button className="admin-close-btn" onClick={() => setAreasModalOpen(false)}>×</button>
            </div>

            <div className="mapped-areas-modal-top">
              <div className="mapped-areas-count">
                <strong>{site?.areas?.length || 0}</strong>
                <span>area(s) mapped</span>
              </div>
              <button className="admin-primary-btn" onClick={openNewArea}>+ Add Area</button>
            </div>

            <div className="mapped-areas-popup-list">
              {!site?.areas?.length && (
                <div className="admin-empty-line large">
                  <strong>No mapped areas yet.</strong>
                  <span>Click + Add Area to start drawing parent areas.</span>
                </div>
              )}

              {site?.areas?.map((area, index) => (
                <article
                  key={area.id}
                  className="mapped-area-card-popup is-config-link"
                  onClick={() => navigate(getAreaConfigUrl(site.id, area))}
                >
                  <div className="mapped-area-index">{String(index + 1).padStart(2, "0")}</div>

                  <div className="mapped-area-main">
                    <strong>{area.name}</strong>
                    <small>Click to configure panorama locations</small>
                    <code>{area.points || "No points"}</code>
                  </div>

                  <div className="mapped-area-card-actions">
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        openEditArea(area);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      className="danger"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleDeleteArea(area);
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      )}

      {areaModalOpen && draftArea && (
        <div className="admin-modal-layer">
          <div className="admin-modal small-modal clean-area-modal">
            <div className="admin-modal-header">
              <div>
                <p className="admin-eyebrow">Mapped Area</p>
                <h2>{draftArea.original ? "Edit Area" : "Add Area"}</h2>
              </div>
              <button className="admin-close-btn" onClick={() => setAreaModalOpen(false)}>×</button>
            </div>

            <label className="admin-label">Area Name</label>
            <input
              className="admin-input"
              value={draftArea.name}
              onChange={(event) => setDraftArea((current) => ({ ...current, name: event.target.value }))}
              placeholder="Example: Admin, Process, QA"
            />

            <div className="admin-points-box">
              <span>{draftArea.points.length} point(s) mapped</span>
              <code>{draftPolygon || "No points yet"}</code>
            </div>

            <div className="admin-modal-actions">
              <button className="admin-secondary-btn" onClick={startMapping}>Map Area</button>
              <button className="admin-secondary-btn" onClick={undoPoint} disabled={draftArea.points.length === 0}>Undo Point</button>
              <button className="admin-primary-btn" onClick={saveMappedArea}>Save Area</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminPage;
