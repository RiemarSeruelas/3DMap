# Company Street View

The Company Street View system provides an internal 360-degree navigation experience for plant areas. It allows authorized administrators to upload and configure panorama locations, connect one location to another, map each panorama to a floor or area map, and maintain Tour Mode and Safety Mode information.

The application stores map configuration in PostgreSQL and keeps the actual image files in the project `public/uploads` folder. High-resolution panoramas can be optimized into multiresolution tiles so users do not need to download an entire large 360 image at once.

## Who Should Use This System

- Employees using the Street View viewer to navigate plant areas
- Authorized administrators maintaining 360 locations
- Engineering or digital personnel responsible for map configuration
- System owners responsible for Docker, PostgreSQL, backups, and image storage

## Main Features

- 360-degree panorama viewer
- Multiple sites and plant areas
- Location search
- Configurable panorama names
- Replaceable 360 images
- Map positioning for each panorama
- Panorama-to-panorama navigation links
- Tour Mode configuration
- Safety Mode configuration
- Machine and safety popup configuration
- 360 image optimization for faster viewing
- Batch optimization for newly added or updated panoramas
- Old unused image review and manual cleanup
- PostgreSQL map configuration storage
- PostgreSQL asset, session, and audit tracking
- Local image storage under `public/uploads`
- Docker and Nginx deployment
- Admin and Viewer accounts

## System Areas

| Area | Purpose |
| --- | --- |
| **Viewer** | Navigate configured plant locations using 360 images and panorama links. |
| **Location Configuration** | Add, rename, replace, map, connect, edit, and delete panorama locations. |
| **Tour Mode** | Configure machine areas, interactive locations, and other Tour Mode information for a panorama. |
| **Safety Mode** | Configure safety-related areas, markers, and popups for a panorama. |
| **360 Image Maintenance** | Optimize newly added or replaced 360 images and review old unused image files. |
| **Map** | Position panorama locations on the correct site or area map. |

## How to Use the System

### 1. Sign In

Open the application and sign in using the authorized Admin or Viewer account.

Viewer access is intended for normal Street View navigation. Admin access provides the configuration tools.

### 2. Open a Site and Area

Select the required site and area, then open the Street View viewer or Location Configuration page.

### 3. Add a 360 Location

From Location Configuration, select **Add 360 Images** and upload the panorama file.

After upload:

1. Confirm that the new location appears in the uploaded-image list.
2. Select the new location.
3. Use **Edit Location** to change the location name if needed.
4. Map the location to the correct area.
5. Configure the locations that the panorama should connect to.
6. Optimize the new 360 image when the production optimization tool is available.

The original panorama file remains stored under `public/uploads/panos`.

### 4. Edit a Location

Select a panorama and choose **Edit Location**.

The Admin can:

- Change the location name
- Replace the 360 image
- Map the panorama to the site or area map
- Configure Map Locations / connected panoramas

Save the changes after editing.

### 5. Configure Tour Mode or Safety Mode

Use the Tour Mode / Safety Mode switch, then select **Edit Tour Mode** or **Edit Safety Mode**.

Changes are stored in PostgreSQL as part of the current map configuration.

### 6. Connect One Panorama to Another

Use **Map Locations** inside Edit Location to configure where a user should go when selecting a navigation point.

The destination relationship is stored in PostgreSQL. The actual panorama image remains stored in `public/uploads/panos`.

### 7. Optimize a 360 Image

After adding or replacing a panorama, open **360 Image Maintenance** from Location Configuration.

For a single location, select:

**Optimize This 360 Image**

For several newly added or updated panoramas, select:

**Optimize All New / Updated Images**

Optimization creates multiresolution image tiles. These allow the viewer to load smaller image sections instead of downloading the full panorama at once.

The original panorama is not deleted or replaced by the optimization process.

### 8. Review Old Unused Files

Open **Old Unused Files** inside 360 Image Maintenance.

Unused files are images that still exist in storage but are no longer referenced by the current map configuration, usually after replacing an image.

The system does not automatically delete unused files.

An Admin can:

- Select individual unused files
- Select all shown unused files
- Preview a file
- Delete one file
- Delete selected files

Delete files only after confirming that they are no longer required.

### 9. Sign Out

Admin users should sign out after completing configuration work, especially on shared computers.

