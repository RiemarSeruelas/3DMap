import { Navigate, Route, Routes } from "react-router-dom";
import LoginPage from "./pages/LoginPage";
import KioskPage from "./pages/KioskPage";
import AreaMapPage from "./pages/AreaMapPage";
import StreetViewPage from "./pages/StreetViewPage";


function ProtectedRoute({ children }) {
  const isLoggedIn = sessionStorage.getItem("streetViewAuth") === "true";

  if (!isLoggedIn) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        path="/"
        element={
          <ProtectedRoute>
            <KioskPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/map/:siteId"
        element={
          <ProtectedRoute>
            <AreaMapPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/viewer/:siteId/:areaId"
        element={
          <ProtectedRoute>
            <StreetViewPage />
          </ProtectedRoute>
        }
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;