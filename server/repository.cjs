const { pool, schema } = require("./db.cjs");

function collectUploadPaths(value, output = new Set()) {
  if (typeof value === "string") {
    if (value.startsWith("/uploads/")) output.add(value);
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectUploadPaths(item, output));
    return output;
  }
  if (value && typeof value === "object") {
    Object.values(value).forEach((item) => collectUploadPaths(item, output));
  }
  return output;
}

function normalizeAsset(row) {
  if (!row) return null;
  return {
    ...row,
    id: Number(row.id),
    size_bytes: Number(row.size_bytes || 0),
    multires_bytes: Number(row.multires_bytes || 0),
  };
}

async function getMapState(client = pool) {
  const result = await client.query(
    `SELECT factory_maps, version, updated_at FROM ${schema}.map_state WHERE id = 1`,
  );
  if (!result.rowCount) return null;
  return {
    factoryMaps: result.rows[0].factory_maps || {},
    version: Number(result.rows[0].version || 1),
    updatedAt: result.rows[0].updated_at,
  };
}

async function seedMapState(factoryMaps, username = "system-import") {
  const result = await pool.query(
    `INSERT INTO ${schema}.map_state (id, factory_maps, version, updated_by)
     VALUES (1, $1::jsonb, 1, $2)
     ON CONFLICT (id) DO NOTHING
     RETURNING version`,
    [JSON.stringify(factoryMaps || {}), username],
  );
  return result.rowCount > 0;
}