## Important Rules

- PostgreSQL is the source of truth for the live map configuration.
- The application does not write normal map edits back to `streetview-data.json`.
- Actual panorama, thumbnail, map, machine, and safety images are stored as files under `public/uploads`.
- Do not manually rename or move files inside `public/uploads` after they have been registered by the system.
- Do not delete panorama folders manually while they are still referenced by the current map.
- Use the Admin interface to replace or delete images.
- Multiresolution optimization may create hundreds of small JPG tiles for one high-resolution panorama. This is normal.
- Higher multiresolution levels contain more tiles because they provide more detail.
- Do not stop or rebuild the backend while a large batch optimization is still running.
- Old unused files are never deleted automatically.
- Keep both the PostgreSQL data and the complete `public/uploads` folder in backups.

## Data Storage

### PostgreSQL

PostgreSQL stores the live application structure, including:

- Sites
- Areas
- Panorama locations
- Panorama names
- Panorama file references
- Map coordinates
- Connected / next panorama relationships
- Tour Mode configuration
- Safety Mode configuration
- Machine areas
- Safety popups
- Users and sessions
- Asset records
- Audit information
- Multiresolution status and configuration

The main live map structure is stored in the configured PostgreSQL schema, normally:

```text
map
```

### Image Files

Actual image files are stored inside the project:

```text
public/uploads/
├── machines/
├── maps/
├── panos/
├── safety-popups/
└── thumbs/
```

Optimized panoramas may contain folders similar to:

```text
public/uploads/panos/
└── panorama-folder/
    ├── original.jpg
    └── tiles/
        ├── 1/
        ├── 2/
        ├── 3/
        ├── 4/
        ├── fallback/
        └── config.json
```

The `original.jpg` remains the original uploaded panorama. The tile folders are generated files used for faster viewing.

### Migration JSON

The project may contain:

```text
migration/streetview-data.json
```

This is for initial migration or manual recovery. It is not the live runtime map database after PostgreSQL has been populated.

For production, after confirming the complete map exists in PostgreSQL, set:

```env
IMPORT_JSON_ON_START=false
```

## Reminders and Useful Facts

- A 10–15 MB panorama can take time to optimize because the server must convert it into cube faces and multiple tile levels.
- Batch optimization of many panoramas can take tens of minutes or longer depending on image resolution and server performance.
- Multiresolution optimization normally uses more disk space than the original image because multiple resolution levels are generated.
- Hundreds of generated JPG tiles for one panorama are normal.
- The application processes panorama optimization conservatively to avoid excessive CPU, RAM, and disk usage.
- Existing optimized panoramas do not need to be optimized again unless the panorama is replaced.
- If a panorama is replaced, the old file may appear under Old Unused Files until an Admin deletes it.
- Moving the application to another computer does not require hard-coded `C:\RIEMS-Data` paths. Image storage is relative to the project `public/uploads` folder.
- Database backups alone are not enough. Always back up `public/uploads` as well.
- Do not use `docker compose down -v` as a routine restart command.

## Running the System with Docker

This section is for the person responsible for hosting the Company Street View system.

### Requirements

- Docker Desktop or Docker Engine
- Access to the PostgreSQL database used by the application
- The complete project folder
- A configured `.env` file
- Enough local storage for original panoramas and generated multiresolution tiles

The PostgreSQL database must already exist. The application creates its required schema and tables automatically when the configured PostgreSQL user has sufficient permissions.

### Configure `.env`

Create or update `.env` in the main project folder:

```env
APP_PORT=5055
TZ=Asia/Manila

POSTGRES_ENABLED=true
POSTGRES_HOST=your_database_host
POSTGRES_PORT=5432
POSTGRES_DB=your_database_name
POSTGRES_USER=your_database_user
POSTGRES_PASSWORD=your_database_password
POSTGRES_SCHEMA=map

POSTGRES_POOL_MAX=10
POSTGRES_CONNECT_TIMEOUT_MS=10000
POSTGRES_SSL=false

IMPORT_JSON_ON_START=false
MAX_UPLOAD_MB=50

ADMIN_USERNAME=admin
ADMIN_PASSWORD=your_strong_admin_password

VIEWER_USERNAME=viewer
VIEWER_PASSWORD=your_strong_viewer_password

AUTH_SESSION_HOURS=12
AUTH_COOKIE_SECURE=false
```

