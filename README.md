# Docker usage

Build the image:

```bash
docker build -t streetview-app .
```

Run the container:

```bash
docker run -p 5055:5055 -p 3010:3010 --name streetview-app streetview-app
```

Open in browser:

```text
http://SERVER_IP:5055
```

To replace an existing container:

```bash
docker rm -f streetview-app
docker run -p 5055:5055 -p 3010:3010 --name streetview-app streetview-app
```

If running locally, open:

```text
http://localhost:5055
```

Notes:

```text
5055 = StreetView web app
3010 = save/upload server
```

Make sure Git LFS files are downloaded before building:

```bash
git lfs install
git lfs pull
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