async function saveMapState(factoryMaps, username = "admin") {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO ${schema}.map_state (id, factory_maps, version, updated_by)
       VALUES (1, $1::jsonb, 1, $2)
       ON CONFLICT (id) DO UPDATE SET
         factory_maps = EXCLUDED.factory_maps,
         version = ${schema}.map_state.version + 1,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()
       RETURNING version, updated_at`,
      [JSON.stringify(factoryMaps || {}), username],
    );

    const references = [...collectUploadPaths(factoryMaps)];

    // Assets stop being "referenced" only when a map save no longer contains
    // their public path. The first time this happens we timestamp it. Nothing
    // is automatically deleted based on this timestamp.
    await client.query(
      `UPDATE ${schema}.map_assets
       SET is_referenced = FALSE,
           unreferenced_at = COALESCE(unreferenced_at, NOW())
       WHERE deleted_at IS NULL AND is_referenced = TRUE`,
    );

    if (references.length) {
      await client.query(
        `UPDATE ${schema}.map_assets
         SET is_referenced = TRUE,
             unreferenced_at = NULL
         WHERE public_path = ANY($1::text[]) AND deleted_at IS NULL`,
        [references],
      );
    }
    await client.query("COMMIT");
    return {
      version: Number(result.rows[0].version),
      updatedAt: result.rows[0].updated_at,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function recordAsset(asset) {
  const processingStatus =
    asset.processingStatus || (asset.kind === "panos" ? "not_generated" : "ready");
  const result = await pool.query(
    `INSERT INTO ${schema}.map_assets
      (kind, public_path, storage_path, original_name, mime_type, size_bytes, sha256,
       is_referenced, unreferenced_at, processing_status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,FALSE,NOW(),$8,$9)
     ON CONFLICT (public_path) DO UPDATE SET
       kind = EXCLUDED.kind,
       storage_path = EXCLUDED.storage_path,
       original_name = EXCLUDED.original_name,
       mime_type = EXCLUDED.mime_type,
       size_bytes = EXCLUDED.size_bytes,
       sha256 = COALESCE(EXCLUDED.sha256, ${schema}.map_assets.sha256),
       processing_status = CASE
         WHEN ${schema}.map_assets.multires_config IS NOT NULL THEN ${schema}.map_assets.processing_status
         ELSE EXCLUDED.processing_status
       END,
       deleted_at = NULL,
       deleted_by = NULL,
       deleted_reason = NULL
     RETURNING *`,
    [
      asset.kind,
      asset.publicPath,
      asset.storagePath,
      asset.originalName,
      asset.mimeType,
      asset.size,
      asset.sha256 || null,
      processingStatus,
      asset.username || null,
    ],
  );
  return normalizeAsset(result.rows[0]);
}

async function reconcileAsset(asset) {
  const result = await pool.query(
    `INSERT INTO ${schema}.map_assets
      (kind, public_path, storage_path, original_name, mime_type, size_bytes,
       is_referenced, unreferenced_at, processing_status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,TRUE,NULL,$7,$8)
     ON CONFLICT (public_path) DO UPDATE SET
       kind = EXCLUDED.kind,
       storage_path = EXCLUDED.storage_path,
       size_bytes = EXCLUDED.size_bytes,
       mime_type = COALESCE(EXCLUDED.mime_type, ${schema}.map_assets.mime_type),
       is_referenced = TRUE,
       unreferenced_at = NULL,
       deleted_at = NULL,
       deleted_by = NULL,
       deleted_reason = NULL
     RETURNING *`,
    [
      asset.kind,
      asset.publicPath,
      asset.storagePath,
      asset.originalName || null,
      asset.mimeType || null,
      asset.size || 0,
      asset.kind === "panos" ? "not_generated" : "ready",
      asset.username || "system-reconcile",
    ],
  );
  return normalizeAsset(result.rows[0]);
}

async function getAssetById(id) {
  const result = await pool.query(
    `SELECT * FROM ${schema}.map_assets WHERE id = $1`,
    [id],
  );
  return normalizeAsset(result.rows[0]);
}

async function getAssetByPath(publicPath) {
  const result = await pool.query(
    `SELECT * FROM ${schema}.map_assets WHERE public_path = $1`,
    [publicPath],
  );
  return normalizeAsset(result.rows[0]);
}

async function updateAssetMultires(
  id,
  { status, error = null, multiRes = null, multiresDir = null, multiresBytes = 0 },
) {
  const result = await pool.query(
    `UPDATE ${schema}.map_assets
     SET processing_status = $2,
         processing_error = $3,
         multires_config = $4::jsonb,
         multires_dir = $5,
         multires_bytes = $6
     WHERE id = $1
     RETURNING *`,
    [
      id,
      status,
      error,
      multiRes ? JSON.stringify(multiRes) : null,
      multiresDir,
      Number(multiresBytes || 0),
    ],
  );
  return normalizeAsset(result.rows[0]);
}

function updateSceneMultires(factoryMaps, publicPath, assetId, multiRes) {
  let updated = 0;
  const next = structuredClone(factoryMaps || {});

  Object.values(next).forEach((site) => {
    (site?.areas || []).forEach((area) => {
      const scenes = area?.tour?.scenes || {};
      Object.entries(scenes).forEach(([sceneId, scene]) => {
        if (!scene || scene.panorama !== publicPath) return;
        scenes[sceneId] = {
          ...scene,
          panoramaAssetId: assetId,
          panoramaType: multiRes ? "multires" : "equirectangular",
          multiRes: multiRes || undefined,
        };
        updated += 1;
      });
    });
  });

  return { factoryMaps: next, updated };
}

async function attachMultiresToMapAsset(publicPath, assetId, multiRes, username = "system") {
  const state = await getMapState();
  if (!state) return { updated: 0, state: null };
  const changed = updateSceneMultires(state.factoryMaps, publicPath, assetId, multiRes);
  if (!changed.updated) return { updated: 0, state };
  const saved = await saveMapState(changed.factoryMaps, username);  return { updated: changed.updated, state: saved };
}

async function listAssets({ includeDeleted = false, kind = null, limit = 1000 } = {}) {
  const params = [];
  const clauses = [];
  if (!includeDeleted) clauses.push("deleted_at IS NULL");
  if (kind) {
    params.push(kind);
    clauses.push(`kind = $${params.length}`);
  }
  params.push(Math.min(5000, Math.max(1, Number(limit || 1000))));
  const result = await pool.query(
    `SELECT *
     FROM ${schema}.map_assets
     ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
     ORDER BY
       CASE WHEN deleted_at IS NULL AND is_referenced = FALSE THEN 0 ELSE 1 END,
       COALESCE(unreferenced_at, created_at) DESC,
       id DESC
     LIMIT $${params.length}`,
    params,
  );
  return result.rows.map(normalizeAsset);
}

async function storageSummary() {
  const result = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE deleted_at IS NULL) AS file_count,
      COALESCE(SUM(size_bytes + multires_bytes) FILTER (WHERE deleted_at IS NULL), 0) AS total_bytes,
      COALESCE(SUM(size_bytes) FILTER (WHERE deleted_at IS NULL), 0) AS original_bytes,
      COALESCE(SUM(multires_bytes) FILTER (WHERE deleted_at IS NULL), 0) AS multires_bytes,
      COUNT(*) FILTER (WHERE deleted_at IS NULL AND is_referenced = FALSE) AS unreferenced_count,
      COALESCE(SUM(size_bytes + multires_bytes) FILTER (WHERE deleted_at IS NULL AND is_referenced = FALSE), 0) AS unreferenced_bytes,
      COUNT(*) FILTER (WHERE deleted_at IS NULL AND kind = 'panos' AND processing_status = 'ready') AS multires_ready_count,
      COUNT(*) FILTER (WHERE deleted_at IS NULL AND kind = 'panos' AND processing_status IN ('not_generated','failed','unavailable')) AS multires_pending_count,
      COUNT(*) FILTER (WHERE deleted_at IS NOT NULL) AS deleted_count
    FROM ${schema}.map_assets
  `);
  const row = result.rows[0] || {};
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, Number(value || 0)]),
  );
}

