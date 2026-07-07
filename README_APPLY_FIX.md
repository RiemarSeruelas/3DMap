# Street View Machine Area Hotspots Fix

## Changed files

Replace these files in your project:

```txt
scripts/save-mapdata-server.cjs
scripts/dev-with-save.cjs
src/components/StreetViewer.jsx
src/pages/AdminAreaConfigPage.jsx
src/utils/streetViewAdminStorage.js
src/styles/machineMarkers.css
package.json
Dockerfile
vite.config.js
```

## What changed

- Admin can click **Mark Machine Area**.
- Admin marks **4 points** around a machine/door/window in the 360 image.
- Admin adds machine name, type, hazard, safety note, description, normal image, and open-door hover image.
- Viewer shows a highlighted machine area.
- Hovering the machine area shows the open-door image and details popup.
- Uploads now use `FormData`, not Base64 JSON.
- Backend compresses uploaded images using `sharp`.
- `/uploads` has browser cache headers.
- `npm run dev` spawn issue is fixed by launching Vite through Node directly instead of `npx`.

## Run without Docker

```powershell
npm install
npm run dev
```

Open:

```txt
http://localhost:5055
```

Health check:

```txt
http://localhost:5055/health
```

## Run with Docker

```powershell
docker build -t streetview-app .
docker rm -f streetview-app
docker run --name streetview-app -p 5055:5055 -v "${PWD}/public/uploads:/app/public/uploads" -v "${PWD}/public/data:/app/public/data" streetview-app
```
