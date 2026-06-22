# Docker usage with local upload storage

## 1. Create the upload folders

Run this on the host PC/server:

```bash
mkdir C:\StreetViewData\uploads
mkdir C:\StreetViewData\uploads\panos
mkdir C:\StreetViewData\uploads\thumbs
mkdir C:\StreetViewData\uploads\maps
```

## 2. Build the Docker image

Run this inside the project folder:

```bash
docker build -t streetview-app .
```

## 3. Run the container

```bash
docker run --name streetview-app -p 5055:5055 -p 3010:3010 -v "C:\StreetViewData\uploads:/app/public/uploads" streetview-app
```

## 4. Open in browser

```text
http://SERVER_IP:5055
```

For local testing:

```text
http://localhost:5055
```

## 5. Replace an existing container

Use this when you already have an old `streetview-app` container:

```bash
docker rm -f streetview-app
docker run --name streetview-app -p 5055:5055 -p 3010:3010 -v "C:\StreetViewData\uploads:/app/public/uploads" streetview-app
```

## 6. If using Git LFS

Before building the Docker image, run:

```bash
git lfs install
git lfs pull
```

Then build the image:

```bash
docker build -t streetview-app .
```

---

# Notes

Port usage:

```text
5055 = StreetView web app
3010 = save/upload server
```

Upload storage:

```text
C:\StreetViewData\uploads
```

The app inside Docker uses this folder:

```text
/app/public/uploads
```

Docker connects them using this part of the run command:

```bash
-v "C:\StreetViewData\uploads:/app/public/uploads"
```

That means files uploaded through the admin page are saved on the host PC/server here:

```text
C:\StreetViewData\uploads\panos
C:\StreetViewData\uploads\thumbs
C:\StreetViewData\uploads\maps
```

Do not delete `C:\StreetViewData\uploads` unless you want to remove the saved panoramas, thumbnails, and maps.
