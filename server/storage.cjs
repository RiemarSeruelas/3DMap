const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const multer = require("multer");
const sharp = require("sharp");
const {
  collectUploadPaths,
  recordAsset,
  reconcileAsset,
  getAssetById,
  updateAssetMultires,
  attachMultiresToMapAsset,
  markAssetDeleted,
} = require("./repository.cjs");
const {
  generateMultires,
  getMultiresAvailability,
} = require("./multires.cjs");

const storageRoot = path.resolve(
  process.env.STREETVIEW_STORAGE_DIR || path.join(process.cwd(), "public"),
);
const tempDir = path.resolve(
  process.env.STREETVIEW_TEMP_DIR || path.join(os.tmpdir(), "riems-streetview"),
);
const uploadsDir = path.join(storageRoot, "uploads");
const allowedKinds = new Set([
  "panos",
  "thumbs",
  "maps",
  "machines",
  "safety-popups",
]);
const allowedImageMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const maxUploadMb = Number(process.env.MAX_UPLOAD_MB || 50);

function ensureStorage() {
  fs.mkdirSync(tempDir, { recursive: true });
  for (const kind of allowedKinds) {
    fs.mkdirSync(path.join(uploadsDir, kind), { recursive: true });
  }
}

function safeKind(value) {
  const kind = String(value || "panos").toLowerCase();
  return allowedKinds.has(kind) ? kind : "panos";
}

function safeName(value) {
  const parsed = path.parse(String(value || "upload.jpg"));
  return (
    parsed.name
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "upload"
  );
}

function extensionForFile(file) {
  const originalExtension = path
    .extname(String(file?.originalname || ""))
    .toLowerCase();

  if ([".jpg", ".jpeg", ".png", ".webp"].includes(originalExtension)) {
    return originalExtension;
  }

  if (file?.mimetype === "image/png") return ".png";
  if (file?.mimetype === "image/webp") return ".webp";
  return ".jpg";
}

function uniqueStem(originalName) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `${safeName(originalName)}-${stamp}-${crypto.randomBytes(4).toString("hex")}`;
}

function uniqueName(originalName, extension = ".jpg") {
  return `${uniqueStem(originalName)}${extension}`;
}

function profile(kind) {
  if (kind === "thumbs") return { maxWidth: 520, quality: 76 };
  if (kind === "maps") {
    return {
      maxWidth: Number(process.env.MAP_MAX_WIDTH || 4096),
      quality: 84,
    };
  }
  if (kind === "machines" || kind === "safety-popups") {
    return {
      maxWidth: Number(process.env.MACHINE_MAX_WIDTH || 1800),
      quality: 82,
    };
  }
  return null;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, tempDir),
    filename: (_req, file, callback) =>
      callback(
        null,
        `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${extensionForFile(file)}`,
      ),
  }),
  limits: { fileSize: maxUploadMb * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!allowedImageMimeTypes.has(String(file.mimetype || "").toLowerCase())) {
      return callback(
        new Error("Only JPEG, PNG, and WebP image uploads are allowed"),
      );
    }
    callback(null, true);
  },
});

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", resolve);
    stream.on("error", reject);
  });
  return hash.digest("hex");
}

async function moveFilePreservingBytes(sourcePath, targetPath) {
  try {
    await fsp.rename(sourcePath, targetPath);
  } catch (error) {
    if (error?.code !== "EXDEV") throw error;
    await fsp.copyFile(sourcePath, targetPath);
    await fsp.rm(sourcePath, { force: true });
  }
}

