# StreetView 360 Factory Map

React/Vite StreetView app with an admin page for uploading 360 images, saving map/tour data, and viewing factory areas.

## Current Docker setup

The app runs on **port 5055**.

The save/upload server runs inside the same Docker container on **port 3010**, but the browser does not need to access 3010 directly. Vite proxies uploads, saved JSON, and uploaded images through port 5055.

Use only:

```text
http://SERVER_IP:5055
```

---

## Files related to Docker / save persistence

```text
Dockerfile
vite.config.js
scripts/dev-with-save.cjs
scripts/save-mapdata-server.cjs
src/utils/streetViewAdminStorage.js
src/pages/AdminAreaConfigPage.jsx
README_DOCKER.md
```

---

## Install dependencies

```powershell
npm install
```

---

## Run without Docker

```powershell
npm run dev
```

Open:

```text
http://localhost:5055
```

---

## Build Docker image

Run inside the project folder:

```powershell
cd "C:\Users\Riej\Downloads\3rd Project"
docker build -t streetview-app .
```

---

## Run Docker container

```powershell
docker rm -f streetview-app
docker run --name streetview-app -p 5055:5055 -v "${PWD}/public/uploads:/app/public/uploads" -v "${PWD}/public/data:/app/public/data" streetview-app
```

Open on the Docker PC:

```text
http://localhost:5055
```

Open from another PC:

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

---

## Test if the save/upload proxy works

Open:

```text
http://localhost:5055/health
```

or from another PC:

```text
http://SERVER_IP:5055/health
```

If you see JSON, the internal save server and Vite proxy are working.

---

## Where files are saved

Uploaded panoramas:

```text
public/uploads/panos
```

Generated thumbnails:

```text
public/uploads/thumbs
```

Map images:

```text
public/uploads/maps
```

Saved tour/map data:

```text
public/data/streetview-data.json
```

The Docker command mounts these folders so your files stay on the host PC even after rebuilding the container.

---

## Useful commands

Check running containers:

```powershell
docker ps
```

View logs:

```powershell
docker logs streetview-app
```

Stop/remove container:

```powershell
docker rm -f streetview-app
```

Rebuild after code changes:

```powershell
docker build -t streetview-app .
docker rm -f streetview-app
docker run --name streetview-app -p 5055:5055 -v "${PWD}/public/uploads:/app/public/uploads" -v "${PWD}/public/data:/app/public/data" streetview-app
```
