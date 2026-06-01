const { spawn } = require("child_process");

function start(name, command, args) {
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  child.on("exit", (code, signal) => {
    if (signal) return;
    if (code && code !== 0) {
      console.error(`[${name}] exited with code ${code}`);
    }
  });

  return child;
}

console.log("[streetview-admin] Starting save server + Vite app...");

const saveServer = start("save-server", "node", ["scripts/save-mapdata-server.cjs"]);
const viteCommand = process.platform === "win32" ? "npx.cmd" : "npx";
const vite = start("vite", viteCommand, ["vite", "--host", "0.0.0.0"]);

function shutdown() {
  console.log("\n[streetview-admin] Stopping...");
  saveServer.kill();
  vite.kill();
  process.exit();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
