#!/usr/bin/env node
const express = require("express");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

let multer;
try {
  multer = require("multer");
} catch (err) {
  console.error("[streetview-admin] Missing dependency: multer");
  console.error("Run: npm install multer");
  process.exit(1);
}

const app = express();

const PORT = Number(process.env.SAVE_PORT || process.env.SAVE_SERVER_PORT || 3010);
const HOST = process.env.SAVE_HOST || process.env.SAVE_SERVER_HOST || "0.0.0.0";

const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const dataDir = process.env.STREETVIEW_DATA_DIR || path.join(publicDir, "data");
const uploadsDir = process.env.STREETVIEW_UPLOADS_DIR || path.join(publicDir, "uploads");
const dataFile = path.join(dataDir, "streetview-data.json");

const allowedUploadKinds = new Set(["panos", "thumbs", "maps"]);

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function ensureStorage() {
  ensureDir(dataDir);
  ensureDir(uploadsDir);
  ensureDir(path.join(uploadsDir, "panos"));
  ensureDir(path.join(uploadsDir, "thumbs"));
  ensureDir(path.join(uploadsDir, "maps"));

  if (!fs.existsSync(dataFile)) {
    fs.writeFileSync(dataFile, JSON.stringify({ factoryMaps: {} }, null, 2), "utf8");
  }
}

function cors(req, res, next) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
}

function safeBaseName(name) {
  const parsed = path.parse(String(name || "upload"));
  const clean =
    parsed.name
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "upload";
  const ext = (parsed.ext || ".jpg").toLowerCase().replace(/[^a-z0-9.]/g, "") || ".jpg";
  return `${clean}${ext}`;
}

function uniqueFileName(originalName) {
  const safe = safeBaseName(originalName);
  const parsed = path.parse(safe);
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const id = crypto.randomBytes(4).toString("hex");
  return `${parsed.name}-${stamp}-${id}${parsed.ext}`;
}

function getSafeKind(value) {
  const requested = String(value || "panos").toLowerCase();
  return allowedUploadKinds.has(requested) ? requested : "panos";
}

function publicPathFor(kind, filename) {
  return `/uploads/${kind}/${filename}`;
}

function saveDataUrlUpload({ filename, kind, dataUrl }) {
  if (!dataUrl || typeof dataUrl !== "string") {
    throw new Error("Missing dataUrl");
  }

  const match = dataUrl.match(/^data:(.*?);base64,(.*)$/);
  if (!match) {
    throw new Error("Invalid dataUrl format");
  }

  const mime = match[1] || "image/jpeg";
  const base64 = match[2];

  let safeFilename = filename || "upload.jpg";
  if (!path.extname(safeFilename)) {
    if (mime.includes("png")) safeFilename += ".png";
    else if (mime.includes("webp")) safeFilename += ".webp";
    else safeFilename += ".jpg";
  }

  const safeKind = getSafeKind(kind);
  const targetDir = path.join(uploadsDir, safeKind);
  ensureDir(targetDir);

  const finalName = uniqueFileName(safeFilename);
  const finalPath = path.join(targetDir, finalName);
  fs.writeFileSync(finalPath, Buffer.from(base64, "base64"));

  return {
    ok: true,
    kind: safeKind,
    filename: finalName,
    publicPath: publicPathFor(safeKind, finalName),
    path: publicPathFor(safeKind, finalName),
    url: publicPathFor(safeKind, finalName),
    size: fs.statSync(finalPath).size,
    originalName: filename || safeFilename,
  };
}

ensureStorage();

app.use(cors);
app.use(express.json({ limit: "500mb" }));
app.use(express.urlencoded({ extended: true, limit: "500mb" }));
app.use("/uploads", express.static(uploadsDir));
app.use("/data", express.static(dataDir));

const upload = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) {
      const kind = getSafeKind(req.body?.kind || req.query?.kind || req.body?.type || req.query?.type);
      const targetDir = path.join(uploadsDir, kind);
      ensureDir(targetDir);
      req.savedUploadKind = kind;
      cb(null, targetDir);
    },
    filename(req, file, cb) {
      cb(null, uniqueFileName(file.originalname));
    },
  }),
  limits: { fileSize: 1024 * 1024 * 500 },
});

app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "streetview-admin-save-server",
    health: "/health",
    uploadRoutes: ["/upload-asset", "/api/upload-asset", "/api/admin/upload-asset"],
    saveRoutes: ["/save-mapdata", "/api/save-mapdata", "/api/admin/save-mapdata"],
  });
});

app.get("/health", (req, res) => {
  res.json({ ok: true, dataFile, uploadsDir });
});

app.get("/streetview-data.json", (req, res) => {
  res.sendFile(dataFile);
});

app.get("/data/streetview-data.json", (req, res) => {
  res.sendFile(dataFile);
});

function handleSaveMapData(req, res) {
  try {
    ensureStorage();

    const body = req.body;
    if (!body || typeof body !== "object") {
      return res.status(400).json({ ok: false, error: "Invalid JSON body" });
    }

    const tmpFile = `${dataFile}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(body, null, 2), "utf8");
    fs.renameSync(tmpFile, dataFile);

    return res.json({
      ok: true,
      file: dataFile,
      savedTo: dataFile,
      factoryMaps: body.factoryMaps || body,
    });
  } catch (err) {
    console.error("[streetview-admin] save-mapdata failed:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

function handleUploadAsset(req, res) {
  try {
    ensureStorage();

    if (req.file) {
      const kind = req.savedUploadKind || "panos";
      const publicPath = publicPathFor(kind, req.file.filename);
      return res.json({
        ok: true,
        kind,
        filename: req.file.filename,
        publicPath,
        path: publicPath,
        url: publicPath,
        size: req.file.size,
        originalName: req.file.originalname,
      });
    }

    if (req.body?.dataUrl) {
      const saved = saveDataUrlUpload({
        filename: req.body.filename,
        kind: req.body.kind || req.body.type,
        dataUrl: req.body.dataUrl,
      });
      return res.json(saved);
    }

    return res.status(400).json({ ok: false, error: "No file or dataUrl uploaded" });
  } catch (err) {
    console.error("[streetview-admin] upload-asset failed:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

app.post("/save-mapdata", handleSaveMapData);
app.post("/api/save-mapdata", handleSaveMapData);
app.post("/api/admin/save-mapdata", handleSaveMapData);

app.post("/upload-asset", upload.single("file"), handleUploadAsset);
app.post("/api/upload-asset", upload.single("file"), handleUploadAsset);
app.post("/api/admin/upload-asset", upload.single("file"), handleUploadAsset);

app.listen(PORT, HOST, () => {
  console.log(`[streetview-admin] Save server running on http://${HOST}:${PORT}`);
  console.log(`[streetview-admin] Data: ${dataFile}`);
  console.log(`[streetview-admin] Uploads: ${uploadsDir}`);
});
