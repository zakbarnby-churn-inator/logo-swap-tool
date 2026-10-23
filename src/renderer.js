let templates = [];
let logoPath = null;
let outputDir = null;

const templateListEl = document.getElementById("templateList");
const logoPathEl = document.getElementById("logoPath");
const outputPathEl = document.getElementById("outputPath");
const logEl = document.getElementById("log");
const scanResultsEl = document.getElementById("scanResults");

function log(msg) {
  logEl.textContent += "\n" + msg;
  logEl.scrollTop = logEl.scrollHeight;
}

function renderTemplates() {
  templateListEl.innerHTML = "";
  templates.forEach((t) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="path">${t}</span>`;
    templateListEl.appendChild(li);
  });
}

document.getElementById("logoScale").addEventListener("input", (e) => {
  document.getElementById("logoScaleLabel").textContent = `${e.target.value}%`;
});

document.getElementById("previewBtn").addEventListener("click", async () => {
  if (!templates.length) return log("Select templates first.");
  if (!logoPath) return log("Select a logo first.");
  const layerName = document.getElementById("layerName").value || "LOGO";
  const scalePercent = parseFloat(document.getElementById("logoScale").value) || 100;

  const previewBtn = document.getElementById("previewBtn");
  const scanBtn = document.getElementById("scanBtn");
  const runBtn = document.getElementById("runBtn");
  previewBtn.disabled = true;
  scanBtn.disabled = true;
  runBtn.disabled = true;

  log(`Generating preview... (scale: ${scalePercent}%)`);
  try {
    const results = await window.api.runPreview({ templates, logoPath, layerName, scalePercent });
    const grid = document.getElementById("previewGrid");
    grid.innerHTML = "";
    results.forEach((r) => {
      if (r.fileUrl) {
        const wrap = document.createElement("div");
        wrap.className = "thumb";
        const cacheBust = (r.fileUrl.includes("?") ? "&" : "?") + "t=" + Date.now();
        wrap.innerHTML = `<img src="${r.fileUrl}${cacheBust}" /><div class="path">${r.label}</div>`;
        grid.appendChild(wrap);
      } else {
        log(`Preview failed for ${r.label}: ${r.error}`);
      }
    });
    log("Preview updated.");
  } finally {
    previewBtn.disabled = false;
    scanBtn.disabled = false;
    runBtn.disabled = false;
  }
});

document.getElementById("pickTemplates").addEventListener("click", async () => {
  const picked = await window.api.pickTemplates();
  if (picked.length) {
    templates = picked;
    renderTemplates();
    log(`Selected ${templates.length} template(s).`);
  }
});

document.getElementById("pickLogo").addEventListener("click", async () => {
  const picked = await window.api.pickLogo();
  if (picked) {
    logoPath = picked;
    logoPathEl.textContent = logoPath;
    log(`Logo set: ${logoPath}`);
  }
});

document.getElementById("pickOutput").addEventListener("click", async () => {
  const picked = await window.api.pickOutputDir();
  if (picked) {
    outputDir = picked;
    outputPathEl.textContent = outputDir;
    log(`Output folder set: ${outputDir}`);
  }
});

document.getElementById("scanBtn").addEventListener("click", async () => {
  if (!templates.length) return log("Select templates first.");
  const scanBtn = document.getElementById("scanBtn");
  const runBtn = document.getElementById("runBtn");
  const previewBtn = document.getElementById("previewBtn");
  scanBtn.disabled = true;
  runBtn.disabled = true;
  previewBtn.disabled = true;
  scanResultsEl.innerHTML = "";
  try {
    for (const t of templates) {
      log(`Scanning ${t}...`);
      const result = await window.api.scanTemplate(t);
      const isIllustrator = t.toLowerCase().endsWith(".ai");

      // Photoshop scan returns { layers: [name, ...] }
      // Illustrator scan returns { items: [{index, type, name}, ...] }
      const entries = isIllustrator
        ? (result.items || []).map((it) => ({
            label: `${it.type}${it.name ? ": " + it.name : " (unnamed)"}`,
            currentName: it.name,
            index: it.index
          }))
        : (result.layers || []).map((name) => ({ label: name, currentName: name, index: null }));

      if (!entries.length) {
        log(`  Nothing found.`);
        continue;
      }

      entries.forEach((entry) => {
        const li = document.createElement("li");
        li.innerHTML = `<span class="path">${t.split("/").pop()} → ${entry.label}</span>`;
        const btn = document.createElement("button");
        btn.className = "secondary";
        btn.textContent = "Rename to LOGO";
        btn.addEventListener("click", async () => {
          const newName = document.getElementById("layerName").value || "LOGO";
          await window.api.renameLayer({
            templatePath: t,
            currentName: entry.currentName,
            index: entry.index,
            newName
          });
          log(`Renamed "${entry.label}" -> "${newName}" in ${t.split("/").pop()}`);
        });
        li.appendChild(btn);
        scanResultsEl.appendChild(li);
      });
    }
  } finally {
    scanBtn.disabled = false;
    runBtn.disabled = false;
    previewBtn.disabled = false;
  }
});

document.getElementById("runBtn").addEventListener("click", async () => {
  if (!templates.length) return log("Select templates first.");
  if (!logoPath) return log("Select a logo first.");
  if (!outputDir) return log("Select an output folder first.");
  const jobName = document.getElementById("jobName").value.trim();
  if (!jobName) return log("Enter a job/export name first.");
  const layerName = document.getElementById("layerName").value || "LOGO";
  const format = document.getElementById("exportFormat").value;
  const scalePercent = parseFloat(document.getElementById("logoScale").value) || 100;

  const scanBtn = document.getElementById("scanBtn");
  const runBtn = document.getElementById("runBtn");
  const previewBtn = document.getElementById("previewBtn");
  scanBtn.disabled = true;
  runBtn.disabled = true;
  previewBtn.disabled = true;

  log(`Running swap on ${templates.length} template(s)... (format: ${format}, scale: ${scalePercent}%)`);
  try {
    const results = await window.api.runSwap({ templates, logoPath, outputDir, jobName, layerName, format, scalePercent });
    results.forEach((r) => {
      if (r.status === "ok") {
        log(`✓ ${r.templatePath.split("/").pop()} -> ${r.outputPath.split("/").pop()}`);
      } else {
        log(`✗ ${r.templatePath.split("/").pop()} FAILED: ${r.message}`);
      }
    });
    log("Done.");
  } finally {
    scanBtn.disabled = false;
    runBtn.disabled = false;
    previewBtn.disabled = false;
  }
});

// ==================== Profiles ====================

let profiles = [];
let currentProfileId = null;
let currentConfigRelativePath = null;
let currentConfigLayers = [];

// Background colour lives inside the LED Banner role itself -- it's not a
// separate layer you assign, since these templates don't have one.
const ROLE_LABELS = {
  "": "None",
  logo: "Logo (simple)",
  ledBanner: "LED Banner (logo + background colour)"
};

async function refreshProfiles(selectId) {
  try {
    const data = await window.api.getProfiles();
    profiles = data.profiles || [];
    const sel = document.getElementById("profileSelect");
    sel.innerHTML = '<option value="">-- No profile selected --</option>';
    profiles.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      sel.appendChild(opt);
    });
    if (selectId && profiles.some((p) => p.id === selectId)) {
      sel.value = selectId;
      currentProfileId = selectId;
    } else {
      currentProfileId = null;
    }
    renderProfileFiles();
  } catch (err) {
    log(`Error loading profiles: ${err.message}`);
  }
}

function getCurrentProfile() {
  return profiles.find((p) => p.id === currentProfileId) || null;
}

function renderProfileFiles() {
  const area = document.getElementById("profileFilesArea");
  const list = document.getElementById("profileFilesList");
  list.innerHTML = "";
  const profile = getCurrentProfile();
  if (!profile) {
    area.style.display = "none";
    return;
  }
  area.style.display = "block";
  profile.files.forEach((f) => {
    const li = document.createElement("li");
    const name = f.relativePath.split("/").pop();
    const assignedCount = (f.layers || []).filter((l) => l.role).length;
    li.innerHTML = `<span class="path">${name} (${assignedCount} layer${assignedCount === 1 ? "" : "s"} configured)</span>`;

    const configureBtn = document.createElement("button");
    configureBtn.className = "secondary";
    configureBtn.textContent = "Configure Layers";
    configureBtn.addEventListener("click", () => openLayerConfig(f.relativePath));

    const removeBtn = document.createElement("button");
    removeBtn.className = "secondary";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", async () => {
      try {
        const data = await window.api.removeFileFromProfile({ profileId: currentProfileId, relativePath: f.relativePath });
        profiles = data.profiles;
        renderProfileFiles();
      } catch (err) {
        log(`Error removing file: ${err.message}`);
      }
    });

    li.appendChild(configureBtn);
    li.appendChild(removeBtn);
    list.appendChild(li);
  });
}

document.getElementById("profileSelect").addEventListener("change", (e) => {
  currentProfileId = e.target.value || null;
  renderProfileFiles();
  document.getElementById("layerConfigArea").style.display = "none";
});

document.getElementById("createProfileBtn").addEventListener("click", async () => {
  const nameInput = document.getElementById("newProfileName");
  const name = nameInput.value.trim();
  if (!name) return log("Enter a profile name first.");
  try {
    const data = await window.api.createProfile({ name });
    const newProfile = data.profiles[data.profiles.length - 1];
    nameInput.value = "";
    await refreshProfiles(newProfile.id);
    log(`Created profile "${name}".`);
  } catch (err) {
    log(`Error creating profile: ${err.message}`);
  }
});

document.getElementById("deleteProfileBtn").addEventListener("click", async () => {
  if (!currentProfileId) return log("Select a profile first.");
  try {
    await window.api.deleteProfile({ profileId: currentProfileId });
    await refreshProfiles();
    log("Profile deleted.");
  } catch (err) {
    log(`Error deleting profile: ${err.message}`);
  }
});

document.getElementById("addFilesToProfileBtn").addEventListener("click", async () => {
  if (!currentProfileId) return log("Select a profile first.");
  const picked = await window.api.pickTemplates();
  if (!picked.length) return;
  try {
    const data = await window.api.addFilesToProfile({ profileId: currentProfileId, filePaths: picked });
    profiles = data.profiles;
    renderProfileFiles();
    log(`Added ${picked.length} file(s) to profile (copied into the app's profile storage).`);
  } catch (err) {
    log(`Error adding files: ${err.message}`);
  }
});

