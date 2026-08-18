const { Pool } = require("pg");

function envBool(name, fallback = false) {
  const value = process.env[name];
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function quoteIdent(value) {
  const name = String(value || "map");
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Invalid PostgreSQL identifier: ${name}`);
  }
  return `"${name}"`;
}

const schemaName = process.env.POSTGRES_SCHEMA || "map";
const schema = quoteIdent(schemaName);

const pool = new Pool({
  host: process.env.POSTGRES_HOST,
  port: Number(process.env.POSTGRES_PORT || 5432),
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  max: Number(process.env.POSTGRES_POOL_MAX || 10),
  idleTimeoutMillis: Number(process.env.POSTGRES_IDLE_TIMEOUT_MS || 30000),
  connectionTimeoutMillis: Number(process.env.POSTGRES_CONNECT_TIMEOUT_MS || 10000),
  ssl: envBool("POSTGRES_SSL", false) ? { rejectUnauthorized: envBool("POSTGRES_SSL_REJECT_UNAUTHORIZED", true) } : false,
  application_name: "riems-company-street-view",
});

pool.on("error", (error) => {
  console.error("[streetview][db] Unexpected pool error:", error);
});

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.map_state (
        id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        factory_maps JSONB NOT NULL DEFAULT '{}'::jsonb,
        version BIGINT NOT NULL DEFAULT 1,
        updated_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.map_assets (
        id BIGSERIAL PRIMARY KEY,
        kind TEXT NOT NULL,
        public_path TEXT NOT NULL UNIQUE,
        storage_path TEXT NOT NULL,
        original_name TEXT,
        mime_type TEXT,
        size_bytes BIGINT NOT NULL DEFAULT 0,
        sha256 TEXT,
        is_referenced BOOLEAN NOT NULL DEFAULT FALSE,
        unreferenced_at TIMESTAMPTZ,
        processing_status TEXT NOT NULL DEFAULT 'ready',
        processing_error TEXT,
        multires_config JSONB,
        multires_dir TEXT,
        multires_bytes BIGINT NOT NULL DEFAULT 0,
        created_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        deleted_by TEXT,
        deleted_reason TEXT
      )
    `);
    await client.query(`ALTER TABLE ${schema}.map_assets ADD COLUMN IF NOT EXISTS unreferenced_at TIMESTAMPTZ`);
    await client.query(`ALTER TABLE ${schema}.map_assets ADD COLUMN IF NOT EXISTS processing_status TEXT NOT NULL DEFAULT 'ready'`);
    await client.query(`ALTER TABLE ${schema}.map_assets ADD COLUMN IF NOT EXISTS processing_error TEXT`);
    await client.query(`ALTER TABLE ${schema}.map_assets ADD COLUMN IF NOT EXISTS multires_config JSONB`);
    await client.query(`ALTER TABLE ${schema}.map_assets ADD COLUMN IF NOT EXISTS multires_dir TEXT`);
    await client.query(`ALTER TABLE ${schema}.map_assets ADD COLUMN IF NOT EXISTS multires_bytes BIGINT NOT NULL DEFAULT 0`);
    await client.query(`ALTER TABLE ${schema}.map_assets ADD COLUMN IF NOT EXISTS deleted_by TEXT`);
    await client.query(`ALTER TABLE ${schema}.map_assets ADD COLUMN IF NOT EXISTS deleted_reason TEXT`);
    await client.query(`
      UPDATE ${schema}.map_assets
      SET processing_status = 'not_generated'
      WHERE kind = 'panos' AND multires_config IS NULL AND processing_status = 'ready'
    `);
    await client.query(`
      UPDATE ${schema}.map_assets
      SET processing_status = 'not_generated',
          processing_error = COALESCE(processing_error, 'Previous multires generation was interrupted')
      WHERE kind = 'panos' AND multires_config IS NULL AND processing_status = 'processing'
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS map_assets_kind_idx
      ON ${schema}.map_assets (kind, created_at DESC)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS map_assets_cleanup_idx
      ON ${schema}.map_assets (is_referenced, unreferenced_at)
      WHERE deleted_at IS NULL
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS map_assets_processing_idx
      ON ${schema}.map_assets (kind, processing_status)
      WHERE deleted_at IS NULL
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.map_users (
        username TEXT PRIMARY KEY,
        role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
        password_salt TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.map_sessions (
        token_hash TEXT PRIMARY KEY,
        username TEXT NOT NULL REFERENCES ${schema}.map_users(username) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS map_sessions_expiry_idx ON ${schema}.map_sessions (expires_at)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.map_usage_sessions (
        session_id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
        ip_address TEXT,
        user_agent TEXT,
        last_path TEXT,
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ended_at TIMESTAMPTZ
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS map_usage_started_idx
      ON ${schema}.map_usage_sessions (started_at DESC)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS map_usage_username_idx
      ON ${schema}.map_usage_sessions (username, started_at DESC)
    `);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function healthCheck() {
  const result = await pool.query("SELECT NOW() AS now");
  return result.rows[0];
}

module.exports = { pool, schema, schemaName, migrate, healthCheck, envBool };
