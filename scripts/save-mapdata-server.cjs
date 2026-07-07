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

let sharp = null;
try {
  sharp = require("sharp");
} catch (err) {
  console.warn("[streetview-admin] Optional dependency sharp is missing. Upload compression is disabled.");
  console.warn("Run: npm install sharp");
}

const app = express();

const PORT = Number(process.env.SAVE_PORT || process.env.SAVE_SERVER_PORT || 3010);
const HOST = process.env.SAVE_HOST || process.env.SAVE_SERVER_HOST || "0.0.0.0";

const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const dataDir = process.env.STREETVIEW_DATA_DIR || path.join(publicDir, "data");
const uploadsDir = process.env.STREETVIEW_UPLOADS_DIR || path.join(publicDir, "uploads");
const dataFile = path.join(dataDir, "streetview-data.json");

const allowedUploadKinds = new Set(["panos", "thumbs", "maps", "machines"]);

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function ensureStorage() {
  ensureDir(dataDir);
  ensureDir(uploadsDir);
  ensureDir(path.join(uploadsDir, "panos"));
  ensureDir(path.join(uploadsDir, "thumbs"));
  ensureDir(path.join(uploadsDir, "maps"));
  ensureDir(path.join(uploadsDir, "machines"));

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

function uniqueFileName(originalName, forcedExt = null) {
  const safe = safeBaseName(originalName);
  const parsed = path.parse(safe);
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const id = crypto.randomBytes(4).toString("hex");
  const ext = forcedExt || parsed.ext || ".jpg";
  return `${parsed.name}-${stamp}-${id}${ext}`;
}

function getSafeKind(value) {
  const requested = String(value || "panos").toLowerCase();
  return allowedUploadKinds.has(requested) ? requested : "panos";
}

function publicPathFor(kind, filename) {
  return `/uploads/${kind}/${filename}`;
}

function getCompressionProfile(kind) {
  if (kind === "thumbs") return { maxWidth: 520, quality: 76, ext: ".jpg" };
  if (kind === "maps") return { maxWidth: 4096, quality: 84, ext: ".jpg" };
  if (kind === "machines") return { maxWidth: 1800, quality: 82, ext: ".jpg" };
  return { maxWidth: 8192, quality: 80, ext: ".jpg" };
}

async function compressImageBuffer(buffer, kind, mimetype = "") {
  if (!sharp || !mimetype.startsWith("image/")) {
    return { buffer, ext: null, compressed: false };
  }

  const profile = getCompressionProfile(kind);

  try {
    let pipeline = sharp(buffer, { limitInputPixels: false }).rotate();
    const metadata = await pipeline.metadata();

    if (metadata.width && metadata.width > profile.maxWidth) {
      pipeline = pipeline.resize({ width: profile.maxWidth, withoutEnlargement: true });
    }

    const output = await pipeline.jpeg({ quality: profile.quality, mozjpeg: true }).toBuffer();
    return { buffer: output, ext: profile.ext, compressed: true };
  } catch (err) {
    console.warn("[streetview-admin] Image compression failed. Saving original upload.", err.message);
    return { buffer, ext: null, compressed: false };
  }
}

async function saveBufferUpload({ filename, kind, buffer, mimetype }) {
  const safeKind = getSafeKind(kind);
  const targetDir = path.join(uploadsDir, safeKind);
  ensureDir(targetDir);

  const processed = await compressImageBuffer(buffer, safeKind, mimetype || "");
  const finalName = uniqueFileName(filename || "upload.jpg", processed.ext);
  const finalPath = path.join(targetDir, finalName);
  fs.writeFileSync(finalPath, processed.buffer);

  return {
    ok: true,
    kind: safeKind,
    filename: finalName,
    publicPath: publicPathFor(safeKind, finalName),
    path: publicPathFor(safeKind, finalName),
    url: publicPathFor(safeKind, finalName),
    size: fs.statSync(finalPath).size,
    originalName: filename || finalName,
    compressed: processed.compressed,
  };
}

async function saveDataUrlUpload({ filename, kind, dataUrl }) {
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

  return saveBufferUpload({
    filename: safeFilename,
    kind,
    buffer: Buffer.from(base64, "base64"),
    mimetype: mime,
  });
}

ensureStorage();

app.use(cors);
app.use(express.json({ limit: "500mb" }));
app.use(express.urlencoded({ extended: true, limit: "500mb" }));
app.use(
  "/uploads",
  express.static(uploadsDir, {
    maxAge: "30d",
    immutable: true,
    setHeaders(res) {
      res.setHeader("Cache-Control", "public, max-age=2592000, immutable");
    },
  })
);
app.use("/data", express.static(dataDir));

const upload = multer({
  storage: multer.memoryStorage(),
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
  res.json({ ok: true, dataFile, uploadsDir, sharpCompression: Boolean(sharp) });
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

async function handleUploadAsset(req, res) {
  try {
    ensureStorage();

    if (req.file) {
      const saved = await saveBufferUpload({
        filename: req.file.originalname,
        kind: req.body?.kind || req.query?.kind || req.body?.type || req.query?.type,
        buffer: req.file.buffer,
        mimetype: req.file.mimetype,
      });
      return res.json(saved);
    }

    if (req.body?.dataUrl) {
      const saved = await saveDataUrlUpload({
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
  console.log(`[streetview-admin] Sharp compression: ${sharp ? "enabled" : "disabled"}`);
});
