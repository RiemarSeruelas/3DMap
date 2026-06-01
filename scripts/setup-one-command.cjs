const fs = require("fs");
const path = require("path");

const packagePath = path.join(process.cwd(), "package.json");

if (!fs.existsSync(packagePath)) {
  console.error("package.json not found. Run this from your project root.");
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
pkg.scripts = pkg.scripts || {};

if (pkg.scripts.dev && pkg.scripts.dev !== "node scripts/dev-with-save.cjs") {
  pkg.scripts["dev:old"] = pkg.scripts["dev:old"] || pkg.scripts.dev;
}

pkg.scripts.dev = "node scripts/dev-with-save.cjs";
pkg.scripts["dev:vite"] = pkg.scripts["dev:vite"] || "vite --host 0.0.0.0";
pkg.scripts["dev:save"] = "node scripts/save-mapdata-server.cjs";

fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
console.log("Updated package.json scripts:");
console.log("  npm run dev       -> starts Vite + JS save server");
console.log("  npm run dev:vite  -> starts Vite only");
console.log("  npm run dev:save  -> starts save server only");
if (pkg.scripts["dev:old"]) console.log("  npm run dev:old   -> your old dev command");