async function processPanoramaUpload(file, targetDir) {
  // Each new panorama gets its own folder so the untouched source and generated
  // multires tiles can be backed up / removed together.
  const extension = extensionForFile(file);
  const folderName = uniqueStem(file.originalname);
  const panoramaDir = path.join(targetDir, folderName);
  await fsp.mkdir(panoramaDir, { recursive: true });
  const outputName = `original${extension}`;
  const outputPath = path.join(panoramaDir, outputName);

  try {
    await moveFilePreservingBytes(file.path, outputPath);
  } catch (error) {
    await fsp.rm(panoramaDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }

  return {
    outputName,
    outputPath,
    folderName,
    mimeType: file.mimetype || "application/octet-stream",
    compressed: false,
    preservedOriginal: true,
  };
}

async function processOptimizedUpload(file, kind, targetDir) {
  const outputName = uniqueName(file.originalname, ".jpg");
  const outputPath = path.join(targetDir, outputName);
  const config = profile(kind);

  try {
    let image = sharp(file.path, { limitInputPixels: false }).rotate();
    const metadata = await image.metadata();

    if (metadata.width && metadata.width > config.maxWidth) {
      image = image.resize({
        width: config.maxWidth,
        withoutEnlargement: true,
      });
    }

    await image
      .jpeg({ quality: config.quality, mozjpeg: true })
      .toFile(outputPath);
  } finally {
    await fsp.rm(file.path, { force: true });
  }

  return {
    outputName,
    outputPath,
    mimeType: "image/jpeg",
    compressed: true,
    preservedOriginal: false,
  };
}

function getMultiresPaths(asset, resolvedSourcePath = null) {
  const sourcePath = path.resolve(resolvedSourcePath || asset.storage_path);
  const ext = path.extname(sourcePath);
  const basename = path.basename(sourcePath, ext);
  const parent = path.dirname(sourcePath);
  const publicExt = path.extname(asset.public_path || "");
  const publicName = path.basename(asset.public_path || "", publicExt);
  const publicParent = path.posix.dirname(asset.public_path || "");

  const isFolderLayout = /^original\./i.test(path.basename(sourcePath));
  if (isFolderLayout) {
    return {
      outputDir: path.join(parent, "tiles"),
      publicBasePath: `${path.posix.dirname(asset.public_path)}/tiles`,
    };
  }

  // Legacy flat panoramas keep their existing public URL. Generated tiles are
  // placed in a sibling directory so no existing links are broken.
  return {
    outputDir: path.join(parent, `${basename}.multires`),
    publicBasePath: `${publicParent}/${publicName}.multires`,
  };
}

async function generateAssetMultires(assetOrId, username = "admin") {
  let asset =
    typeof assetOrId === "object" && assetOrId
      ? assetOrId
      : await getAssetById(assetOrId);
  if (!asset) throw Object.assign(new Error("Asset not found"), { status: 404 });
  if (asset.kind !== "panos") {
    throw Object.assign(new Error("Multires can only be generated for panorama assets"), {
      status: 400,
    });
  }
  if (asset.deleted_at) {
    throw Object.assign(new Error("Cannot generate multires for a deleted asset"), {
      status: 409,
    });
  }

  // Repair stale absolute paths left by an older installation. The portable
  // public path identifies the same file under the current project's uploads
  // folder, so the DB row is refreshed as soon as the asset is used.
  const canonicalPath = publicPathToStoragePath(asset.public_path);
  if (
    canonicalPath &&
    fs.existsSync(canonicalPath) &&
    path.resolve(asset.storage_path || "") !== path.resolve(canonicalPath)
  ) {
    const stats = await fsp.stat(canonicalPath);
    asset = await reconcileAsset({
      kind: asset.kind,
      publicPath: asset.public_path,
      storagePath: canonicalPath,
      originalName: asset.original_name || path.basename(canonicalPath),
      mimeType: asset.mime_type || mimeFromPath(canonicalPath),
      size: stats.size,
      username: "system-path-repair",
    });
  }

  const sourcePath = resolveAssetStoragePath(asset);
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    const expected = publicPathToStoragePath(asset.public_path);
    const message = expected
      ? `Original panorama file is missing from public/uploads: ${asset.public_path}`
      : "Original panorama file is missing from public/uploads";
    await updateAssetMultires(asset.id, {
      status: "failed",
      error: message,
    });
    throw Object.assign(new Error(message), {
      status: 404,
    });
  }

  const paths = getMultiresPaths(asset, sourcePath);
  await updateAssetMultires(asset.id, {
    status: "processing",
    error: null,
    multiRes: null,
    multiresDir: paths.outputDir,
    multiresBytes: 0,
  });

  try {
    const generated = await generateMultires({
      inputPath: sourcePath,
      outputDir: paths.outputDir,
      publicBasePath: paths.publicBasePath,
    });
    const updated = await updateAssetMultires(asset.id, {
      status: "ready",
      error: null,
      multiRes: generated.multiRes,
      multiresDir: generated.outputDir,
      multiresBytes: generated.bytes,
    });
    const attached = await attachMultiresToMapAsset(
      asset.public_path,
      asset.id,
      generated.multiRes,
      username,
    );
    return { asset: updated, multiRes: generated.multiRes, scenesUpdated: attached.updated };
  } catch (error) {
    const unavailable = error?.code === "MULTIRES_UNAVAILABLE";
    const status = unavailable ? "unavailable" : "failed";
    await fsp.rm(paths.outputDir, { recursive: true, force: true }).catch(() => {});
    await updateAssetMultires(asset.id, {
      status,
      error: String(error?.message || error).slice(0, 4000),
      multiRes: null,
      multiresDir: null,
      multiresBytes: 0,
    });
    error.multiresStatus = status;
    throw error;
  }
}

