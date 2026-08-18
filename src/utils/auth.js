import { beginNewUsageSession, clearUsageSessionId, endUsageSession } from "./usageSession";

export async function login(username, password) {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Login failed");
  beginNewUsageSession();
  return payload;
}

export async function logout() {
  try {
    await endUsageSession(window.location.pathname).catch(() => {});
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
    });
  } finally {
    sessionStorage.removeItem("streetViewAuth");
    sessionStorage.removeItem("streetViewRole");
    clearUsageSessionId();
  }
}
