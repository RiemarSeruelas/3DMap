import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { login } from "../utils/auth";

function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleLogin(event) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const payload = await login(username.trim(), password);
      sessionStorage.setItem("streetViewAuth", "true");
      sessionStorage.setItem("streetViewRole", payload.role);
      navigate(payload.role === "admin" ? "/admin" : "/", { replace: true });
    } catch (loginError) {
      setError(loginError.message || "Invalid username or password.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">360</div>
        <div className="login-title-block">
          <h1>Company Street View</h1>
          <p>Internal network access</p>
        </div>
        <form className="login-form" onSubmit={handleLogin}>
          <div className="login-field">
            <label>Username</label>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="Enter username"
              autoComplete="username"
              required
            />
          </div>
          <div className="login-field">
            <label>Password</label>
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              placeholder="Enter password"
              autoComplete="current-password"
              required
            />
          </div>
          {error && <div className="login-error">{error}</div>}
          <button type="submit" className="login-button" disabled={submitting}>
            {submitting ? "Logging In..." : "Log In"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default LoginPage;
