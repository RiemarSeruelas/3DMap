const USAGE_SESSION_KEY = "streetViewUsageSessionId";

function createSessionId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `sv-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

export function getOrCreateUsageSessionId() {
  let sessionId = sessionStorage.getItem(USAGE_SESSION_KEY);
  if (!sessionId) {
    sessionId = createSessionId();
    sessionStorage.setItem(USAGE_SESSION_KEY, sessionId);
  }
  return sessionId;
}

export function beginNewUsageSession() {
  const sessionId = createSessionId();
  sessionStorage.setItem(USAGE_SESSION_KEY, sessionId);
  return sessionId;
}

export function clearUsageSessionId() {
  sessionStorage.removeItem(USAGE_SESSION_KEY);
}

async function postUsage(endpoint, path = null, { keepalive = false } = {}) {
  const sessionId = getOrCreateUsageSessionId();
  const response = await fetch(endpoint, {
    method: "POST",
    credentials: "same-origin",
    keepalive,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, path }),
  });

  if (!response.ok && response.status !== 401) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "Session log update failed");
  }
}

export function startUsageSession(path) {
  return postUsage("/api/usage/session/start", path);
}

export function heartbeatUsageSession(path) {
  return postUsage("/api/usage/session/heartbeat", path);
}

export function endUsageSession(path = null) {
  return postUsage("/api/usage/session/end", path, { keepalive: true });
}
