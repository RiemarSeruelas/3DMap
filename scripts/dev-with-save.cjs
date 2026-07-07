#!/usr/bin/env node
const { spawn } = require("node:child_process");
const path = require("node:path");

function getArg(name, fallback) {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  const prefixed = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (prefixed) return prefixed.slice(name.length + 1);
  return fallback;
}

const rootDir = path.resolve(__dirname, "..");
const host = getArg("--host", process.env.VITE_HOST || "0.0.0.0");
const port = getArg("--port", process.env.VITE_PORT || "5055");

console.log("[streetview-admin] Starting save server + Vite app...");
console.log(`[streetview-admin] Vite host: ${host}`);
console.log(`[streetview-admin] Vite port: ${port}`);

const saveServer = spawn(process.execPath, [path.join(rootDir, "scripts", "save-mapdata-server.cjs")], {
  cwd: rootDir,
  stdio: "inherit",
  shell: false,
  env: {
    ...process.env,
    SAVE_HOST: process.env.SAVE_HOST || "127.0.0.1",
    SAVE_PORT: process.env.SAVE_PORT || "3010",
  },
});

const viteBin = path.join(rootDir, "node_modules", "vite", "bin", "vite.js");
const vite = spawn(process.execPath, [viteBin, "--host", host, "--port", String(port)], {
  cwd: rootDir,
  stdio: "inherit",
  shell: false,
  env: process.env,
});

function shutdown(code = 0) {
  if (!saveServer.killed) saveServer.kill("SIGTERM");
  if (!vite.killed) vite.kill("SIGTERM");
  process.exit(code);
}

saveServer.on("error", (error) => {
  console.error("[streetview-admin] Failed to start save server:", error);
  shutdown(1);
});

vite.on("error", (error) => {
  console.error("[streetview-admin] Failed to start Vite:", error);
  shutdown(1);
});

saveServer.on("exit", (code) => {
  if (code && code !== 0) {
    console.error(`[streetview-admin] Save server exited with code ${code}`);
    shutdown(code);
  }
});

vite.on("exit", (code) => {
  if (code && code !== 0) {
    console.error(`[streetview-admin] Vite exited with code ${code}`);
    shutdown(code);
  }
});

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
