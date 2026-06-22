# Docker usage with local upload volume

This setup runs the StreetView app in Docker and saves uploaded images locally on the host PC/server.

## Folder used for uploaded images

Create this folder on the host PC/server:

```bash
mkdir C:\StreetViewData\uploads
mkdir C:\StreetViewData\uploads\panos
mkdir C:\StreetViewData\uploads\thumbs
mkdir C:\StreetViewData\uploads\maps
```

The app inside Docker uses:

```text
/app/public/uploads
```

Docker will map it to the host folder:

```text
C:\StreetViewData\uploads
```

So uploaded files will be saved here:

```text
C:\StreetViewData\uploads\panos
C:\StreetViewData\uploads\thumbs
C:\StreetViewData\uploads\maps
```

## Build the image

```bash
docker build -t streetview-app .
```

## Run the container with local upload storage

```bash
docker run --name streetview-app -p 5055:5055 -p 3010:3010 -v "C:\StreetViewData\uploads:/app/public/uploads" streetview-app
```

## Open in browser

```text
http://SERVER_IP:5055
```

If running locally:

```text
http://localhost:5055
```

## To replace an existing container

```bash
docker rm -f streetview-app
docker run --name streetview-app -p 5055:5055 -p 3010:3010 -v "C:\StreetViewData\uploads:/app/public/uploads" streetview-app
```

## Important notes

```text
5055 = StreetView web app
3010 = save/upload server
```

Uploaded images are not saved inside GitHub when using this volume setup. They are saved locally on the host PC/server in:

```text
C:\StreetViewData\uploads
```

Do not delete this folder unless you want to remove the uploaded panoramas, thumbnails, and maps.

## If using Git LFS for existing images

Before building the Docker image, pull the LFS files:

```bash
git lfs install
git lfs pull
```

Then build:

```bash
docker build -t streetview-app .
```



# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is enabled on this template. See [this documentation](https://react.dev/learn/react-compiler) for more information.

Note: This will impact Vite dev & build performances.

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
