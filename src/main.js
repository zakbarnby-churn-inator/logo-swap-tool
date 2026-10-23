const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");
const { pathToFileURL } = require("url");
const sharp = require("sharp");
const { autoUpdater } = require("electron-updater");
const config = require("./config");

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, "..", "index.html"));
}

// Auto-update only makes sense in a packaged, distributed build -- running
// via `npm start` in development has no update feed and would just error.
function setupAutoUpdate() {
  if (!app.isPackaged) return;

  autoUpdater.checkForUpdatesAndNotify();

  autoUpdater.on("update-downloaded", () => {
    dialog
      .showMessageBox(mainWindow, {
        type: "info",
        buttons: ["Restart Now", "Later"],
        title: "Update Ready",
        message: "A new version of Logo Swap Tool has been downloaded. Restart now to install it?"
      })
      .then((result) => {
        if (result.response === 0) autoUpdater.quitAndInstall();
      });
  });

  autoUpdater.on("error", (err) => {
    console.log("[auto-update] error:", err.message);
  });
}

app.whenReady().then(() => {
  createWindow();
  setupAutoUpdate();
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("will-quit", () => {
  try {
    fs.rmSync(config.TEMP_DIR, { recursive: true, force: true });
  } catch (e) {
    console.log("[cleanup] could not remove temp dir on quit:", e.message);
  }
});

function ensureTempDir() {
  if (!fs.existsSync(config.TEMP_DIR)) fs.mkdirSync(config.TEMP_DIR, { recursive: true });
}

// ---- Profile storage ----
// Profiles + their attached template files live entirely under one folder
// (userData/profiles), so the whole folder can be zipped and handed to a
// teammate -- everything it references is copied inside it, nothing points
// back to paths on this specific machine.
// Computed lazily (not at module load) since app.getPath() should only be
// relied on once Electron has fully initialized.
function getProfilesRoot() {
  return path.join(app.getPath("userData"), "profiles");
}

function getProfilesFile() {
  return path.join(getProfilesRoot(), "profiles.json");
}

function resolveProfileFile(relativePath) {
  return path.join(getProfilesRoot(), relativePath);
}

function loadProfiles() {
  try {
    const file = getProfilesFile();
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    }
  } catch (e) {
    console.log("[profiles] failed to load:", e.message);
  }
  return { profiles: [] };
}

function saveProfilesData(data) {
  const root = getProfilesRoot();
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(getProfilesFile(), JSON.stringify(data, null, 2), "utf8");
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

ipcMain.handle("get-profiles", async () => {
  return loadProfiles();
});

ipcMain.handle("create-profile", async (_evt, { name }) => {
  const data = loadProfiles();
  const profile = { id: makeId(), name, files: [] };
  data.profiles.push(profile);
  saveProfilesData(data);
  return data;
});

ipcMain.handle("delete-profile", async (_evt, { profileId }) => {
  const data = loadProfiles();
  const profile = data.profiles.find((p) => p.id === profileId);
  if (profile) {
    try {
      fs.rmSync(path.join(getProfilesRoot(), profile.id), { recursive: true, force: true });
    } catch (e) {
      console.log("[profiles] could not remove profile folder:", e.message);
    }
  }
  data.profiles = data.profiles.filter((p) => p.id !== profileId);
  saveProfilesData(data);
  return data;
});

// Copies each selected file into this profile's own folder inside the app's
// data directory, so the profile is fully self-contained (no dependency on
// where the original file lives on this machine -- important for sharing).
ipcMain.handle("add-files-to-profile", async (_evt, { profileId, filePaths }) => {
  const data = loadProfiles();
  const profile = data.profiles.find((p) => p.id === profileId);
  if (!profile) throw new Error("Profile not found");

  const filesDir = path.join(getProfilesRoot(), profileId, "files");
  fs.mkdirSync(filesDir, { recursive: true });

  for (const fp of filePaths) {
    const baseName = path.basename(fp);
    const destPath = path.join(filesDir, baseName);
    fs.copyFileSync(fp, destPath);
    const relativePath = path.join(profileId, "files", baseName);
    if (!profile.files.some((f) => f.relativePath === relativePath)) {
      profile.files.push({ relativePath, layers: [] });
    }
  }
  saveProfilesData(data);
  return data;
});

ipcMain.handle("remove-file-from-profile", async (_evt, { profileId, relativePath }) => {
  const data = loadProfiles();
  const profile = data.profiles.find((p) => p.id === profileId);
  if (!profile) throw new Error("Profile not found");
  profile.files = profile.files.filter((f) => f.relativePath !== relativePath);
  saveProfilesData(data);
  try {
    fs.unlinkSync(resolveProfileFile(relativePath));
  } catch (e) {
    // fine if already gone
  }
  return data;
});

ipcMain.handle("resolve-profile-file", async (_evt, { relativePath }) => {
  return resolveProfileFile(relativePath);
});

// Opens the profiles folder in Finder so it can be manually zipped and shared.
ipcMain.handle("reveal-profiles-folder", async () => {
  const root = getProfilesRoot();
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
  shell.openPath(root);
  return true;
});

// Merges a shared profiles folder (from a teammate) into this app's own
// profile storage -- copies each imported profile's files under a freshly
// generated ID so there's no collision with anything already here.
ipcMain.handle("import-profiles-folder", async () => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory"] });
  if (res.canceled) return loadProfiles();

  const importRoot = res.filePaths[0];
  const importJsonPath = path.join(importRoot, "profiles.json");
  if (!fs.existsSync(importJsonPath)) {
    throw new Error("No profiles.json found in that folder -- make sure you selected the shared 'profiles' folder itself.");
  }

  const importData = JSON.parse(fs.readFileSync(importJsonPath, "utf8"));
  const data = loadProfiles();

  for (const importedProfile of importData.profiles || []) {
    const newId = makeId();
    const newFiles = [];
    for (const f of importedProfile.files || []) {
      const srcPath = path.join(importRoot, f.relativePath);
      const destRelative = path.join(newId, "files", path.basename(f.relativePath));
      const destPath = path.join(getProfilesRoot(), destRelative);
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      if (fs.existsSync(srcPath)) fs.copyFileSync(srcPath, destPath);
      newFiles.push({ relativePath: destRelative, layers: f.layers || [] });
    }
    data.profiles.push({ id: newId, name: importedProfile.name, files: newFiles });
  }

  saveProfilesData(data);
  return data;
});

// role-specific defaults stored per layer:
//   logo: { scalePercent }
//   ledBanner: { scalePercent, spacing, color } -- background colour is part
//     of this same role, not a separately assigned layer
ipcMain.handle("save-file-layers", async (_evt, { profileId, relativePath, layers }) => {
  const data = loadProfiles();
  const profile = data.profiles.find((p) => p.id === profileId);
  if (!profile) throw new Error("Profile not found");
  const fileEntry = profile.files.find((f) => f.relativePath === relativePath);
  if (!fileEntry) throw new Error("File not found in profile");
  fileEntry.layers = layers;
  saveProfilesData(data);
  return data;
});

// Best-effort delete -- never throws, since cleanup failing shouldn't break
// the actual operation that already succeeded.
function safeUnlink(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (e) {
    console.log("[cleanup] could not remove", filePath, e.message);
  }
}

function clearDir(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) return;
    for (const name of fs.readdirSync(dirPath)) {
      safeUnlink(path.join(dirPath, name));
    }
  } catch (e) {
    console.log("[cleanup] could not clear", dirPath, e.message);
  }
}

