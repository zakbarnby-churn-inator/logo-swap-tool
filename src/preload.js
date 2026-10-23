const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  pickTemplates: () => ipcRenderer.invoke("pick-templates"),
  pickLogo: () => ipcRenderer.invoke("pick-logo"),
  pickOutputDir: () => ipcRenderer.invoke("pick-output-dir"),
  scanTemplate: (templatePath) => ipcRenderer.invoke("scan-template", templatePath),
  renameLayer: (args) => ipcRenderer.invoke("rename-layer", args),
  runSwap: (args) => ipcRenderer.invoke("run-swap", args),
  runPreview: (args) => ipcRenderer.invoke("run-preview", args),
  getProfiles: () => ipcRenderer.invoke("get-profiles"),
  createProfile: (args) => ipcRenderer.invoke("create-profile", args),
  deleteProfile: (args) => ipcRenderer.invoke("delete-profile", args),
  addFilesToProfile: (args) => ipcRenderer.invoke("add-files-to-profile", args),
  removeFileFromProfile: (args) => ipcRenderer.invoke("remove-file-from-profile", args),
  saveFileLayers: (args) => ipcRenderer.invoke("save-file-layers", args),
  resolveProfileFile: (args) => ipcRenderer.invoke("resolve-profile-file", args),
  revealProfilesFolder: () => ipcRenderer.invoke("reveal-profiles-folder"),
  importProfilesFolder: () => ipcRenderer.invoke("import-profiles-folder")
});
