#!/usr/bin/env node
require("dotenv").config();

const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const cors = require("cors");
const { migrate, healthCheck, envBool } = require("./db.cjs");
const {
  getMapState,
  seedMapState,
  saveMapState,
  startUsageSession,
  touchUsageSession,
  endUsageSession,
  storageSummary,
  listAssets,
  getAssetById,
  getCleanupCandidates,
} = require("./repository.cjs");
const {
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
} = require("./auth.cjs");
const {
  ensureStorage,
  uploadsDir,
  upload,
  processUpload,
  maxUploadMb,
  storageRoot,
  generateAssetMultires,
  reconcileReferencedAssets,
  deleteAssetFiles,
  resolveAssetStoragePath,
  getMultiresAvailability,
} = require("./storage.cjs");
const { getMultiresQueueStatus } = require("./multires.cjs");

const app = express();
const host = process.env.API_HOST || process.env.SAVE_HOST || "0.0.0.0";
const port = Number(process.env.API_PORT || process.env.SAVE_PORT || 3010);
const importPath = path.resolve(
  process.env.IMPORT_JSON_PATH || path.join(process.cwd(), "migration", "streetview-data.json"),
);

app.disable("x-powered-by");
app.set("trust proxy", 1);

if (envBool("ENABLE_CORS", false)) {
  app.use(
    cors({
      origin: process.env.CORS_ORIGIN || true,
      credentials: true,
    }),
  );
}

app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "10mb" }));
app.use(express.urlencoded({ extended: true, limit: process.env.JSON_BODY_LIMIT || "10mb" }));

// Development-only static serving. In Docker production, Nginx serves this path directly.
app.use(
  "/uploads",
  express.static(uploadsDir, {
    maxAge: "30d",
    immutable: true,
    fallthrough: true,
    setHeaders(res) {
      res.setHeader("Cache-Control", "public, max-age=2592000, immutable");
      res.setHeader("X-Content-Type-Options", "nosniff");
    },
  }),
);

function mapResponse(res, state) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("ETag", `\"map-${state.version}\"`);
  return res.json({
    ok: true,
    factoryMaps: state.factoryMaps || {},
    version: state.version,
    updatedAt: state.updatedAt,
  });
}

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "riems-company-street-view-api",
    health: "/health",
    mapData: "/api/map-data",
    storage: storageRoot,
  });
});

app.get("/health", async (_req, res, next) => {
  try {
    const database = await healthCheck();
    const state = await getMapState();
    res.json({
      ok: true,
      databaseTime: database.now,
      mapVersion: state?.version || null,
      storageRoot,
      maxUploadMb,
      multires: getMultiresQueueStatus(),
    });
  } catch (error) {
    next(error);
  }
});