document.getElementById("revealProfilesBtn").addEventListener("click", async () => {
  await window.api.revealProfilesFolder();
  log("Opened the profiles folder in Finder -- zip it to share with your team.");
});

document.getElementById("importProfilesBtn").addEventListener("click", async () => {
  try {
    log("Importing shared profiles folder...");
    await window.api.importProfilesFolder();
    await refreshProfiles();
    log("Import complete.");
  } catch (err) {
    log(`Error importing profiles: ${err.message}`);
  }
});

async function openLayerConfig(relativePath) {
  currentConfigRelativePath = relativePath;
  try {
    const absolutePath = await window.api.resolveProfileFile({ relativePath });
    log(`Scanning ${relativePath.split("/").pop()} for layer configuration...`);
    const profile = getCurrentProfile();
    const fileEntry = profile.files.find((f) => f.relativePath === relativePath);
    const savedLayers = fileEntry ? fileEntry.layers || [] : [];

    const result = await window.api.scanTemplate(absolutePath);
    const isIllustrator = absolutePath.toLowerCase().endsWith(".ai");

    const scanned = isIllustrator
      ? (result.items || []).map((it) => ({
          label: `${it.type}${it.name ? ": " + it.name : " (unnamed)"}`,
          layerName: it.name,
          index: it.index
        }))
      : (result.layers || []).map((name) => ({ label: name, layerName: name, index: null }));

    // Merge: preserve previously saved role/defaults for layers that still match.
    currentConfigLayers = scanned.map((s) => {
      const saved = savedLayers.find((sv) => (isIllustrator ? sv.index === s.index : sv.layerName === s.layerName));
      return {
        label: s.label,
        layerName: s.layerName,
        index: s.index,
        role: saved ? saved.role || "" : "",
        scalePercent: saved && saved.defaults && saved.defaults.scalePercent != null ? saved.defaults.scalePercent : 100,
        spacing: saved && saved.defaults && saved.defaults.spacing != null ? saved.defaults.spacing : 20,
        color: saved && saved.defaults && saved.defaults.color ? saved.defaults.color : "#ff0000"
      };
    });

    renderLayerConfig(relativePath);
    document.getElementById("layerConfigArea").style.display = "block";
    log("Scan complete -- assign roles below, then Save Layer Config.");
  } catch (err) {
    log(`Error scanning file: ${err.message}`);
  }
}