// Given a PNG that Photoshop/Illustrator just exported, either leaves it as
// PNG or converts it to WebP and removes the intermediate PNG -- only the
// requested format ends up in the output folder.
async function finalizeFormat(pngPath, wantWebp) {
  console.log("[finalizeFormat] pngPath:", pngPath, "wantWebp:", wantWebp, "exists:", fs.existsSync(pngPath));
  if (!wantWebp) return pngPath;
  if (!fs.existsSync(pngPath)) return pngPath;

  const webpPath = pngPath.replace(/\.png$/i, ".webp");
  await sharp(pngPath).webp({ quality: 90 }).toFile(webpPath);
  fs.unlinkSync(pngPath);
  console.log("[finalizeFormat] converted to:", webpPath);
  return webpPath;
}

function runOsascriptDoJavascript(appName, jsxPath) {
  return new Promise((resolve, reject) => {
    const script = `tell application "${appName}" to do javascript file "${jsxPath}"`;
    execFile("osascript", ["-e", script], { maxBuffer: 1024 * 1024 * 10 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout.trim());
    });
  });
}

let uniqueCounter = 0;
function uniqueId() {
  uniqueCounter += 1;
  return `${Date.now()}-${uniqueCounter}`;
}

function writeParamsFile(paramsObj, prefix) {
  ensureTempDir();
  const cleanPrefix = String(prefix).replace(/\.jsx$/i, "");
  const filePath = path.join(config.TEMP_DIR, `${cleanPrefix}-${uniqueId()}.jsx`);
  const body = "var params = " + JSON.stringify(paramsObj) + ";";
  fs.writeFileSync(filePath, body, "utf8");
  return filePath;
}

