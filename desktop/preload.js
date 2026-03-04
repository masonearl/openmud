/**
 * Preload script - exposes safe APIs to the renderer (web app).
 * Used for Open Folder and other desktop-only features.
 */
const { contextBridge, ipcRenderer } = require('electron');

const desktopBridge = {
  openFolder:      () => ipcRenderer.invoke('mudrag:open-folder'),
  openMail:        (opts) => ipcRenderer.invoke('mudrag:open-mail', opts),
  importMailAttachments: (opts) => ipcRenderer.invoke('mudrag:import-mail-attachments', opts),
  openExternal:    (url) => ipcRenderer.invoke('mudrag:open-external', url),
  openChatWindow:  (projectId, chatId) => ipcRenderer.invoke('mudrag:open-chat-window', { projectId, chatId }),
  installOllama:   () => ipcRenderer.invoke('mudrag:install-ollama'),
  ollamaStatus:    () => ipcRenderer.invoke('mudrag:ollama-status'),
  ollamaPullModel: () => ipcRenderer.invoke('mudrag:ollama-pull-model'),
  installUpdate:   () => ipcRenderer.invoke('mudrag:install-update'),
  checkUpdateManual: () => ipcRenderer.invoke('mudrag:check-update-manual'),
  openDocSource:   (htmlPath) => ipcRenderer.invoke('mudrag:open-doc-source', htmlPath),
  openDocFolder:   (folderPath) => ipcRenderer.invoke('mudrag:open-doc-folder', folderPath),
  readTemplateSource: (docType) => ipcRenderer.invoke('mudrag:read-template-source', docType),
  editDoc:         (opts) => ipcRenderer.invoke('mudrag:edit-doc', opts),
  bidWatchAdd:     (criteria) => ipcRenderer.invoke('mudrag:bid-watch-add', criteria),
  bidWatchRemove:  (id) => ipcRenderer.invoke('mudrag:bid-watch-remove', id),
  bidWatchList:    () => ipcRenderer.invoke('mudrag:bid-watch-list'),
  bidWatchCheckNow: () => ipcRenderer.invoke('mudrag:bid-watch-check-now'),
  onSystem:        (cb) => {
    ipcRenderer.on('mudrag:system', (_, data) => cb(data));
    return () => ipcRenderer.removeAllListeners('mudrag:system');
  },
  onAuthCallback:  (cb) => {
    ipcRenderer.on('mudrag:auth-callback', (_, data) => cb(data));
    return () => ipcRenderer.removeAllListeners('mudrag:auth-callback');
  },
  onUpdateAvailable: (cb) => {
    ipcRenderer.on('mudrag:update-available', (_, data) => cb(data));
    return () => ipcRenderer.removeAllListeners('mudrag:update-available');
  },
  onUpdateProgress: (cb) => {
    ipcRenderer.on('mudrag:update-progress', (_, data) => cb(data));
    return () => ipcRenderer.removeAllListeners('mudrag:update-progress');
  },
  isDesktop: true,
  udotScan:       (opts) => ipcRenderer.invoke('mudrag:udot-scan', opts),
  scanLocalFiles: (opts) => ipcRenderer.invoke('mudrag:scan-local-files', opts),
  readLocalFile:  (filePath) => ipcRenderer.invoke('mudrag:read-local-file', filePath),
};

// Keep both names during transition to avoid breaking existing renderer code.
contextBridge.exposeInMainWorld('mudragDesktop', desktopBridge);
contextBridge.exposeInMainWorld('openmudDesktop', desktopBridge);