function renderLayerConfig(relativePath) {
  document.getElementById("layerConfigTitle").textContent = `Configure Layers: ${relativePath.split("/").pop()}`;
  const list = document.getElementById("layerConfigList");
  list.innerHTML = "";

  currentConfigLayers.forEach((row, i) => {
    const li = document.createElement("li");
    li.style.flexDirection = "column";
    li.style.alignItems = "flex-start";
    li.style.gap = "4px";

    const topRow = document.createElement("div");
    topRow.className = "row";
    topRow.innerHTML = `<span class="path" style="min-width:220px;">${row.label}</span>`;

    const roleSelect = document.createElement("select");
    Object.keys(ROLE_LABELS).forEach((key) => {
      const opt = document.createElement("option");
      opt.value = key;
      opt.textContent = ROLE_LABELS[key];
      if (key === row.role) opt.selected = true;
      roleSelect.appendChild(opt);
    });
    roleSelect.addEventListener("change", () => {
      currentConfigLayers[i].role = roleSelect.value;
      renderLayerConfig(relativePath);
    });
    topRow.appendChild(roleSelect);
    li.appendChild(topRow);

    if (row.role === "logo" || row.role === "ledBanner") {
      const scaleRow = document.createElement("div");
      scaleRow.className = "row";
      scaleRow.innerHTML = `<span class="path">Default scale %:</span>`;
      const scaleInput = document.createElement("input");
      scaleInput.type = "number";
      scaleInput.min = "10";
      scaleInput.max = "300";
      scaleInput.value = row.scalePercent;
      scaleInput.style.width = "70px";
      scaleInput.addEventListener("change", () => {
        currentConfigLayers[i].scalePercent = parseFloat(scaleInput.value) || 100;
      });
      scaleRow.appendChild(scaleInput);
      li.appendChild(scaleRow);
    }

    if (row.role === "ledBanner") {
      const spacingRow = document.createElement("div");
      spacingRow.className = "row";
      spacingRow.innerHTML = `<span class="path">Default spacing (px, between multiple logos):</span>`;
      const spacingInput = document.createElement("input");
      spacingInput.type = "number";
      spacingInput.min = "0";
      spacingInput.value = row.spacing;
      spacingInput.style.width = "70px";
      spacingInput.addEventListener("change", () => {
        currentConfigLayers[i].spacing = parseFloat(spacingInput.value) || 0;
      });
      spacingRow.appendChild(spacingInput);
      li.appendChild(spacingRow);

      const colorRow = document.createElement("div");
      colorRow.className = "row";
      colorRow.innerHTML = `<span class="path">Default background colour:</span>`;
      const colorInput = document.createElement("input");
      colorInput.type = "color";
      colorInput.value = row.color;
      colorInput.addEventListener("change", () => {
        currentConfigLayers[i].color = colorInput.value;
      });
      colorRow.appendChild(colorInput);
      li.appendChild(colorRow);
    }

    list.appendChild(li);
  });
}