app.get(["/api/map-data", "/data/streetview-data.json", "/streetview-data.json"], async (_req, res, next) => {
  try {
    const state = await getMapState();
    if (!state) return res.status(503).json({ ok: false, error: "Map data has not been initialized" });
    return mapResponse(res, state);
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/login", async (req, res, next) => {
  try {
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");
    if (!username || !password) return res.status(400).json({ ok: false, error: "Username and password are required" });

    const session = await login(username, password);
    if (!session) {
      return res.status(401).json({ ok: false, error: "Invalid username or password" });
    }
    setSessionCookie(res, session.token);
    return res.json({ ok: true, username: session.username, role: session.role, expiresAt: session.expiresAt });
  } catch (error) {
    next(error);
  }
});

app.get("/api/auth/session", async (req, res, next) => {
  try {
    const session = await readSession(req);
    if (!session) return res.status(401).json({ ok: false, error: "No active session" });
    return res.json({ ok: true, username: session.username, role: session.role, expiresAt: session.expires_at });
  } catch (error) {
    next(error);
  }
});

app.post("/api/usage/session/start", requireAuth, async (req, res, next) => {
  try {
    const sessionId = String(req.body?.sessionId || "").trim();
    const pagePath = String(req.body?.path || "").slice(0, 1000) || null;
    if (!sessionId || sessionId.length > 128) {
      return res.status(400).json({ ok: false, error: "Invalid usage session id" });
    }

    const row = await startUsageSession({
      sessionId,
      username: req.auth.username,
      role: req.auth.role,
      ipAddress: req.ip || null,
      userAgent: String(req.get("user-agent") || "").slice(0, 1000) || null,
      path: pagePath,
    });
    return res.json({ ok: true, session: row });
  } catch (error) {
    next(error);
  }
});

app.post("/api/usage/session/heartbeat", requireAuth, async (req, res, next) => {
  try {
    const sessionId = String(req.body?.sessionId || "").trim();
    const pagePath = String(req.body?.path || "").slice(0, 1000) || null;
    if (!sessionId || sessionId.length > 128) {
      return res.status(400).json({ ok: false, error: "Invalid usage session id" });
    }

    let row = await touchUsageSession(sessionId, pagePath);
    if (!row) {
      row = await startUsageSession({
        sessionId,
        username: req.auth.username,
        role: req.auth.role,
        ipAddress: req.ip || null,
        userAgent: String(req.get("user-agent") || "").slice(0, 1000) || null,
        path: pagePath,
      });
    }
    return res.json({ ok: true, session: row });
  } catch (error) {
    next(error);
  }
});

app.post("/api/usage/session/end", requireAuth, async (req, res, next) => {
  try {
    const sessionId = String(req.body?.sessionId || "").trim();
    if (!sessionId || sessionId.length > 128) {
      return res.status(400).json({ ok: false, error: "Invalid usage session id" });
    }

    await endUsageSession(sessionId);
    return res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/logout", async (req, res, next) => {
  try {
    const token = parseCookies(req.headers.cookie || "")[COOKIE_NAME];
    await logout(token);
    clearSessionCookie(res);
    return res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

async function saveMapHandler(req, res, next) {
  try {
    const body = req.body;
    const factoryMaps = body?.factoryMaps || body;
    if (!factoryMaps || typeof factoryMaps !== "object" || Array.isArray(factoryMaps)) {
      return res.status(400).json({ ok: false, error: "Invalid factoryMaps payload" });
    }
    const saved = await saveMapState(factoryMaps, req.auth.username);
    return res.json({ ok: true, factoryMaps, version: saved.version, updatedAt: saved.updatedAt, savedTo: "PostgreSQL" });
  } catch (error) {
    next(error);
  }
}

app.post(["/api/admin/save-mapdata", "/api/save-mapdata", "/save-mapdata"], requireAdmin, saveMapHandler);

async function uploadHandler(req, res, next) {
  try {
    const result = await processUpload(
      req.file,
      req.body?.kind || req.query?.kind || req.body?.type || req.query?.type,
      req.auth.username,
    );
    return res.json(result);
  } catch (error) {
    next(error);
  }
}

app.post(
  ["/api/admin/upload-asset", "/api/upload-asset", "/upload-asset"],
  requireAdmin,
  upload.single("file"),
  uploadHandler,
);

app.get("/api/admin/storage-summary", requireAdmin, async (_req, res, next) => {
  try {
    const summary = await storageSummary();
    res.json({
      ok: true,
      ...summary,
      storageRoot,
      multires: getMultiresQueueStatus(),
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/storage-assets", requireAdmin, async (req, res, next) => {
  try {
    const assets = await listAssets({
      includeDeleted: req.query?.includeDeleted === "true",
      kind: req.query?.kind || null,
      limit: req.query?.limit || 2000,
    });
    res.json({
      ok: true,
      assets: assets.map((asset) => {
        const resolvedPath = resolveAssetStoragePath(asset);
        return {
          ...asset,
          fileExists: Boolean(resolvedPath && fs.existsSync(resolvedPath)),
        };
      }),
      multires: getMultiresQueueStatus(),
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/multires/status", requireAdmin, async (_req, res) => {
  res.json({ ok: true, ...getMultiresQueueStatus() });
});

app.post("/api/admin/assets/:id/generate-multires", requireAdmin, async (req, res, next) => {
  try {
    const asset = await getAssetById(Number(req.params.id));
    if (!asset) return res.status(404).json({ ok: false, error: "Asset not found" });
    const result = await generateAssetMultires(asset, req.auth.username);
    return res.json({
      ok: true,
      asset: result.asset,
      multiRes: result.multiRes,
      scenesUpdated: result.scenesUpdated,
    });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/admin/assets/:id", requireAdmin, async (req, res, next) => {
  try {
    const asset = await getAssetById(Number(req.params.id));
    if (!asset) return res.status(404).json({ ok: false, error: "Asset not found" });
    const deleted = await deleteAssetFiles(asset, req.auth.username, "manual_asset_delete");
    return res.json({ ok: true, asset: deleted });
  } catch (error) {
    next(error);
  }
});

// This endpoint NEVER runs on a timer. It only deletes files when an admin
// explicitly presses the cleanup button and confirms the action.
app.post("/api/admin/storage-cleanup", requireAdmin, async (req, res, next) => {
  try {
    if (req.body?.confirm !== true) {
      return res.status(400).json({ ok: false, error: "Cleanup confirmation is required" });
    }
    const days = Math.max(0, Number(req.body?.days ?? 30));
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.map(Number).filter(Number.isFinite)
      : null;

    if (Array.isArray(ids) && ids.length === 0) {
      return res.status(400).json({ ok: false, error: "Select at least one old file to delete" });
    }

    const candidates = await getCleanupCandidates({ days, ids });
    const deleted = [];
    const failed = [];
    for (const asset of candidates) {
      try {
        const result = await deleteAssetFiles(
          asset,
          req.auth.username,
          `manual_cleanup_older_than_${days}_days`,
        );
        deleted.push(result.id);
      } catch (error) {
        failed.push({ id: asset.id, error: String(error?.message || error) });
      }
    }
    return res.json({ ok: true, days, requestedIds: ids, deleted, failed });
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error("[streetview] Request failed:", error);
  if (error?.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ ok: false, error: `Image exceeds the ${maxUploadMb} MB upload limit` });
  }
  return res.status(error.status || 500).json({ ok: false, error: error.message || "Internal server error" });
});

async function initialize() {
  if (!envBool("POSTGRES_ENABLED", true)) {
    throw new Error("POSTGRES_ENABLED must be true. This build uses PostgreSQL as the source of truth.");
  }
  ensureStorage();
  await migrate();
  await seedDefaultUsers();
  await purgeExpiredSessions();

  let current = await getMapState();
  if (!current && envBool("IMPORT_JSON_ON_START", true)) {
    if (!fs.existsSync(importPath)) throw new Error(`Initial map JSON not found: ${importPath}`);
    const payload = JSON.parse(fs.readFileSync(importPath, "utf8"));
    const factoryMaps = payload.factoryMaps || payload;
    await seedMapState(factoryMaps, "initial-json-import");
    console.log(`[streetview] Imported initial map data from ${importPath}`);
    current = await getMapState();
  }

  if (current?.factoryMaps) {
    const reconciled = await reconcileReferencedAssets(current.factoryMaps);
    console.log(
      `[streetview] Asset reconciliation: ${reconciled.registered} file(s) registered, ${reconciled.missing} referenced file(s) missing`,
    );
  }

  setInterval(() => {
    purgeExpiredSessions().catch((error) => console.warn("[streetview] Session cleanup failed:", error.message));
  }, 60 * 60 * 1000).unref();

  app.listen(port, host, () => {
    console.log(`[streetview] API listening on http://${host}:${port}`);
    console.log(`[streetview] Storage root: ${storageRoot}`);
    console.log(`[streetview] PostgreSQL schema: ${process.env.POSTGRES_SCHEMA || "map"}`);
    const multires = getMultiresAvailability();
    console.log(
      `[streetview] Multires generator: ${multires.available ? "available" : `unavailable (${multires.reason})`}`,
    );
  });
}

initialize().catch((error) => {
  console.error("[streetview] Startup failed:", error);
  process.exit(1);
});
