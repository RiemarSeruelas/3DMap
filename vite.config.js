import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const viteHost = process.env.VITE_HOST || "0.0.0.0";
const vitePort = Number(process.env.VITE_PORT || 5055);
const apiPort = Number(process.env.API_PORT || process.env.SAVE_PORT || 3010);
const apiTarget = `http://127.0.0.1:${apiPort}`;

export default defineConfig({
  plugins: [react()],
  server: {
    host: viteHost,
    port: vitePort,
    strictPort: true,
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true },
      "/uploads": { target: apiTarget, changeOrigin: true },
      "/data": { target: apiTarget, changeOrigin: true },
      "/streetview-data.json": { target: apiTarget, changeOrigin: true },
      "/health": { target: apiTarget, changeOrigin: true }
    }
  }
});