Do not add the old machine-specific storage paths unless a future deployment intentionally requires a custom external storage directory.

The default deployment stores image files under the project `public/uploads` folder.

### Start the Application

Open PowerShell or Command Prompt in the project folder:

```powershell
docker compose up -d --build
```

### Check the Containers

```powershell
docker compose ps
```

The API and Nginx containers should show as running or healthy.

### Open the System

On the computer running Docker:

```text
http://localhost:5055
```

From another computer on the allowed internal network:

```text
http://SERVER_IP:5055
```

Replace `SERVER_IP` with the IP address of the Docker host.

The firewall and plant network must allow access to the configured application port.

### Check Application Health

```powershell
curl.exe http://localhost:5055/health
```

If the application does not respond, inspect the container status and logs.

### Start Again

```powershell
docker compose up -d
```

### Restart the Application

Avoid restarting while panorama optimization is actively running.

When no optimization is running:

```powershell
docker compose restart
```

### Rebuild After Receiving Updated Files

Wait for any active panorama optimization to finish first.

Then run:

```powershell
docker compose down
docker compose build --no-cache
docker compose up -d
```

### Stop the Application

```powershell
docker compose down
```

### Check Application Messages

```powershell
docker compose logs --tail=100
```

To follow new messages:

```powershell
docker compose logs -f
```

For API-specific messages:

```powershell
docker compose logs --tail=200 streetview-api
```

## Basic Troubleshooting

### The System Does Not Open

Check the containers:

```powershell
docker compose ps
```

Then check the logs:

```powershell
docker compose logs --tail=200
```

### PostgreSQL Connection Error

- Confirm the PostgreSQL server is running.
- Confirm the host, port, database, username, and password in `.env`.
- Confirm the configured user can access or create the `map` schema.
- Confirm the Docker host can reach the PostgreSQL server over the required network.
- Contact the database administrator if the connection still fails.

### A Panorama Does Not Display

Confirm that the file referenced by the map still exists under:

```text
public/uploads/panos
```

Do not manually rename panorama files or folders after upload.

If the original file is missing, use **Edit Location → Change 360 Image** to upload it again.

### Optimize 360 Image Fails

Confirm that:

- The original panorama exists under `public/uploads/panos`.
- The API container is running.
- The Docker image includes the multiresolution dependencies.
- The application logs do not show a generator error.

Check:

```powershell
docker compose logs --tail=200 streetview-api
```

If the original file exists but optimization fails, review the generator error in the logs before re-uploading the panorama.

### Optimization Takes a Long Time

This can be normal for high-resolution panoramas.

The server creates:

- Cube faces
- Several resolution levels
- Many individual JPG tiles

Large batches should be allowed to finish without restarting the API container.

### There Are Hundreds of JPG Files in a Panorama Folder

This is expected after multiresolution optimization.

Higher tile levels contain more JPG files because they provide higher visual detail.

Do not manually delete these tile files while the panorama is marked as optimized.

### Old Unused Files Appear

These are usually old panorama, thumbnail, map, machine, or popup files that are no longer referenced by the current map.

Review them in **360 Image Maintenance → Old Unused Files**.

Nothing is deleted automatically.

### The Database Has the Map but Images Are Missing

The PostgreSQL database and image files are separate.

Restoring only PostgreSQL does not restore the panorama images.

Restore the matching backup of:

```text
public/uploads
```

as well.

## Backup

A complete system backup requires both:

### 1. PostgreSQL

Back up the configured `map` schema / database according to the site's PostgreSQL backup procedure.

### 2. Image Storage

Back up the complete folder:

```text
public/uploads/
```

This includes original panoramas, optimized tiles, thumbnails, maps, machine images, and safety popup images.

Both backups are required for a complete restoration.

## Security

- Keep `.env` private.
- Do not commit `.env` to Git.
- Do not include production credentials in public ZIP files.
- Use strong Admin and Viewer passwords.
- Share Admin credentials only with authorized personnel.
- Do not expose PostgreSQL directly to untrusted networks.
- Keep the Street View system on the approved internal network.
- Do not expose plant images or internal map information to the public internet.
- Sign out after using Admin functions on a shared computer.