async function markAssetDeleted(id, username, reason = "manual_cleanup") {
  const result = await pool.query(
    `UPDATE ${schema}.map_assets
     SET deleted_at = NOW(),
         deleted_by = $2,
         deleted_reason = $3,
         is_referenced = FALSE
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING *`,
    [id, username || null, reason],
  );
  return normalizeAsset(result.rows[0]);
}

async function getCleanupCandidates({ days = 30, ids = null } = {}) {
  const params = [];
  const clauses = ["deleted_at IS NULL", "is_referenced = FALSE"];

  if (Array.isArray(ids) && ids.length) {
    params.push(ids.map(Number).filter(Number.isFinite));
    clauses.push(`id = ANY($${params.length}::bigint[])`);
  }

  if (days != null) {
    params.push(Math.max(0, Number(days || 0)));
    clauses.push(`COALESCE(unreferenced_at, created_at) <= NOW() - ($${params.length} * INTERVAL '1 day')`);
  }

  const result = await pool.query(
    `SELECT * FROM ${schema}.map_assets
     WHERE ${clauses.join(" AND ")}
     ORDER BY COALESCE(unreferenced_at, created_at) ASC`,
    params,
  );
  return result.rows.map(normalizeAsset);
}

async function startUsageSession({
  sessionId,
  username,
  role,
  ipAddress = null,
  userAgent = null,
  path = null,
}) {
  const result = await pool.query(
    `INSERT INTO ${schema}.map_usage_sessions
      (session_id, username, role, ip_address, user_agent, last_path)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (session_id) DO UPDATE SET
       username = EXCLUDED.username,
       role = EXCLUDED.role,
       ip_address = COALESCE(EXCLUDED.ip_address, ${schema}.map_usage_sessions.ip_address),
       user_agent = COALESCE(EXCLUDED.user_agent, ${schema}.map_usage_sessions.user_agent),
       last_path = COALESCE(EXCLUDED.last_path, ${schema}.map_usage_sessions.last_path),
       last_seen_at = NOW(),
       ended_at = NULL
     RETURNING *`,
    [sessionId, username, role, ipAddress, userAgent, path],
  );
  return result.rows[0] || null;
}

async function touchUsageSession(sessionId, path = null) {
  const result = await pool.query(
    `UPDATE ${schema}.map_usage_sessions
     SET last_seen_at = NOW(),
         last_path = COALESCE($2, last_path),
         ended_at = NULL
     WHERE session_id = $1
     RETURNING *`,
    [sessionId, path],
  );
  return result.rows[0] || null;
}

async function endUsageSession(sessionId) {
  const result = await pool.query(
    `UPDATE ${schema}.map_usage_sessions
     SET last_seen_at = NOW(),
         ended_at = COALESCE(ended_at, NOW())
     WHERE session_id = $1
     RETURNING *`,
    [sessionId],
  );
  return result.rows[0] || null;
}

module.exports = {
  collectUploadPaths,
  getMapState,
  seedMapState,
  saveMapState,
  recordAsset,
  reconcileAsset,
  getAssetById,
  getAssetByPath,
  updateAssetMultires,
  attachMultiresToMapAsset,
  listAssets,
  storageSummary,
  markAssetDeleted,
  getCleanupCandidates,
  startUsageSession,
  touchUsageSession,
  endUsageSession,
};