// ---- File pickers ----
ipcMain.handle("pick-templates", async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "Templates", extensions: ["psd", "ai"] }]
  });
  return res.canceled ? [] : res.filePaths;
});

ipcMain.handle("pick-logo", async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "psd", "ai", "svg", "eps"] }]
  });
  return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle("pick-output-dir", async () => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory", "createDirectory"] });
  return res.canceled ? null : res.filePaths[0];
});

// ---- Scan a template for logo-candidate layers/items ----
ipcMain.handle("scan-template", async (_evt, templatePath) => {
  ensureTempDir();
  const ext = path.extname(templatePath).toLowerCase();
  const resultFile = path.join(config.TEMP_DIR, `scan-result-${uniqueId()}.json`);
  if (fs.existsSync(resultFile)) fs.unlinkSync(resultFile);

  const paramsFile = writeParamsFile(
    { templatePath, resultFile },
    "scan-params.jsx"
  );

  const jsx = ext === ".psd"
    ? path.join(__dirname, "..", "scripts", "photoshop-scan.jsx")
    : path.join(__dirname, "..", "scripts", "illustrator-scan.jsx");
  const appName = ext === ".psd" ? config.PHOTOSHOP_APP_NAME : config.ILLUSTRATOR_APP_NAME;
  const runnerPath = buildRunner(paramsFile, jsx);

  let result = { layers: [] };
  try {
    await runOsascriptDoJavascript(appName, runnerPath);
    if (fs.existsSync(resultFile)) {
      result = JSON.parse(fs.readFileSync(resultFile, "utf8"));
    }
  } finally {
    safeUnlink(paramsFile);
    safeUnlink(runnerPath);
    safeUnlink(resultFile);
  }
  return result;
});

// ---- Rename a layer/item to the target logo-slot name ----
// Photoshop matches by current layer name; Illustrator matches by index
// (from the scan step) since pasted/grouped artwork often starts unnamed.
ipcMain.handle("rename-layer", async (_evt, { templatePath, currentName, index, newName }) => {
  const ext = path.extname(templatePath).toLowerCase();
  let paramsFile, runnerPath;
  try {
    if (ext === ".psd") {
      paramsFile = writeParamsFile({ templatePath, currentName, newName }, "rename-params.jsx");
      const jsx = path.join(__dirname, "..", "scripts", "photoshop-rename.jsx");
      runnerPath = buildRunner(paramsFile, jsx);
      await runOsascriptDoJavascript(config.PHOTOSHOP_APP_NAME, runnerPath);
    } else {
      paramsFile = writeParamsFile({ templatePath, index, newName }, "rename-params.jsx");
      const jsx = path.join(__dirname, "..", "scripts", "illustrator-rename.jsx");
      runnerPath = buildRunner(paramsFile, jsx);
      await runOsascriptDoJavascript(config.ILLUSTRATOR_APP_NAME, runnerPath);
    }
  } finally {
    safeUnlink(paramsFile);
    safeUnlink(runnerPath);
  }
  return true;
});

