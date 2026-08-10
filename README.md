# Company Street View — PostgreSQL + Local Storage + Pannellum Multires

This build is designed for internal/on-premise hosting.

- PostgreSQL is the source of truth for map configuration and metadata.
- Actual image files stay inside this project under `public/uploads`.
- Nginx serves images and multires tiles directly.
- New 360 panoramas keep their original bytes and automatically generate Pannellum multires tiles when the generator is available.
- Existing panoramas can be converted from the Admin **Storage & Multires** page.
- Unused files are **never deleted automatically**. Cleanup only happens after an admin explicitly presses a delete / cleanup button and confirms it.
- No cloud storage or external runtime service is required.

## Architecture

```text
Internal users
    |
    v
Nginx
    |-- React application
    |-- /uploads/* -> project-local image / tile storage
    `-- /api/* -> Node / Express API
                      |-- PostgreSQL
                      `-- public/uploads
```

## What is stored where

### PostgreSQL

PostgreSQL stores:

- sites and parent areas
- panorama locations / scene IDs
- panorama names
- panorama image references
- multires configuration
- map coordinates
- panorama-to-panorama navigation links
- arrow positions
- Tour Mode data
- Safety Mode data
- machine / popup configuration
- users and sessions
- asset registry and processing status
- audit logs

The main map configuration is stored in `map.map_state.factory_maps` as JSONB.

### Project folder

Actual image bytes and generated panorama tiles are stored under:

```text
public/uploads/
├── panos/
├── thumbs/
├── maps/
├── machines/
└── safety-popups/
```

New panorama uploads use a structure similar to:

```text
public/uploads/panos/location-name-.../
├── original.jpg          # untouched uploaded source
└── tiles/                # generated Pannellum multires files
    ├── 1/
    ├── 2/
    ├── ...
    ├── fallback/
    └── config.json
```

The original panorama is not resized or recompressed.

## PostgreSQL tables

The API automatically creates / upgrades the configured schema when the database user has permission.

Main tables:

- `map.map_state`
- `map.map_assets`
- `map.map_users`
- `map.map_sessions`
- `map.map_audit_logs`

`map.map_assets` tracks original file size, generated multires size, referenced / unused state, multires processing state, and manual deletion audit information.

If the dedicated database user cannot create the schema, run `database/001_create_map_schema.sql` once as a PostgreSQL administrator after replacing `streetview_app` with the real application user.

## Configure `.env`

Copy:

```powershell
Copy-Item .env.example .env
```

Then fill in the real PostgreSQL credentials and application passwords.

No fixed `C:/RIEMS-Data/...` storage location is required. If `STREETVIEW_STORAGE_DIR` is not configured, local development uses this project's `public` folder automatically.

## Local development

Install packages:

```powershell
npm.cmd install
```

Start API + Vite:

```powershell
npm.cmd run dev
```

`npm.cmd start` is also available and starts the same local API + Vite workflow.

### Multires during Windows local development

The application still works if the multires generator is not installed locally. In that case:

1. the original 360 image is saved safely;
2. the scene temporarily remains equirectangular;
3. the asset appears as `unavailable` / `not generated` in **Storage & Multires**;
4. the tiles can be generated later from the Docker host.

To generate multires directly from `npm run dev` on Windows, install Python 3 and Hugin / `nona`, then configure the optional `MULTIRES_*` paths in `.env` if they are not already on PATH.

## Docker deployment

Build and start:

```powershell
docker compose up -d --build
```

Check:

```powershell
docker compose ps
docker compose logs --tail=200 streetview-api
docker compose logs --tail=100 streetview
```

The backend Docker image includes:

- Python 3
- Pillow
- NumPy
- Hugin `nona`
- the official Pannellum 2.5.7 `generate.py` utility

The Docker build downloads the official generator and normal npm / Docker dependencies. The running application does not need internet access after the required images have been built / cached.

## Automatic multires generation

For a new 360 upload:

```text
Admin uploads 360
      |
      v
Untouched original saved
      |
      v
Asset registered in PostgreSQL
      |
      v
Pannellum multires generation
      |
      +-- success -> scene uses multires tiles
      |
      `-- failure -> original remains safe and scene uses equirectangular
```

Generation is serialized through a queue to avoid multiple high-resolution conversions competing for CPU / memory at the same time.

Default settings:

```env
MULTIRES_ENABLED=true
MULTIRES_TILE_SIZE=512
MULTIRES_FALLBACK_SIZE=1024
MULTIRES_TILE_QUALITY=85
MULTIRES_TIMEOUT_MS=1200000
```

The original panorama remains available even after multires generation.

## Existing panoramas

Open:

```text
Admin -> Storage & Multires
```

Then use:

```text
Generate for Existing Panoramas
```

The server uses the existing original panorama files, generates tiles, and updates matching scenes in PostgreSQL to use multires. Re-uploading is not required.

At startup the API also reconciles `/uploads/...` references already stored in the map against the actual `public/uploads` folder. This registers older files in `map.map_assets` so they can be managed by the Storage page.

## Manual unused-file cleanup

When a scene, panorama, map, thumbnail, machine image, or popup image is replaced / removed, the old asset becomes **unreferenced**.

It is not immediately deleted.

The Admin **Storage & Multires** page shows:

- total storage
- original image storage
- generated tile storage
- unused asset count / size
- multires ready / pending counts
- unused-file age
- individual Preview / Delete controls

There is also a manual retention control, e.g.:

```text
Unused for at least: [30] days
[Delete Eligible]
```

**This is only a filter for the admin button. There is no timer and no automatic 30-day deletion.**

An admin must press the button and confirm the deletion. Every deletion is recorded in `map.map_audit_logs`.

A live referenced asset cannot be deleted through the cleanup API.

## Initial JSON migration

`migration/streetview-data.json` exists only as the initial database seed.

On first startup, when `map.map_state` is empty:

```text
migration/streetview-data.json
        -> PostgreSQL
```

Normal edits after that are saved to PostgreSQL, not back to the JSON file.

Manual import:

```powershell
docker compose exec streetview-api node scripts/import-json.cjs migration/streetview-data.json
```

## Persistent storage behavior

Docker bind-mounts:

```text
./public/uploads
```

into both the API and Nginx containers.

Therefore these normal commands do not delete uploaded images:

```powershell
docker compose restart
docker compose stop
docker compose down
docker compose up -d --build
```

Do not manually replace / delete the project folder without backing up `public/uploads`.

## Backups

A complete backup requires both:

1. PostgreSQL schema `map`
2. `public/uploads`

Example PostgreSQL backup:

```powershell
pg_dump -h YOUR_POSTGRES_SERVER -U YOUR_DEDICATED_APP_USER -d YOUR_DATABASE -n map -Fc -f streetview-map.backup
```

Example image / tile backup:

```powershell
robocopy ".\public\uploads" "E:\RIEMS-Backups\3D-Map\uploads" /MIR
```

## Performance behavior

- The viewer does not preload multiple connected full-resolution panoramas.
- Multires scenes request only the cube tiles needed for the current view / zoom level.
- Thumbnails remain lightweight.
- Nginx serves `/uploads/*` directly with long-lived immutable caching.
- PostgreSQL does not serve image bytes.
- Panorama originals are retained for future regeneration.

## Security notes

- Password verification occurs in the API.
- Passwords are stored as salted hashes.
- Admin write / upload / cleanup / generation routes require an HttpOnly admin session.
- Referenced assets cannot be deleted by the cleanup API.
- Keep the application on the intended internal network and do not expose the application port publicly.
- No panorama is uploaded to Pannellum or another external service; generation happens locally on the application host.

## Health check

```text
http://SERVER_IP:APP_PORT/health
```

The health response includes PostgreSQL status, current map version, storage root, upload limit, and multires generator / queue status.
