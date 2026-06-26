import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const viteHost = process.env.VITE_HOST || "0.0.0.0";
const vitePort = Number(process.env.VITE_PORT || 5055);
const savePort = Number(process.env.SAVE_PORT || process.env.SAVE_SERVER_PORT || 3010);
const saveServerTarget = `http://127.0.0.1:${savePort}`;

const saveProxy = {
  target: saveServerTarget,
  changeOrigin: true,
};

export default defineConfig({
  plugins: [react()],
  server: {
    host: viteHost,
    port: vitePort,
    strictPort: true,
    proxy: {
      "/api/admin": saveProxy,
      "/api/save-mapdata": saveProxy,
      "/api/upload-asset": saveProxy,
      "/uploads": saveProxy,
      "/data": saveProxy,
      "/streetview-data.json": saveProxy,
      "/health": saveProxy,
    },
  },
});