async function processUpload(file, kind, username) {
  if (!file?.path) throw new Error("No uploaded file received");

  const cleanKind = safeKind(kind);
  const targetDir = path.join(uploadsDir, cleanKind);
  await fsp.mkdir(targetDir, { recursive: true });

  let processed;
  try {
    processed =
      cleanKind === "panos"
        ? await processPanoramaUpload(file, targetDir)
        : await processOptimizedUpload(file, cleanKind, targetDir);
  } catch (error) {
    await fsp.rm(file.path, { force: true }).catch(() => {});
    throw error;
  }

  const stats = await fsp.stat(processed.outputPath);
  const publicPath =
    cleanKind === "panos"
      ? `/uploads/panos/${processed.folderName}/${processed.outputName}`
      : `/uploads/${cleanKind}/${processed.outputName}`;
  const checksum = await sha256File(processed.outputPath);

  const asset = await recordAsset({
    kind: cleanKind,
    publicPath,
    storagePath: processed.outputPath,
    originalName: file.originalname,
    mimeType: processed.mimeType,
    size: stats.size,
    sha256: checksum,
    username,
    // Panorama optimization is intentionally manual. This keeps uploads fast
    // and gives future admins one clear workflow: upload / replace the image,
    // then click "Optimize 360 Image" in Location Configuration.
    processingStatus: cleanKind === "panos" ? "not_generated" : "ready",
  });

  const multiRes = null;
  const multiresStatus = cleanKind === "panos" ? "not_generated" : undefined;
  const multiresError = null;

  return {
    ok: true,
    assetId: asset.id,
    kind: cleanKind,
    filename: processed.outputName,
    publicPath,
    path: publicPath,
    url: publicPath,
    size: stats.size,
    originalName: file.originalname,
    compressed: processed.compressed,
    preservedOriginal: processed.preservedOriginal,
    sha256: checksum,
    panoramaType: multiRes ? "multires" : cleanKind === "panos" ? "equirectangular" : undefined,
    multiRes,
    multiresStatus: cleanKind === "panos" ? multiresStatus : undefined,
    multiresError: cleanKind === "panos" ? multiresError : undefined,
  };
}

function mimeFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  return null;
}

function publicPathToStoragePath(publicPath) {
  if (!String(publicPath || "").startsWith("/uploads/")) return null;
  const relative = String(publicPath).slice("/uploads/".length).split("/");
  if (!relative.length || !allowedKinds.has(relative[0])) return null;
  const candidate = path.resolve(uploadsDir, ...relative);
  const relativeToRoot = path.relative(uploadsDir, candidate);
  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) return null;
  return candidate;
}

function resolveAssetStoragePath(asset) {
  // The public /uploads/... path is portable across machines and Docker hosts.
  // Prefer it over the absolute storage_path saved in PostgreSQL, because an
  // older DB row may still point to a previous machine such as C:/RIEMS-Data.
  const canonical = publicPathToStoragePath(asset?.public_path);
  if (canonical && fs.existsSync(canonical)) return canonical;

  const stored = asset?.storage_path ? path.resolve(asset.storage_path) : null;
  if (stored && fs.existsSync(stored)) return stored;

  // Return the canonical project-local location for a useful missing-file
  // check / message even when neither candidate currently exists.
  return canonical || stored || null;
}

function collectScenePanoramaMetadata(factoryMaps) {
  const output = new Map();
  Object.values(factoryMaps || {}).forEach((site) => {
    (site?.areas || []).forEach((area) => {
      Object.values(area?.tour?.scenes || {}).forEach((scene) => {
        if (!scene?.panorama) return;
        output.set(scene.panorama, {
          assetId: scene.panoramaAssetId || null,
          multiRes: scene.multiRes || null,
        });
      });
    });
  });
  return output;
}