// ---- Generate preview thumbnails without touching the real output folder ----
ipcMain.handle("run-preview", async (_evt, { templates, logoPath, layerName, scalePercent }) => {
  const resolvedLayerName = layerName || config.DEFAULT_LOGO_LAYER_NAME;
  const resolvedScalePercent = Number.isFinite(scalePercent) ? scalePercent : 100;
  ensureTempDir();
  const previewDir = path.join(config.TEMP_DIR, "preview");
  if (!fs.existsSync(previewDir)) fs.mkdirSync(previewDir, { recursive: true });

  // Only the latest preview batch is ever needed -- clear anything from
  // previous runs so preview images don't accumulate.
  clearDir(previewDir);

  const results = [];

  for (const templatePath of templates) {
    const ext = path.extname(templatePath).toLowerCase();
    const baseName = path.basename(templatePath, ext);
    let paramsFile, runnerPath, manifestFile;

    try {
      if (ext === ".psd") {
        manifestFile = path.join(config.TEMP_DIR, `preview-manifest-${baseName}-${uniqueId()}.txt`);
        if (fs.existsSync(manifestFile)) fs.unlinkSync(manifestFile);

        paramsFile = writeParamsFile(
          {
            templatePath,
            logoPath,
            layerName: resolvedLayerName,
            outputDir: previewDir,
            baseName,
            manifestFile,
            format: "png",
            scalePercent: resolvedScalePercent,
            previewMode: true
          },
          "swap-params.jsx"
        );
        const jsx = path.join(__dirname, "..", "scripts", "photoshop-swap-export.jsx");
        runnerPath = buildRunner(paramsFile, jsx);
        await runOsascriptDoJavascript(config.PHOTOSHOP_APP_NAME, runnerPath);

        const manifestText = fs.existsSync(manifestFile) ? fs.readFileSync(manifestFile, "utf8") : "";
        const outputPaths = manifestText.split(/\r\n|\r|\n/).map((s) => s.trim()).filter(Boolean);

        for (const outputPath of outputPaths) {
          if (fs.existsSync(outputPath)) {
            results.push({ templatePath, label: path.basename(outputPath), fileUrl: pathToFileURL(outputPath).href });
          }
        }
      } else {
        const pngPath = path.join(previewDir, `${baseName}-${uniqueId()}.png`);
        paramsFile = writeParamsFile(
          { templatePath, logoPath, layerName: resolvedLayerName, outputPng: pngPath, scalePercent: resolvedScalePercent, previewMode: true },
          "swap-params.jsx"
        );
        const jsx = path.join(__dirname, "..", "scripts", "illustrator-swap-export.jsx");
        runnerPath = buildRunner(paramsFile, jsx);
        await runOsascriptDoJavascript(config.ILLUSTRATOR_APP_NAME, runnerPath);

        if (fs.existsSync(pngPath)) {
          results.push({ templatePath, label: path.basename(pngPath), fileUrl: pathToFileURL(pngPath).href });
        }
      }
    } catch (err) {
      results.push({ templatePath, label: path.basename(templatePath), error: err.message });
    } finally {
      safeUnlink(paramsFile);
      safeUnlink(runnerPath);
      safeUnlink(manifestFile);
    }
  }

  return results;
});

