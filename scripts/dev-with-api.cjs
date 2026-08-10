#!/usr/bin/env node
const { spawn } = require("node:child_process");
const path = require("node:path");

function getArg(name, fallback) {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  const prefixed = process.argv.find((arg) => arg.startsWith(`${name}=`));
  return prefixed ? prefixed.slice(name.length + 1) : fallback;
}

const rootDir = path.resolve(__dirname, "..");
const host = getArg("--host", process.env.VITE_HOST || "0.0.0.0");
const port = getArg("--port", process.env.VITE_PORT || "5055");
const apiPort = process.env.API_PORT || process.env.SAVE_PORT || "3010";

console.log("[streetview] Starting PostgreSQL API + Vite app...");
const api = spawn(process.execPath, [path.join(rootDir, "server", "index.cjs")], {
  cwd: rootDir,
  stdio: "inherit",
  shell: false,
  env: { ...process.env, API_HOST: process.env.API_HOST || "127.0.0.1", API_PORT: apiPort },
});
const vite = spawn(process.execPath, [path.join(rootDir, "node_modules", "vite", "bin", "vite.js"), "--host", host, "--port", String(port)], {
  cwd: rootDir,
  stdio: "inherit",
  shell: false,
  env: process.env,
});

function shutdown(code = 0) {
  if (!api.killed) api.kill("SIGTERM");
  if (!vite.killed) vite.kill("SIGTERM");
  process.exit(code);
}
api.on("error", (error) => { console.error("[streetview] API failed:", error); shutdown(1); });
vite.on("error", (error) => { console.error("[streetview] Vite failed:", error); shutdown(1); });
api.on("exit", (code) => { if (code) shutdown(code); });
vite.on("exit", (code) => { if (code) shutdown(code); });
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
