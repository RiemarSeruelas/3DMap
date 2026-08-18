import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import LoginPage from "./pages/LoginPage";
import KioskPage from "./pages/KioskPage";
import AreaMapPage from "./pages/AreaMapPage";
import StreetViewPage from "./pages/StreetViewPage";
import AdminPage from "./pages/AdminPage";
import AdminAreaConfigPage from "./pages/AdminAreaConfigPage";
import "./styles/admin.css";
import { hydrateFactoryMapsFromPublicJson } from "./utils/streetViewAdminStorage";
import {
  startUsageSession,
  heartbeatUsageSession,
  endUsageSession,
} from "./utils/usageSession";


function UsageSessionTracker() {
  const location = useLocation();
  const isLoggedIn = sessionStorage.getItem("streetViewAuth") === "true";

  useEffect(() => {
    if (!isLoggedIn || location.pathname === "/login") return;
    startUsageSession(location.pathname).catch((error) => {
      console.warn("[streetview] Session log start failed:", error?.message || error);
    });
  }, [isLoggedIn, location.pathname]);

  useEffect(() => {
    if (!isLoggedIn || location.pathname === "/login") return;

    const heartbeat = window.setInterval(() => {
      heartbeatUsageSession(window.location.pathname).catch(() => {});
    }, 60_000);

    const handlePageHide = () => {
      endUsageSession(window.location.pathname).catch(() => {});
    };

    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.clearInterval(heartbeat);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [isLoggedIn, location.pathname]);

  return null;
}

function ProtectedRoute({ children, role }) {
  const isLoggedIn = sessionStorage.getItem("streetViewAuth") === "true";
  const userRole = sessionStorage.getItem("streetViewRole");

  if (!isLoggedIn) return <Navigate to="/login" replace />;
  if (userRole === "admin") return children;
  if (role && userRole !== role) return <Navigate to="/" replace />;
  return children;
}

function App() {
  useEffect(() => {
    hydrateFactoryMapsFromPublicJson();
  }, []);

  return (
    <>
      <UsageSessionTracker />
      <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<ProtectedRoute role="user"><KioskPage /></ProtectedRoute>} />
      <Route path="/map/:siteId" element={<ProtectedRoute role="user"><AreaMapPage /></ProtectedRoute>} />
      <Route path="/viewer/:siteId/:areaId" element={<ProtectedRoute role="user"><StreetViewPage /></ProtectedRoute>} />
      <Route path="/admin" element={<ProtectedRoute role="admin"><AdminPage /></ProtectedRoute>} />
      <Route path="/admin/config/:siteId/:areaId" element={<ProtectedRoute role="admin"><AdminAreaConfigPage /></ProtectedRoute>} />
      <Route path="/admin/storage" element={<Navigate to="/admin" replace />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </>
  );
}

export default App;
