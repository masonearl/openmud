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
  downloadUpdate:  () => ipcRenderer.invoke('mudrag:download-update'),
  getUpdateState:  () => ipcRenderer.invoke('mudrag:get-update-state'),
  getUpdatePreferences: () => ipcRenderer.invoke('mudrag:get-update-preferences'),
  setUpdatePreferences: (prefs) => ipcRenderer.invoke('mudrag:set-update-preferences', prefs),
  openDocSource:   (htmlPath) => ipcRenderer.invoke('mudrag:open-doc-source', htmlPath),
  openDocFolder:   (folderPath) => ipcRenderer.invoke('mudrag:open-doc-folder', folderPath),
  readTemplateSource: (docType) => ipcRenderer.invoke('mudrag:read-template-source', docType),
  editDoc:         (opts) => ipcRenderer.invoke('mudrag:edit-doc', opts),
  desktopSyncSetup: (opts) => ipcRenderer.invoke('mudrag:desktop-sync-setup', opts),
  desktopSyncProject: (opts) => ipcRenderer.invoke('mudrag:desktop-sync-project', opts),
  desktopSyncRemoveProject: (projectId) => ipcRenderer.invoke('mudrag:desktop-sync-remove-project', projectId),
  desktopSyncStatus: (opts) => ipcRenderer.invoke('mudrag:desktop-sync-status', opts),
  desktopSyncChooseRoot: () => ipcRenderer.invoke('mudrag:desktop-sync-choose-root'),
  desktopSyncOpenRoot: () => ipcRenderer.invoke('mudrag:desktop-sync-open-root'),
  desktopSyncListFiles: (opts) => ipcRenderer.invoke('mudrag:desktop-sync-list-files', opts),
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
  onUpdateState: (cb) => {
    ipcRenderer.on('mudrag:update-state', (_, data) => cb(data));
    return () => ipcRenderer.removeAllListeners('mudrag:update-state');
  },
  onDesktopSync: (cb) => {
    ipcRenderer.on('mudrag:desktop-sync', (_, data) => cb(data));
    return () => ipcRenderer.removeAllListeners('mudrag:desktop-sync');
  },
  isDesktop: true,
  udotScan:       (opts) => ipcRenderer.invoke('mudrag:udot-scan', opts),
  scanLocalFiles: (opts) => ipcRenderer.invoke('mudrag:scan-local-files', opts),
  readLocalFile:  (filePath) => ipcRenderer.invoke('mudrag:read-local-file', filePath),
};

// Keep both names during transition to avoid breaking existing renderer code.
contextBridge.exposeInMainWorld('mudragDesktop', desktopBridge);
contextBridge.exposeInMainWorld('openmudDesktop', desktopBridge);
