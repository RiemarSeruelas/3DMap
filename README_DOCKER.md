# Docker Usage — StreetView App on Port 5055

This setup runs the StreetView React/Vite app on **port 5055** only.

The save/upload server still runs inside the same container on port **3010**, but it is not exposed to other PCs. Vite proxies these paths through port 5055:

- `/api/admin/upload-asset`
- `/api/admin/save-mapdata`
- `/uploads/...`
- `/data/streetview-data.json`
- `/health`

So from the browser, you only use:

```text
http://SERVER_IP:5055
```

---

## Files changed for 5055 single-port Docker

Replace these files in your project:

```text
Dockerfile
vite.config.js
scripts/dev-with-save.cjs
src/utils/streetViewAdminStorage.js
src/pages/AdminAreaConfigPage.jsx
README_DOCKER.md
README.md
```

---

## Run locally on the Docker PC

Open PowerShell in the project folder:

```powershell
cd "C:\Users\Riej\Downloads\3rd Project"
```

Build the image:

```powershell
docker build -t streetview-app .
```

Remove the old container if it exists:

```powershell
docker rm -f streetview-app
```

Run the container using only port 5055:

```powershell
docker run --name streetview-app -p 5055:5055 -v "${PWD}/public/uploads:/app/public/uploads" -v "${PWD}/public/data:/app/public/data" streetview-app
```

Open:

```text
http://localhost:5055
```

---

## Open from another PC

Use the Docker PC/server IP:

```text
http://SERVER_IP:5055
```

Example:

```text
http://172.27.5.1:5055
```

---

## Windows Firewall

Run this on the Docker PC in Command Prompt as Administrator:

```cmd
netsh advfirewall firewall add rule name="StreetView App 5055" dir=in action=allow protocol=TCP localport=5055
```

No firewall rule is needed for 3010 because it is not exposed anymore.

---

## Test save/upload server through 5055

Open:

```text
http://localhost:5055/health
```

From another PC:

```text
http://SERVER_IP:5055/health
```

If that returns JSON, the proxy is working.

---

## Important volume notes

These two volumes keep your uploaded images and JSON data outside the container:

```powershell
-v "${PWD}/public/uploads:/app/public/uploads"
-v "${PWD}/public/data:/app/public/data"
```

Uploaded images are saved here on the host PC:

```text
public/uploads/panos
public/uploads/thumbs
public/uploads/maps
```

Map/tour data is saved here:

```text
public/data/streetview-data.json
```

Do not remove these volumes unless you want uploads/data to disappear when the container is rebuilt.
