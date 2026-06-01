const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.STREETVIEW_SAVE_PORT || 3010);
const rootDir = process.cwd();
const publicDir = path.join(rootDir, "public");
const dataDir = path.join(publicDir, "data");
const uploadRoot = path.join(publicDir, "uploads");
const jsonOutputPath = path.join(dataDir, "streetview-data.json");

function send(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(data));
}

function readBody(req, limitBytes = 120 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > limitBytes) {
        reject(new Error("Payload too large"));
        req.destroy();
      }
    });

    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function safeName(name = "image") {
  const ext = path.extname(name).toLowerCase().replace(/[^.a-z0-9]/g, "") || ".jpg";
  const base = path
    .basename(name, ext)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "image";

  return { base, ext };
}

function extensionFromMime(mime = "image/jpeg", fallback = ".jpg") {
  if (mime.includes("png")) return ".png";
  if (mime.includes("webp")) return ".webp";
  if (mime.includes("gif")) return ".gif";
  if (mime.includes("jpeg") || mime.includes("jpg")) return ".jpg";
  return fallback || ".jpg";
}

function parseDataUrl(dataUrl) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s.exec(dataUrl || "");
  if (!match) return null;

  return {
    mime: match[1],
    buffer: Buffer.from(match[2], "base64"),
  };
}

function writeDataUrlImage({ dataUrl, filename = "image.jpg", kind = "panos" }) {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) {
    throw new Error("Invalid image data URL");
  }

  const cleanKind = kind === "maps" ? "maps" : "panos";
  const { base, ext } = safeName(filename);
  const finalExt = extensionFromMime(parsed.mime, ext);
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const hash = crypto.createHash("sha1").update(parsed.buffer).digest("hex").slice(0, 8);
  const fileName = `${base}-${stamp}-${hash}${finalExt}`;
  const folder = path.join(uploadRoot, cleanKind);
  const fullPath = path.join(folder, fileName);

  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(fullPath, parsed.buffer);

  return `/uploads/${cleanKind}/${fileName}`;
}

function sanitizeImages(value, context = { kind: "panos", name: "image.jpg" }) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeImages(item, context));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const next = {};

  for (const [key, raw] of Object.entries(value)) {
    if ((key === "panorama" || key === "mapImage") && typeof raw === "string" && raw.startsWith("data:image/")) {
      const kind = key === "mapImage" ? "maps" : "panos";
      const name = `${value.id || value.name || key}.jpg`;
      next[key] = writeDataUrlImage({ dataUrl: raw, filename: name, kind });
      continue;
    }

    next[key] = sanitizeImages(raw, {
      kind: key === "mapImage" ? "maps" : context.kind,
      name: value.id || value.name || context.name,
    });
  }

  return next;
}

function writeJson(factoryMaps) {
  fs.mkdirSync(dataDir, { recursive: true });

  const payload = {
    savedAt: new Date().toISOString(),
    factoryMaps,
  };

  fs.writeFileSync(jsonOutputPath, JSON.stringify(payload, null, 2), "utf8");
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      return send(res, 200, { ok: true });
    }

    if (req.method === "POST" && req.url === "/api/admin/upload-asset") {
      const payload = JSON.parse((await readBody(req)) || "{}");
      if (!payload.dataUrl || !payload.filename) {
        return send(res, 400, { ok: false, error: "filename and dataUrl are required" });
      }

      const publicPath = writeDataUrlImage({
        dataUrl: payload.dataUrl,
        filename: payload.filename,
        kind: payload.kind,
      });

      return send(res, 200, { ok: true, publicPath });
    }

    if (req.method === "POST" && req.url === "/api/admin/save-mapdata") {
      const payload = JSON.parse((await readBody(req)) || "{}");
      if (!payload.factoryMaps || typeof payload.factoryMaps !== "object") {
        return send(res, 400, { ok: false, error: "factoryMaps object is required" });
      }

      const sanitizedMaps = sanitizeImages(payload.factoryMaps);
      writeJson(sanitizedMaps);

      console.log(`[streetview-admin] Saved ${jsonOutputPath}`);
      return send(res, 200, {
        ok: true,
        savedTo: jsonOutputPath,
        factoryMaps: sanitizedMaps,
      });
    }

    if (req.method === "GET" && req.url === "/api/admin/health") {
      return send(res, 200, { ok: true });
    }

    return send(res, 404, { ok: false, error: "Not found" });
  } catch (error) {
    return send(res, 500, { ok: false, error: error.message });
  }
});

server.listen(PORT, () => {
  fs.mkdirSync(path.join(uploadRoot, "panos"), { recursive: true });
  fs.mkdirSync(path.join(uploadRoot, "maps"), { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });

  if (!fs.existsSync(jsonOutputPath)) {
    fs.writeFileSync(jsonOutputPath, JSON.stringify({ savedAt: null, factoryMaps: null }, null, 2), "utf8");
  }

  console.log(`[streetview-admin] Save server running on http://localhost:${PORT}`);
  console.log(`[streetview-admin] Data: ${jsonOutputPath}`);
  console.log(`[streetview-admin] Uploads: ${uploadRoot}`);
});
