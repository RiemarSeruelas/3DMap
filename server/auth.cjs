const crypto = require("node:crypto");
const { pool, schema } = require("./db.cjs");

const COOKIE_NAME = process.env.AUTH_COOKIE_NAME || "streetview_session";
const SESSION_HOURS = Number(process.env.AUTH_SESSION_HOURS || 12);

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), String(salt), 64).toString("hex");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function parseCookies(header = "") {
  return Object.fromEntries(
    String(header)
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        if (index < 0) return [part, ""];
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      }),
  );
}

function cookieOptions() {
  const secure = ["1", "true", "yes", "on"].includes(String(process.env.AUTH_COOKIE_SECURE || "false").toLowerCase());
  return `HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_HOURS * 3600}${secure ? "; Secure" : ""}`;
}

async function seedUser(username, password, role) {
  if (!username || !password) return;
  const salt = crypto.randomBytes(16).toString("hex");
  const passwordHash = hashPassword(password, salt);
  await pool.query(
    `INSERT INTO ${schema}.map_users (username, role, password_salt, password_hash)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (username) DO UPDATE SET
       role = EXCLUDED.role,
       password_salt = EXCLUDED.password_salt,
       password_hash = EXCLUDED.password_hash,
       is_active = TRUE,
       updated_at = NOW()`,
    [username, role, salt, passwordHash],
  );
}

async function seedDefaultUsers() {
  if (!process.env.ADMIN_PASSWORD || !process.env.VIEWER_PASSWORD) {
    throw new Error("ADMIN_PASSWORD and VIEWER_PASSWORD must be set in .env");
  }
  await seedUser(process.env.ADMIN_USERNAME || "admin", process.env.ADMIN_PASSWORD, "admin");
  await seedUser(process.env.VIEWER_USERNAME || "viewer", process.env.VIEWER_PASSWORD, "user");
}

async function login(username, password) {
  const result = await pool.query(
    `SELECT username, role, password_salt, password_hash
     FROM ${schema}.map_users
     WHERE username = $1 AND is_active = TRUE`,
    [username],
  );
  if (!result.rowCount) return null;
  const user = result.rows[0];
  const candidate = hashPassword(password, user.password_salt);
  const expected = Buffer.from(user.password_hash, "hex");
  const actual = Buffer.from(candidate, "hex");
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;

  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600 * 1000);
  await pool.query(
    `INSERT INTO ${schema}.map_sessions (token_hash, username, role, expires_at)
     VALUES ($1,$2,$3,$4)`,
    [tokenHash, user.username, user.role, expiresAt],
  );
  return { token, username: user.username, role: user.role, expiresAt };
}

async function logout(token) {
  if (!token) return;
  await pool.query(`DELETE FROM ${schema}.map_sessions WHERE token_hash = $1`, [hashToken(token)]);
}

async function readSession(req) {
  const token = parseCookies(req.headers.cookie || "")[COOKIE_NAME];
  if (!token) return null;
  const result = await pool.query(
    `SELECT username, role, expires_at
     FROM ${schema}.map_sessions
     WHERE token_hash = $1 AND expires_at > NOW()`,
    [hashToken(token)],
  );
  if (!result.rowCount) return null;
  await pool.query(
    `UPDATE ${schema}.map_sessions SET last_seen_at = NOW() WHERE token_hash = $1`,
    [hashToken(token)],
  );
  return { token, ...result.rows[0] };
}

async function requireAuth(req, res, next) {
  try {
    const session = await readSession(req);
    if (!session) return res.status(401).json({ ok: false, error: "Authentication required" });
    req.auth = session;
    next();
  } catch (error) {
    next(error);
  }
}

async function requireAdmin(req, res, next) {
  try {
    const session = await readSession(req);
    if (!session) return res.status(401).json({ ok: false, error: "Authentication required" });
    if (session.role !== "admin") return res.status(403).json({ ok: false, error: "Administrator access required" });
    req.auth = session;
    next();
  } catch (error) {
    next(error);
  }
}

function setSessionCookie(res, token) {
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=${encodeURIComponent(token)}; ${cookieOptions()}`);
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
}

async function purgeExpiredSessions() {
  await pool.query(`DELETE FROM ${schema}.map_sessions WHERE expires_at <= NOW()`);
}

module.exports = {
  COOKIE_NAME,
  parseCookies,
  seedDefaultUsers,
  login,
  logout,
  readSession,
  requireAuth,
  requireAdmin,
  setSessionCookie,
  clearSessionCookie,
  purgeExpiredSessions,
};