async function reconcileReferencedAssets(factoryMaps) {
  const references = [...collectUploadPaths(factoryMaps)];
  const scenePanoramas = collectScenePanoramaMetadata(factoryMaps);
  let registered = 0;
  let missing = 0;

  for (const publicPath of references) {
    const storagePath = publicPathToStoragePath(publicPath);
    if (!storagePath) continue;
    let stats;
    try {
      stats = await fsp.stat(storagePath);
    } catch {
      missing += 1;
      continue;
    }
    if (!stats.isFile()) continue;

    const relative = publicPath.slice("/uploads/".length).split("/");
    let kind = relative[0];
    // Older builds accidentally routed unknown image kinds into /uploads/panos.
    // Only a path actually used as scene.panorama should be treated as a 360
    // panorama and offered to the multires generator.
    if (kind === "panos" && !scenePanoramas.has(publicPath)) {
      kind = "legacy-image";
    }
    const asset = await reconcileAsset({
      kind,
      publicPath,
      storagePath,
      originalName: path.basename(storagePath),
      mimeType: mimeFromPath(storagePath),
      size: stats.size,
      username: "system-reconcile",
    });
    registered += 1;

    const existingMultires = scenePanoramas.get(publicPath);
    if (kind === "panos" && existingMultires?.multiRes) {
      const paths = getMultiresPaths(asset);
      let bytes = 0;
      try {
        if (fs.existsSync(paths.outputDir)) {
          const stack = [paths.outputDir];
          while (stack.length) {
            const current = stack.pop();
            for (const entry of await fsp.readdir(current, { withFileTypes: true })) {
              const full = path.join(current, entry.name);
              if (entry.isDirectory()) stack.push(full);
              else if (entry.isFile()) bytes += (await fsp.stat(full)).size;
            }
          }
        }
      } catch {}
      await updateAssetMultires(asset.id, {
        status: "ready",
        error: null,
        multiRes: existingMultires.multiRes,
        multiresDir: paths.outputDir,
        multiresBytes: bytes,
      });
    }
  }

  return { registered, missing };
}

function isInsideUploads(candidate) {
  const resolved = path.resolve(candidate);
  const relative = path.relative(uploadsDir, resolved);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function removeEmptyParent(dir) {
  if (!dir) return;
  const resolved = path.resolve(dir);
  const relative = path.relative(uploadsDir, resolved);
  // Keep /uploads itself and the fixed kind folders; only remove empty
  // per-panorama subfolders created by the new storage layout.
  if (
    resolved === path.resolve(uploadsDir) ||
    !relative ||
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    !relative.includes(path.sep)
  ) {
    return;
  }
  try {
    const entries = await fsp.readdir(resolved);
    if (!entries.length) await fsp.rmdir(resolved);
  } catch {}
}

async function deleteAssetFiles(asset, username, reason = "manual_cleanup") {
  if (!asset) throw Object.assign(new Error("Asset not found"), { status: 404 });
  if (asset.deleted_at) return asset;
  if (asset.is_referenced) {
    throw Object.assign(
      new Error("This asset is still referenced by the live map and cannot be deleted."),
      { status: 409 },
    );
  }

  const sourcePath = resolveAssetStoragePath(asset);
  if (sourcePath && isInsideUploads(sourcePath)) {
    await fsp.rm(sourcePath, { force: true }).catch(() => {});
  }
  if (asset.multires_dir) {
    const multiresDir = path.resolve(asset.multires_dir);
    if (isInsideUploads(multiresDir)) {
      await fsp.rm(multiresDir, { recursive: true, force: true }).catch(() => {});
    }
  }
  if (sourcePath) await removeEmptyParent(path.dirname(sourcePath));

  const deleted = await markAssetDeleted(asset.id, username, reason);
  return deleted;
}

module.exports = {
  ensureStorage,
  storageRoot,
  uploadsDir,
  upload,
  processUpload,
  maxUploadMb,
  generateAssetMultires,
  reconcileReferencedAssets,
  deleteAssetFiles,
  publicPathToStoragePath,
  resolveAssetStoragePath,
  getMultiresAvailability,
};