// ---- Run the actual swap + export across selected templates ----
ipcMain.handle("run-swap", async (_evt, { templates, logoPath, outputDir, jobName, layerName, format, scalePercent }) => {
  const results = [];
  const resolvedLayerName = layerName || config.DEFAULT_LOGO_LAYER_NAME;
  const wantWebp = String(format || "").trim().toLowerCase() === "webp";
  const resolvedScalePercent = Number.isFinite(scalePercent) ? scalePercent : 100;

  // Build <outputDir>/<jobName>/PSD and .../Exports, and archive a copy of
  // each source template into PSD/ for reference.
  const jobFolder = path.join(outputDir, jobName);
  const psdDir = path.join(jobFolder, "PSD");
  const exportsDir = path.join(jobFolder, "Exports");
  fs.mkdirSync(psdDir, { recursive: true });
  fs.mkdirSync(exportsDir, { recursive: true });

  for (const templatePath of templates) {
    const ext = path.extname(templatePath).toLowerCase();
    const baseName = path.basename(templatePath, ext);
    let paramsFile, runnerPath, manifestFile;

    try {
      // Archive the source file used for this export.
      try {
        fs.copyFileSync(templatePath, path.join(psdDir, path.basename(templatePath)));
      } catch (eCopy) {
        console.log("[run-swap] could not archive source file:", eCopy.message);
      }

      if (ext === ".psd") {
        // Photoshop script exports one PNG per artboard (or one file if no
        // artboards) and writes the list of paths to this manifest file.
        manifestFile = path.join(config.TEMP_DIR, `manifest-${baseName}-${uniqueId()}.txt`);
        if (fs.existsSync(manifestFile)) fs.unlinkSync(manifestFile);

        paramsFile = writeParamsFile(
          { templatePath, logoPath, layerName: resolvedLayerName, outputDir: exportsDir, baseName, manifestFile, format: format || "png", scalePercent: resolvedScalePercent },
          "swap-params.jsx"
        );
        const jsx = path.join(__dirname, "..", "scripts", "photoshop-swap-export.jsx");
        runnerPath = buildRunner(paramsFile, jsx);
        await runOsascriptDoJavascript(config.PHOTOSHOP_APP_NAME, runnerPath);

        const manifestText = fs.existsSync(manifestFile) ? fs.readFileSync(manifestFile, "utf8") : "";
        const outputPaths = manifestText.split(/\r\n|\r|\n/).map((s) => s.trim()).filter(Boolean);

        if (!outputPaths.length) {
          results.push({ templatePath, status: "error", message: "No files were exported." });
          continue;
        }

        for (const outputPath of outputPaths) {
          if (!fs.existsSync(outputPath)) {
            results.push({ templatePath, status: "error", message: `Expected file not found: ${outputPath}` });
            continue;
          }
          results.push({ templatePath, status: "ok", outputPath });
        }
      } else {
        const pngPath = path.join(exportsDir, `${baseName}.png`);

        paramsFile = writeParamsFile(
          { templatePath, logoPath, layerName: resolvedLayerName, outputPng: pngPath, scalePercent: resolvedScalePercent },
          "swap-params.jsx"
        );
        const jsx = path.join(__dirname, "..", "scripts", "illustrator-swap-export.jsx");
        runnerPath = buildRunner(paramsFile, jsx);
        await runOsascriptDoJavascript(config.ILLUSTRATOR_APP_NAME, runnerPath);

        const finalPath = await finalizeFormat(pngPath, wantWebp);
        results.push({ templatePath, status: "ok", outputPath: finalPath });
      }
    } catch (err) {
      results.push({ templatePath, status: "error", message: err.message });
    } finally {
      safeUnlink(paramsFile);
      safeUnlink(runnerPath);
      safeUnlink(manifestFile);
    }
  }
  return results;
});

// Builds a tiny wrapper JSX that first loads the params file, then the real script.
// This lets us reuse one "do javascript" call while injecting per-run parameters.
function buildRunner(paramsFile, realScriptPath) {
  ensureTempDir();
  const runnerPath = path.join(config.TEMP_DIR, `runner-${uniqueId()}.jsx`);
  const contents = `$.evalFile("${paramsFile}");\n$.evalFile("${realScriptPath}");\n`;
  fs.writeFileSync(runnerPath, contents, "utf8");
  return runnerPath;
}
