const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { spawn, spawnSync } = require("node:child_process");

const multiresEnabled = !["0", "false", "no", "off"].includes(
  String(process.env.MULTIRES_ENABLED ?? "true").toLowerCase(),
);
const tileSize = Math.max(256, Number(process.env.MULTIRES_TILE_SIZE || 512));
const fallbackSize = Math.max(0, Number(process.env.MULTIRES_FALLBACK_SIZE || 1024));
const tileQuality = Math.min(100, Math.max(50, Number(process.env.MULTIRES_TILE_QUALITY || 85)));
const timeoutMs = Math.max(60_000, Number(process.env.MULTIRES_TIMEOUT_MS || 20 * 60 * 1000));

function existingPath(candidates) {
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || null;
}

function generatorPath() {
  return existingPath([
    process.env.MULTIRES_GENERATOR_PATH,
    "/opt/pannellum/generate.py",
    path.join(process.cwd(), "server", "vendor", "pannellum", "generate.py"),
    path.join(process.cwd(), "node_modules", "pannellum", "utils", "multires", "generate.py"),
  ]);
}


function makeGeneratorPythonCompatible(sourcePath) {
  try {
    const source = fs.readFileSync(sourcePath, "utf8");
    let patched = source;

    // Pannellum 2.5.7 imports find_executable from distutils.spawn.
    // distutils is no longer included with newer Python runtimes, while
    // shutil.which provides the same executable lookup behavior needed here.
    patched = patched.replace(
      /from\s+distutils\.spawn\s+import\s+find_executable/g,
      "from shutil import which as find_executable",
    );

    // Keep the older Pannellum script compatible with newer Pillow releases.
    if (patched.includes("Image.ANTIALIAS")) {
      patched = patched.replace(
        "Image.MAX_IMAGE_PIXELS = None",
        "Image.MAX_IMAGE_PIXELS = None\nif not hasattr(Image, 'ANTIALIAS'):\n    Image.ANTIALIAS = Image.Resampling.LANCZOS",
      );
    }

    if (patched === source) return sourcePath;

    const targetPath = path.join(os.tmpdir(), "riems-pannellum-generate.py");
    fs.writeFileSync(targetPath, patched, "utf8");
    return targetPath;
  } catch (error) {
    console.warn(
      "[streetview] Could not prepare Pannellum generator compatibility copy:",
      error?.message || error,
    );
    return sourcePath;
  }
}

function pythonCommand() {
  if (process.env.MULTIRES_PYTHON) return process.env.MULTIRES_PYTHON;
  return process.platform === "win32" ? "python" : "python3";
}

function commandExists(command, args = ["--version"]) {
  try {
    const result = spawnSync(command, args, { stdio: "ignore", windowsHide: true });
    return !result.error || result.error.code !== "ENOENT";
  } catch {
    return false;
  }
}

function getMultiresAvailability() {
  if (!multiresEnabled) {
    return { available: false, reason: "disabled", generatorPath: null };
  }

  const rawGenerator = generatorPath();
  if (!rawGenerator) {
    return {
      available: false,
      reason: "generator_missing",
      generatorPath: null,
      hint: "Use the Docker deployment or configure MULTIRES_GENERATOR_PATH.",
    };
  }

  const generator = makeGeneratorPythonCompatible(rawGenerator);
  const python = pythonCommand();
  if (!commandExists(python)) {
    return { available: false, reason: "python_missing", generatorPath: generator, python };
  }

  const nona = process.env.MULTIRES_NONA_PATH || "nona";
  if (!commandExists(nona, ["--help"])) {
    return {
      available: false,
      reason: "nona_missing",
      generatorPath: generator,
      python,
      nona,
      hint: "Install Hugin / nona, or use the Docker deployment where it is included.",
    };
  }

  return { available: true, generatorPath: generator, python, nona };
}

async function directorySize(dir) {
  let total = 0;
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await directorySize(full);
    else if (entry.isFile()) total += (await fsp.stat(full)).size;
  }
  return total;
}

function runGenerator({ inputPath, outputDir, availability }) {
  return new Promise((resolve, reject) => {
    const args = [
      availability.generatorPath,
      "--output",
      outputDir,
      "--tilesize",
      String(tileSize),
      "--fallbacksize",
      String(fallbackSize),
      "--quality",
      String(tileQuality),
    ];

    if (process.env.MULTIRES_NONA_PATH) {
      args.push("--nona", process.env.MULTIRES_NONA_PATH);
    }
    args.push(inputPath);

    const child = spawn(availability.python, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const MAX_LOG = 24_000;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      const error = new Error(`Multires generation timed out after ${Math.round(timeoutMs / 60000)} minutes`);
      error.code = "MULTIRES_TIMEOUT";
      reject(error);
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout = (stdout + chunk.toString()).slice(-MAX_LOG);
    });
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-MAX_LOG);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve({ stdout, stderr });
      const error = new Error(
        `Pannellum multires generator exited with code ${code}${stderr ? `: ${stderr.trim().slice(-1200)}` : ""}`,
      );
      error.code = "MULTIRES_GENERATION_FAILED";
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });
}

let generationQueue = Promise.resolve();
let queuedCount = 0;
let activeCount = 0;

function queued(task) {
  queuedCount += 1;
  const execute = async () => {
    queuedCount -= 1;
    activeCount += 1;
    try {
      return await task();
    } finally {
      activeCount -= 1;
    }
  };
  const result = generationQueue.then(execute, execute);
  generationQueue = result.catch(() => {});
  return result;
}

async function generateMultires({ inputPath, outputDir, publicBasePath }) {
  return queued(async () => {
    const availability = getMultiresAvailability();
    if (!availability.available) {
      const error = new Error(`Multires generator unavailable: ${availability.reason}`);
      error.code = "MULTIRES_UNAVAILABLE";
      error.availability = availability;
      throw error;
    }

    await fsp.rm(outputDir, { recursive: true, force: true });
    await runGenerator({ inputPath, outputDir, availability });

    const configPath = path.join(outputDir, "config.json");
    const rawConfig = JSON.parse(await fsp.readFile(configPath, "utf8"));
    if (rawConfig.type !== "multires" || !rawConfig.multiRes) {
      throw new Error("Pannellum generator did not produce a valid multires config.json");
    }

    const multiRes = {
      ...rawConfig.multiRes,
      basePath: publicBasePath,
    };

    return {
      multiRes,
      generatedConfig: rawConfig,
      bytes: await directorySize(outputDir),
      outputDir,
      availability,
    };
  });
}

function getMultiresQueueStatus() {
  return {
    enabled: multiresEnabled,
    ...getMultiresAvailability(),
    queued: queuedCount,
    active: activeCount,
    tileSize,
    fallbackSize,
    tileQuality,
  };
}

module.exports = {
  generateMultires,
  getMultiresAvailability,
  getMultiresQueueStatus,
  multiresEnabled,
  tileSize,
  fallbackSize,
  tileQuality,
};
