import { useEffect, useMemo, useRef, useState } from "react";
import "pannellum/build/pannellum.css";
import "pannellum";

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

function getSceneConnections(map, sceneId) {
  if (!map?.connections) return [];

  return map.connections.filter(
    (connection) =>
      connection.from === sceneId &&
      map.scenes?.[connection.from] &&
      map.scenes?.[connection.to]
  );
}

function MiniMap({ map, currentScene, onSceneClick, isMoving }) {
  const [mapZoom, setMapZoom] = useState(0.72);

  const activeScene = map.scenes[currentScene];

  return (
    <div className="mini-map">
      <div className="mini-map-header">
        <div>
          <div className="mini-map-title">SITE MAP</div>
          <div className="mini-map-subtitle">{map.name}</div>
        </div>

        <div className="mini-map-zoom-controls">
          <button
            type="button"
            onClick={() => setMapZoom((prev) => Math.max(prev - 0.12, 0.45))}
            disabled={mapZoom <= 0.45}
          >
            −
          </button>

          <button
            type="button"
            onClick={() => setMapZoom(0.72)}
            className="mini-map-reset"
          >
            reset
          </button>

          <button
            type="button"
            onClick={() => setMapZoom((prev) => Math.min(prev + 0.12, 1.25))}
            disabled={mapZoom >= 1.25}
          >
            +
          </button>
        </div>
      </div>

      <div className="mini-map-body">
        <div
          className="mini-map-world"
          style={{
            "--active-left": `${activeScene?.minimap?.x ?? 50}%`,
            "--active-top": `${activeScene?.minimap?.y ?? 50}%`,
            "--map-zoom": mapZoom,
          }}
        >
          <div className="mini-map-path-line vertical-top"></div>
          <div className="mini-map-path-line vertical-bottom"></div>
          <div className="mini-map-path-line horizontal-left"></div>
          <div className="mini-map-path-line horizontal-right"></div>

          {Object.entries(map.scenes).map(([sceneId, scene]) => (
            <button
              key={sceneId}
              disabled={isMoving}
              className={`mini-map-node ${
                currentScene === sceneId ? "active" : ""
              }`}
              style={{
                left: `${scene.minimap?.x ?? 50}%`,
                top: `${scene.minimap?.y ?? 50}%`,
              }}
              onClick={() => onSceneClick(sceneId, scene.title)}
              title={scene.title}
            >
              <span className="mini-map-dot"></span>
              <span className="mini-map-label">{scene.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function StreetViewer({ mapData }) {
  const viewerRef = useRef(null);
  const viewerShellRef = useRef(null);
  const viewerInstance = useRef(null);
  const moveTimerRef = useRef(null);
  const isMovingRef = useRef(false);
  const currentSceneRef = useRef(mapData?.settings?.firstScene || "");

  const [currentScene, setCurrentScene] = useState(
    mapData?.settings?.firstScene || ""
  );
  const [isMoving, setIsMoving] = useState(false);
  const [moveLabel, setMoveLabel] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [viewerDebug, setViewerDebug] = useState({
    yaw: 0,
    pitch: 0,
    hfov: 0,
  });

  const map = useMemo(() => mapData, [mapData]);

  if (!map || !map.settings || !map.scenes) {
    return (
      <div className="viewer-error-page">
        <div className="viewer-error-card">
          <h1>Invalid tour data</h1>
          <p>
            This area has no valid tour. Check <code>mapData.js</code> and make
            sure the selected area has <code>tour</code>, <code>settings</code>,
            and <code>scenes</code>.
          </p>
        </div>
      </div>
    );
  }

  const currentTitle = map.scenes[currentScene]?.title || "Street View";

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
    if (!map.scenes[sceneId]) return;
    if (sceneId === currentSceneRef.current) return;

    setMoveLabel(label || map.scenes[sceneId].title || "Next Area");
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

  function buildPannellumScenes() {
    return Object.fromEntries(
      Object.entries(map.scenes).map(([sceneId, scene]) => {
        const sceneConnections = getSceneConnections(map, sceneId);

        return [
          sceneId,
          {
            title: scene.title,
            type: "equirectangular",
            panorama: scene.panorama,
            yaw: scene.view?.initialYaw ?? 0,
            pitch: scene.view?.initialPitch ?? 0,
            hfov:
              window.innerWidth < 768
                ? map.settings.mobileHfov
                : scene.view?.initialHfov || map.settings.defaultHfov,

            hotSpots: sceneConnections.map((connection) => ({
              yaw: connection.hotspot.yaw,
              pitch: connection.hotspot.pitch,
              type: "info",
              text: connection.label,
              cssClass: "hidden-default-hotspot",
              createTooltipFunc: createArrowTooltip,
              createTooltipArgs: {
                label: connection.label,
                icon: connection.hotspot.icon,
              },
              clickHandlerFunc: () => {
                animatedGoToScene(
                  connection.to,
                  map.scenes[connection.to]?.title
                );
              },
            })),
          },
        ];
      })
    );
  }

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

  async function copyCurrentHotspot() {
    const text = `{
  id: "${currentScene.toLowerCase()}-to-target",
  from: "${currentScene}",
  to: "TargetScene",
  label: "Target Label",
  type: "move",
  hotspot: {
    yaw: ${viewerDebug.yaw},
    pitch: ${viewerDebug.pitch},
    icon: "↑",
  },
},`;

    try {
      await navigator.clipboard.writeText(text);
      console.log("Copied hotspot:", text);
    } catch (error) {
      console.error("Failed to copy hotspot:", error);
    }
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

  useEffect(() => {
    const interval = setInterval(() => {
      if (!viewerInstance.current) return;

      setViewerDebug({
        yaw: Number(viewerInstance.current.getYaw()?.toFixed(2) || 0),
        pitch: Number(viewerInstance.current.getPitch()?.toFixed(2) || 0),
        hfov: Number(viewerInstance.current.getHfov()?.toFixed(2) || 0),
      });
    }, 250);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!viewerRef.current || !window.pannellum) return;

    if (viewerInstance.current) {
      viewerInstance.current.destroy();
      viewerInstance.current = null;
    }

    const firstScene = map.settings.firstScene;

    currentSceneRef.current = firstScene;
    setCurrentScene(firstScene);

    viewerInstance.current = window.pannellum.viewer(viewerRef.current, {
      default: {
        firstScene,
        sceneFadeDuration: 300,
        autoLoad: true,
        showControls: true,
        showZoomCtrl: true,
        showFullscreenCtrl: false,
        compass: false,
      },
      scenes: buildPannellumScenes(),
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
  }, [map]);

  return (
    <main className="street-viewer-wrapper">
      <div
        ref={viewerShellRef}
        className={`viewer-motion-shell ${isMoving ? "moving" : ""} ${
          isFullscreen ? "is-fullscreen" : ""
        }`}
      >
        <div ref={viewerRef} className="panorama-viewer" />

        <MiniMap
          map={map}
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

        <div className="debug-panel">
          <div className="debug-title">Viewer Debug</div>

          <div className="debug-row">
            <span>Scene</span>
            <strong>{currentScene}</strong>
          </div>

          <div className="debug-row">
            <span>Yaw</span>
            <strong>{viewerDebug.yaw}</strong>
          </div>

          <div className="debug-row">
            <span>Pitch</span>
            <strong>{viewerDebug.pitch}</strong>
          </div>

          <div className="debug-row">
            <span>HFOV</span>
            <strong>{viewerDebug.hfov}</strong>
          </div>

          <button
            type="button"
            className="debug-copy-btn"
            onClick={copyCurrentHotspot}
          >
            Copy hotspot
          </button>
        </div>

        <div className={`move-transition ${isMoving ? "active" : ""}`}>
          <div className="move-tunnel"></div>
          <div className="move-pulse"></div>

          <div className="move-text">
            <div className="move-kicker">Moving to</div>
            <div className="move-destination">{moveLabel}</div>
          </div>
        </div>

        <div className="viewer-current-pill">Current: {currentTitle}</div>
      </div>
    </main>
  );
}

export default StreetViewer;