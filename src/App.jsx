import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import LoginPage from "./pages/LoginPage";
import KioskPage from "./pages/KioskPage";
import AreaMapPage from "./pages/AreaMapPage";
import StreetViewPage from "./pages/StreetViewPage";
import AdminPage from "./pages/AdminPage";
import AdminAreaConfigPage from "./pages/AdminAreaConfigPage";
import "./styles/admin.css";
import "./styles/AdminAreaConfigPage.css";
import "./styles/streetview-scene-transition.css";
import { hydrateFactoryMapsFromPublicJson } from "./utils/streetViewAdminStorage";

function ProtectedRoute({ children, role }) {
  const isLoggedIn = sessionStorage.getItem("streetViewAuth") === "true";
  const userRole = sessionStorage.getItem("streetViewRole");

  if (!isLoggedIn) {
    return <Navigate to="/login" replace />;
  }

  // Admin can access both admin and viewer pages.
  if (userRole === "admin") {
    return children;
  }

  // Viewer/user cannot access admin pages.
  if (role && userRole !== role) {
    return <Navigate to="/" replace />;
  }

  return children;
}

function App() {
  useEffect(() => {
    hydrateFactoryMapsFromPublicJson();
  }, []);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        path="/"
        element={
          <ProtectedRoute role="user">
            <KioskPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/map/:siteId"
        element={
          <ProtectedRoute role="user">
            <AreaMapPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/viewer/:siteId/:areaId"
        element={
          <ProtectedRoute role="user">
            <StreetViewPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/admin"
        element={
          <ProtectedRoute role="admin">
            <AdminPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/admin/config/:siteId/:areaId"
        element={
          <ProtectedRoute role="admin">
            <AdminAreaConfigPage />
          </ProtectedRoute>
        }
      />

      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

export default App;
