const { app, BrowserWindow, dialog, ipcMain, protocol } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const SCHEME = "assetvault";
const IGNORED_DIRS = new Set([".git", "Library", "Temp", "Logs", "obj", "Build", "Builds"]);
const EXTENSIONS = new Set([
  ".blend", ".fbx", ".obj", ".gltf", ".glb",
  ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff",
  ".wav", ".mp3", ".ogg", ".m4a", ".flac", ".aiff",
  ".cs", ".js", ".ts", ".json", ".shader", ".compute", ".hlsl", ".cginc", ".glsl",
  ".xml", ".yaml", ".yml", ".txt", ".md",
]);
const MIME_TYPES = {
  ".glb": "model/gltf-binary", ".gltf": "model/gltf+json",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".gif": "image/gif", ".bmp": "image/bmp",
  ".tif": "image/tiff", ".tiff": "image/tiff",
  ".wav": "audio/wav", ".mp3": "audio/mpeg", ".ogg": "audio/ogg",
  ".m4a": "audio/mp4", ".flac": "audio/flac", ".aiff": "audio/aiff",
};

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

let mainWindow;
let stateFile;
let blenderExportScript;
let state = { projects: [], assetMetadata: {}, blenderPath: "" };
const allowedPreviewFiles = new Set();

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function loadState() {
  stateFile = path.join(app.getPath("userData"), "library.json");
  blenderExportScript = path.join(app.getPath("userData"), "export-blend-preview.py");
  try {
    const saved = JSON.parse(await fs.readFile(stateFile, "utf8"));
    state = {
      projects: Array.isArray(saved.projects) ? saved.projects : [],
      assetMetadata: saved.assetMetadata && typeof saved.assetMetadata === "object" ? saved.assetMetadata : {},
      blenderPath: typeof saved.blenderPath === "string" ? saved.blenderPath : "",
    };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function saveState() {
  await fs.mkdir(path.dirname(stateFile), { recursive: true });
  const temporary = `${stateFile}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(state, null, 2), "utf8");
  await fs.rename(temporary, stateFile);
}

async function resolveAllowedPath(candidate) {
  const realCandidate = await fs.realpath(candidate);
  if (allowedPreviewFiles.has(realCandidate)) return realCandidate;
  for (const project of state.projects) {
    try {
      const realRoot = await fs.realpath(project.path);
      if (isWithin(realRoot, realCandidate)) return realCandidate;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  throw new Error("That file is outside the folders registered in Asset Vault.");
}

async function walkAssets(root, project, results) {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) await walkAssets(fullPath, project, results);
      continue;
    }
    if (!entry.isFile() || !EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    const stat = await fs.stat(fullPath);
    results.push({
      path: fullPath,
      name: entry.name,
      extension: path.extname(entry.name).slice(1).toLowerCase(),
      size: stat.size,
      modifiedAt: stat.mtimeMs,
      projectId: project.id,
      projectName: project.name,
      ...(state.assetMetadata[fullPath] || { tags: [], favorite: false, collection: "" }),
    });
  }
}

async function findUnityProjects(folder) {
  const found = [];
  const visited = new Set();
  async function visit(current, depth) {
    const resolved = path.resolve(current);
    if (visited.has(resolved) || depth > 4) return;
    visited.add(resolved);
    let entries;
    try {
      entries = await fs.readdir(resolved, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    const names = new Set(entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name));
    if (names.has("Assets") && names.has("ProjectSettings")) {
      found.push(resolved);
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !IGNORED_DIRS.has(entry.name)) await visit(path.join(resolved, entry.name), depth + 1);
    }
  }
  await visit(folder, 0);
  return found;
}

async function addProject(folder, source = "folder") {
  const realPath = await fs.realpath(folder);
  const existing = state.projects.find((project) => path.resolve(project.path) === path.resolve(realPath));
  if (existing) return existing;
  const project = {
    id: crypto.randomUUID(),
    name: path.basename(realPath),
    path: realPath,
    source,
    addedAt: Date.now(),
  };
  state.projects.push(project);
  await saveState();
  return project;
}

async function getLibrary() {
  const assets = [];
  for (const project of state.projects) {
    const assetsRoot = path.join(project.path, "Assets");
    let root = project.path;
    try {
      if ((await fs.stat(assetsRoot)).isDirectory()) root = assetsRoot;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await walkAssets(root, project, assets);
  }
  return { projects: state.projects, assets, blenderPath: state.blenderPath };
}

async function cloneGithubRepository(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Enter a valid public GitHub repository URL.");
  }
  if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "github.com" ||
      parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("Only public GitHub HTTPS repository URLs are supported.");
  }
  const match = parsed.pathname.match(/^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/);
  if (!match) throw new Error("Use a repository URL in the form https://github.com/owner/repository.");

  const choice = await dialog.showOpenDialog(mainWindow, {
    title: "Choose where to clone the repository",
    properties: ["openDirectory", "createDirectory"],
  });
  if (choice.canceled || !choice.filePaths[0]) return null;
  const repositoryName = match[2].replace(/\.git$/i, "");
  const destination = path.join(choice.filePaths[0], repositoryName);
  try {
    await fs.access(destination);
    throw new Error(`The destination already exists: ${destination}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  try {
    await execFileAsync("git", ["clone", "--depth", "1", "--no-tags", `https://github.com/${match[1]}/${repositoryName}.git`, destination], {
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 4,
      timeout: 10 * 60 * 1000,
    });
  } catch (error) {
    throw new Error(`Git clone failed: ${(error.stderr || error.message).trim()}`);
  }
  return addProject(destination, "github");
}

function assetUrlForFile(filePath) {
  return `${SCHEME}://local/${Buffer.from(filePath, "utf8").toString("base64url")}`;
}

async function prepareBlendPreview(sourcePath) {
  if (!state.blenderPath) throw new Error("Choose your Blender executable in Settings to preview .blend files.");
  try {
    await fs.access(state.blenderPath);
  } catch {
    throw new Error("The configured Blender executable could not be found. Choose it again in Settings.");
  }
  const stat = await fs.stat(sourcePath);
  const cacheDirectory = path.join(app.getPath("userData"), "previews");
  await fs.mkdir(cacheDirectory, { recursive: true });
  const hash = crypto.createHash("sha256").update(`${sourcePath}:${stat.size}:${stat.mtimeMs}`).digest("hex");
  const output = path.join(cacheDirectory, `${hash}.glb`);
  try {
    await fs.access(output);
    allowedPreviewFiles.add(await fs.realpath(output));
    return output;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const script = [
    "import bpy, sys",
    "args = sys.argv[sys.argv.index('--') + 1:]",
    "source, output = args[0], args[1]",
    "bpy.ops.wm.open_mainfile(filepath=source)",
    "bpy.ops.export_scene.gltf(filepath=output, export_format='GLB', export_animations=True, export_nla_strips=True, export_skins=True, export_morph=True)",
  ].join("\n");
  await fs.writeFile(blenderExportScript, script, "utf8");
  try {
    await execFileAsync(state.blenderPath, ["--background", "--python", blenderExportScript, "--", sourcePath, output], {
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 8,
      timeout: 5 * 60 * 1000,
    });
  } catch (error) {
    throw new Error(`Blender could not export this model: ${(error.stderr || error.message).trim()}`);
  }
  await fs.access(output);
  allowedPreviewFiles.add(await fs.realpath(output));
  return output;
}

async function getProtocolFile(requestUrl) {
  const url = new URL(requestUrl);
  const [encodedPath, ...relativeParts] = url.pathname.split("/").filter(Boolean);
  if (!encodedPath) throw new Error("Invalid local asset URL.");
  const originalPath = Buffer.from(encodedPath, "base64url").toString("utf8");
  const requestedPath = relativeParts.length
    ? path.resolve(path.dirname(originalPath), ...relativeParts.map(decodeURIComponent))
    : originalPath;
  const allowedPath = await resolveAllowedPath(requestedPath);
  const bytes = await fs.readFile(allowedPath);
  return new Response(bytes, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": MIME_TYPES[path.extname(allowedPath).toLowerCase()] || "application/octet-stream",
    },
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: "#181818",
    title: "Asset Vault",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (!app.isPackaged) {
    mainWindow.loadURL("http://127.0.0.1:5173");
  } else {
    mainWindow.loadFile(path.join(__dirname, "dist", "index.html"));
  }
}

app.whenReady().then(async () => {
  await loadState();
  protocol.handle(SCHEME, (request) => getProtocolFile(request.url).catch((error) =>
    new Response(error.message, { status: 404, headers: { "Access-Control-Allow-Origin": "*" } })));

  ipcMain.handle("library:get", getLibrary);
  ipcMain.handle("project:add", async () => {
    const choice = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory"] });
    if (choice.canceled || !choice.filePaths[0]) return null;
    return addProject(choice.filePaths[0]);
  });
  ipcMain.handle("project:scan-parent", async () => {
    const choice = await dialog.showOpenDialog(mainWindow, { title: "Choose a parent folder", properties: ["openDirectory"] });
    if (choice.canceled || !choice.filePaths[0]) return [];
    const found = await findUnityProjects(choice.filePaths[0]);
    if (found.length === 0) throw new Error("No Unity projects (Assets and ProjectSettings folders) were found below that folder.");
    const added = [];
    for (const folder of found) added.push(await addProject(folder, "scan"));
    return added;
  });
  ipcMain.handle("project:clone-github", (_event, url) => cloneGithubRepository(url));
  ipcMain.handle("project:remove", async (_event, projectId) => {
    state.projects = state.projects.filter((project) => project.id !== projectId);
    await saveState();
    return getLibrary();
  });
  ipcMain.handle("asset:metadata", async (_event, filePath, metadata) => {
    await resolveAllowedPath(filePath);
    const current = state.assetMetadata[filePath] || { tags: [], favorite: false, collection: "" };
    state.assetMetadata[filePath] = {
      ...current,
      ...metadata,
      tags: Array.isArray(metadata.tags) ? metadata.tags.filter((tag) => typeof tag === "string").slice(0, 40) : current.tags,
      favorite: typeof metadata.favorite === "boolean" ? metadata.favorite : current.favorite,
      collection: typeof metadata.collection === "string" ? metadata.collection.slice(0, 100) : current.collection,
    };
    await saveState();
    return state.assetMetadata[filePath];
  });
  ipcMain.handle("asset:text", async (_event, filePath) => {
    const allowedPath = await resolveAllowedPath(filePath);
    const stat = await fs.stat(allowedPath);
    if (stat.size > 1024 * 1024) throw new Error("This script is larger than the 1 MB preview limit.");
    return fs.readFile(allowedPath, "utf8");
  });
  ipcMain.handle("asset:url", async (_event, filePath) => {
    const allowedPath = await resolveAllowedPath(filePath);
    return assetUrlForFile(allowedPath);
  });
  ipcMain.handle("asset:model-preview", async (_event, filePath) => {
    const allowedPath = await resolveAllowedPath(filePath);
    const previewPath = path.extname(allowedPath).toLowerCase() === ".blend"
      ? await prepareBlendPreview(allowedPath)
      : allowedPath;
    return assetUrlForFile(previewPath);
  });
  ipcMain.handle("settings:choose-blender", async () => {
    const choice = await dialog.showOpenDialog(mainWindow, {
      title: "Choose Blender executable",
      properties: ["openFile"],
      filters: [{ name: "Blender", extensions: ["exe"] }],
    });
    if (choice.canceled || !choice.filePaths[0]) return state.blenderPath;
    state.blenderPath = choice.filePaths[0];
    await saveState();
    return state.blenderPath;
  });

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((error) => {
  dialog.showErrorBox("Asset Vault failed to start", error.message);
  app.quit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
