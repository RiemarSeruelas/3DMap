#!/usr/bin/env node
require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const { migrate, pool } = require("../server/db.cjs");
const { saveMapState } = require("../server/repository.cjs");

async function main() {
  const file = path.resolve(process.argv[2] || process.env.IMPORT_JSON_PATH || "migration/streetview-data.json");
  if (!fs.existsSync(file)) throw new Error(`JSON file not found: ${file}`);
  const payload = JSON.parse(fs.readFileSync(file, "utf8"));
  await migrate();
  const saved = await saveMapState(payload.factoryMaps || payload, "manual-json-import");
  console.log(`Imported ${file} into PostgreSQL. Map version: ${saved.version}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => pool.end());
