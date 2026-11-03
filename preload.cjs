const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("assetVault", {
  getLibrary: () => ipcRenderer.invoke("library:get"),
  addProject: () => ipcRenderer.invoke("project:add"),
  scanParentFolder: () => ipcRenderer.invoke("project:scan-parent"),
  cloneGithub: (url) => ipcRenderer.invoke("project:clone-github", url),
  removeProject: (projectId) => ipcRenderer.invoke("project:remove", projectId),
  updateMetadata: (filePath, metadata) => ipcRenderer.invoke("asset:metadata", filePath, metadata),
  readText: (filePath) => ipcRenderer.invoke("asset:text", filePath),
  getAssetUrl: (filePath) => ipcRenderer.invoke("asset:url", filePath),
  getModelPreviewUrl: (filePath) => ipcRenderer.invoke("asset:model-preview", filePath),
  chooseBlender: () => ipcRenderer.invoke("settings:choose-blender"),
});
