import { useState } from "react";
import { useNavigate } from "react-router-dom";

function LoginPage() {
  const navigate = useNavigate();

  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("engineering2026");
  const [error, setError] = useState("");

  function handleLogin(event) {
    event.preventDefault();

    if (username === "admin" && password === "engineering2026") {
      sessionStorage.setItem("streetViewAuth", "true");
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
              placeholder="admin"
            />
          </div>

          <div className="login-field">
            <label>Password</label>
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              placeholder="engineering2026"
            />
          </div>

          {error && <div className="login-error">{error}</div>}

          <button type="submit" className="login-button">
            Log In
          </button>
        </form>
      </div>
    </div>
  );
}

export default LoginPage;