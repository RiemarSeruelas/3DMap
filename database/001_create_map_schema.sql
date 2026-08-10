-- Run this once as a PostgreSQL administrator when the dedicated app user
-- is not allowed to create its own schema.

CREATE SCHEMA IF NOT EXISTS map;

-- Replace streetview_app with your actual dedicated application user.
GRANT USAGE, CREATE ON SCHEMA map TO streetview_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA map TO streetview_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA map TO streetview_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA map
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO streetview_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA map
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO streetview_app;