document.getElementById("rescanBtn").addEventListener("click", () => {
  if (currentConfigRelativePath) openLayerConfig(currentConfigRelativePath);
});

document.getElementById("closeLayerConfigBtn").addEventListener("click", () => {
  document.getElementById("layerConfigArea").style.display = "none";
  currentConfigRelativePath = null;
});

document.getElementById("saveLayerConfigBtn").addEventListener("click", async () => {
  if (!currentProfileId || !currentConfigRelativePath) return;
  const layersToSave = currentConfigLayers
    .filter((r) => r.role)
    .map((r) => ({
      layerName: r.layerName,
      index: r.index,
      role: r.role,
      defaults:
        r.role === "ledBanner"
          ? { scalePercent: r.scalePercent, spacing: r.spacing, color: r.color }
          : { scalePercent: r.scalePercent }
    }));

  try {
    const data = await window.api.saveFileLayers({
      profileId: currentProfileId,
      relativePath: currentConfigRelativePath,
      layers: layersToSave
    });
    profiles = data.profiles;
    renderProfileFiles();
    log(`Saved layer configuration for ${currentConfigRelativePath.split("/").pop()}.`);
  } catch (err) {
    log(`Error saving layer config: ${err.message}`);
  }
});

// Load saved profiles as soon as the app starts.
refreshProfiles();
