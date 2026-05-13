import { useEffect, useMemo, useRef, useState } from "react";
import "pannellum/build/pannellum.css";
import "pannellum";
import "./App.css";

function createArrowTooltip(hotSpotDiv, args) {
  hotSpotDiv.classList.add("custom-arrow-hotspot");

  const arrow = document.createElement("div");
  arrow.className = "arrow-circle";
  arrow.innerHTML = args.icon || "➜";

  const label = document.createElement("div");
  label.className = "arrow-label";
  label.innerText = args.label;

  hotSpotDiv.appendChild(arrow);
  hotSpotDiv.appendChild(label);
}

function MiniMap({ sceneConfig, currentScene, onSceneClick, isMoving }) {
  const [mapZoom, setMapZoom] = useState(0.72);

  const activeScene = sceneConfig[currentScene];

  function zoomInMap() {
    setMapZoom((prev) => Math.min(prev + 0.12, 1.25));
  }

  function zoomOutMap() {
    setMapZoom((prev) => Math.max(prev - 0.12, 0.45));
  }

  function resetMapZoom() {
    setMapZoom(0.72);
  }

  return (
    <div className="mini-map">
      <div className="mini-map-header">
        <div>
          <div className="mini-map-title">SITE MAP</div>
          <div className="mini-map-subtitle">Current walkthrough</div>
        </div>

        <div className="mini-map-zoom-controls">
          <button type="button" onClick={zoomOutMap} disabled={mapZoom <= 0.45}>
            −
          </button>

          <button type="button" onClick={resetMapZoom} className="mini-map-reset">
            reset
          </button>

          <button type="button" onClick={zoomInMap} disabled={mapZoom >= 1.25}>
            +
          </button>
        </div>
      </div>

      <div className="mini-map-body">
        <div
          className="mini-map-world"
          style={{
            "--active-left": activeScene?.mapPosition.left || "50%",
            "--active-top": activeScene?.mapPosition.top || "50%",
            "--map-zoom": mapZoom,
          }}
        >
          <div className="mini-map-path-line"></div>

          {Object.entries(sceneConfig).map(([sceneId, scene]) => (
            <button
              key={sceneId}
              disabled={isMoving}
              className={`mini-map-node ${
                currentScene === sceneId ? "active" : ""
              }`}
              style={{
                left: scene.mapPosition.left,
                top: scene.mapPosition.top,
              }}
              onClick={() => onSceneClick(sceneId, scene.title)}
              title={scene.title}
            >
              <span className="mini-map-dot"></span>
              <span className="mini-map-label">{scene.mapLabel}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function App() {
  const viewerRef = useRef(null);
  const viewerInstance = useRef(null);
  const moveTimerRef = useRef(null);
  const isMovingRef = useRef(false);
  const currentSceneRef = useRef("Sea");

  const [currentScene, setCurrentScene] = useState("Sea");
  const [isMoving, setIsMoving] = useState(false);
  const [moveLabel, setMoveLabel] = useState("");
  const viewerShellRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const sceneConfig = useMemo(
    () => ({
      Sea: {
  title: "Sea",
  panorama: "/panos/sea.jpg",
  mapLabel: "Sea",
  mapPosition: { left: "50%", top: "52%" },
  initialYaw: 0,
  initialPitch: 0,
  hotspots: [
    { label: "Rome", target: "Rome", yaw: 0, pitch: -10, icon: "↑" },
    { label: "Room", target: "Room", yaw: -90, pitch: -8, icon: "←" },
    { label: "Heaven", target: "Heaven", yaw: 90, pitch: -8, icon: "→" },
  ],
},

Rome: {
  title: "Rome",
  panorama: "/panos/drone.jpg",
  mapLabel: "Rome",
  mapPosition: { left: "50%", top: "22%" },
  initialYaw: 0,
  initialPitch: 0,
  hotspots: [
    { label: "River", target: "River", yaw: 0, pitch: -10, icon: "↑" },
    { label: "Sea", target: "Sea", yaw: 180, pitch: -10, icon: "↓" },
    { label: "Room", target: "Room", yaw: -90, pitch: -8, icon: "←" },
    { label: "Heaven", target: "Heaven", yaw: 90, pitch: -8, icon: "→" },
  ],
},

River: {
  title: "River",
  panorama: "/panos/river.jpg",
  mapLabel: "River",
  mapPosition: { left: "50%", top: "82%" },
  initialYaw: 0,
  initialPitch: 0,
  hotspots: [
    { label: "Rome", target: "Rome", yaw: 180, pitch: -10, icon: "↓" },
    { label: "Room", target: "Room", yaw: -90, pitch: -8, icon: "←" },
    { label: "Heaven", target: "Heaven", yaw: 90, pitch: -8, icon: "→" },
  ],
},

Room: {
  title: "Room",
  panorama: "/panos/room.jpg",
  mapLabel: "Room",
  mapPosition: { left: "18%", top: "52%" },
  initialYaw: 0,
  initialPitch: 0,
  hotspots: [
    { label: "Sea", target: "Sea", yaw: 0, pitch: -10, icon: "↑" },
    { label: "Rome", target: "Rome", yaw: 90, pitch: -8, icon: "→" },
    { label: "River", target: "River", yaw: 180, pitch: -10, icon: "↓" },
  ],
},

Heaven: {
  title: "Heaven",
  panorama: "/panos/heaven.jpg",
  mapLabel: "Heaven",
  mapPosition: { left: "82%", top: "52%" },
  initialYaw: 0,
  initialPitch: 0,
  hotspots: [
    { label: "Sea", target: "Sea", yaw: 0, pitch: -10, icon: "↑" },
    { label: "Rome", target: "Rome", yaw: -90, pitch: -8, icon: "←" },
    { label: "River", target: "River", yaw: 180, pitch: -10, icon: "↓" },
  ],
},
    }),
    []
  );

  function setMovingState(value) {
    isMovingRef.current = value;
    setIsMoving(value);
  }

  function updateCurrentScene(sceneId) {
    currentSceneRef.current = sceneId;
    setCurrentScene(sceneId);
  }

  function animatedGoToScene(sceneId, label = "") {
    if (!viewerInstance.current || isMovingRef.current) return;
    if (!sceneConfig[sceneId]) return;
    if (sceneId === currentSceneRef.current) return;

    setMoveLabel(label || sceneConfig[sceneId].title || "Next Area");
    setMovingState(true);

    if (moveTimerRef.current) {
      clearTimeout(moveTimerRef.current);
    }

    moveTimerRef.current = setTimeout(() => {
      viewerInstance.current.loadScene(sceneId);
      updateCurrentScene(sceneId);

      setTimeout(() => {
        setMovingState(false);
        setMoveLabel("");
      }, 250);
    }, 650);
  }

  useEffect(() => {
  function handleFullscreenChange() {
    const active = document.fullscreenElement === viewerShellRef.current;
    setIsFullscreen(active);

    setTimeout(() => {
      if (viewerInstance.current?.resize) {
        viewerInstance.current.resize();
      }
    }, 100);
  }

  document.addEventListener("fullscreenchange", handleFullscreenChange);

  return () => {
    document.removeEventListener("fullscreenchange", handleFullscreenChange);
  };
}, []);

  async function toggleFullscreen() {
  const shell = viewerShellRef.current;
  if (!shell) return;

  try {
    if (!document.fullscreenElement) {
      await shell.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  } catch (error) {
    console.error("Fullscreen failed:", error);
  }
}

  useEffect(() => {
    if (!viewerRef.current || !window.pannellum) return;

    const pannellumScenes = Object.fromEntries(
      Object.entries(sceneConfig).map(([sceneId, scene]) => [
        sceneId,
        {
          title: scene.title,
          type: "equirectangular",
          panorama: scene.panorama,
          pitch: scene.initialPitch,
          yaw: scene.initialYaw,
          hfov: window.innerWidth < 768 ? 90 : 110,

          hotSpots: scene.hotspots.map((hotspot) => ({
            pitch: hotspot.pitch,
            yaw: hotspot.yaw,
            type: "info",
            text: hotspot.label,
            cssClass: "hidden-default-hotspot",
            createTooltipFunc: createArrowTooltip,
            createTooltipArgs: {
              label: hotspot.label,
              icon: hotspot.icon,
            },
            clickHandlerFunc: () => {
              animatedGoToScene(
                hotspot.target,
                sceneConfig[hotspot.target]?.title
              );
            },
          })),
        },
      ])
    );

    viewerInstance.current = window.pannellum.viewer(viewerRef.current, {
      default: {
        firstScene: "Sea",
        sceneFadeDuration: 300,
        autoLoad: true,
        showControls: true,
        showZoomCtrl: true,
        showFullscreenCtrl: false,
        compass: false,
      },
      scenes: pannellumScenes,
    });

    viewerInstance.current.on("scenechange", (sceneId) => {
      updateCurrentScene(sceneId);
    });

    return () => {
      if (moveTimerRef.current) {
        clearTimeout(moveTimerRef.current);
      }

      if (viewerInstance.current) {
        viewerInstance.current.destroy();
        viewerInstance.current = null;
      }
    };
  }, [sceneConfig]);

  const currentTitle = sceneConfig[currentScene]?.title || "Street View";

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="desktop-topbar">
          <div className="topbar-left">
            <div className="brand-card">
              <div className="brand-icon">360</div>

              <div>
                <div className="brand-title">STREET VIEW</div>
                <div className="brand-subtitle">EQUIRECTANGULAR DEMO</div>
              </div>
            </div>

            <div className="topbar-center">
              {Object.entries(sceneConfig).map(([sceneId, scene]) => (
                <button
                  key={sceneId}
                  disabled={isMoving}
                  className={`top-nav-btn ${
                    currentScene === sceneId ? "active" : ""
                  }`}
                  onClick={() => animatedGoToScene(sceneId, scene.title)}
                >
                  {scene.title}
                </button>
              ))}
            </div>
          </div>

          <div className="topbar-right">
            <div className="top-state-inline running">
              <span className="top-state-dot"></span>
              {isMoving ? "MOVING" : "360 READY"}
            </div>
          </div>
        </div>
      </header>

      <section className="street-summary-strip">
        <div className="street-summary-left">
          <div className="street-summary-badge">📍</div>

          <div>
            <div className="street-summary-title">{currentTitle}</div>
            <div className="street-summary-subtitle">
              Drag the view. Arrows are embedded inside the 360 panorama.
            </div>
          </div>
        </div>

        <div className="street-summary-right">
          <div className="street-location-pill">Current: {currentTitle}</div>
        </div>
      </section>

      <main className="street-viewer-wrapper">
        <div
  ref={viewerShellRef}
  className={`viewer-motion-shell ${isMoving ? "moving" : ""} ${
    isFullscreen ? "is-fullscreen" : ""
  }`}
>
  <div ref={viewerRef} className="panorama-viewer" />

  <MiniMap
    sceneConfig={sceneConfig}
    currentScene={currentScene}
    onSceneClick={animatedGoToScene}
    isMoving={isMoving}
  />

  <button
    type="button"
    className="custom-fullscreen-btn"
    onClick={toggleFullscreen}
    title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
  >
    {isFullscreen ? "⤢" : "⛶"}
  </button>

  <div className={`move-transition ${isMoving ? "active" : ""}`}>
    <div className="move-tunnel"></div>
    <div className="move-pulse"></div>

    <div className="move-text">
      <div className="move-kicker">Moving to</div>
      <div className="move-destination">{moveLabel}</div>
    </div>
  </div>
</div>
      </main>
    </div>
  );
}

export default App;