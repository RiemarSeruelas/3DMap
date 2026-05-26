import { useState } from "react";
import { useNavigate } from "react-router-dom";

function LoginPage() {
  const navigate = useNavigate();

  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("engineering2026");
  const [error, setError] = useState("");

  function handleLogin(event) {
    event.preventDefault();

    const isAdmin = username === "admin" && password === "engineering2026";
    const isViewer = username === "viewer" && password === "viewer2026";

    if (isAdmin) {
      sessionStorage.setItem("streetViewAuth", "true");
      sessionStorage.setItem("streetViewRole", "admin");
      navigate("/admin", { replace: true });
      return;
    }

    if (isViewer) {
      sessionStorage.setItem("streetViewAuth", "true");
      sessionStorage.setItem("streetViewRole", "user");
      navigate("/", { replace: true });
      return;
    }

    setError("Invalid username or password.");
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">360</div>

        <div className="login-title-block">
          <h1>Company Street View</h1>
          <p>Authorized access only</p>
        </div>

        <form className="login-form" onSubmit={handleLogin}>
          <div className="login-field">
            <label>Username</label>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="admin or viewer"
            />
          </div>

          <div className="login-field">
            <label>Password</label>
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              placeholder="Enter password"
            />
          </div>

          {error && <div className="login-error">{error}</div>}

          <button type="submit" className="login-button">
            Log In
          </button>
        </form>

        <div className="login-hint">
          <p><strong>Admin:</strong> admin / engineering2026</p>
          <p><strong>Viewer:</strong> viewer / viewer2026</p>
        </div>
      </div>
    </div>
  );
}

export default LoginPage;
