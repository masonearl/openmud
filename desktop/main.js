// Suppress CSP warning in dev (Electron docs: warning doesn't appear when packaged)
if (process.env.DEV === '1' || process.env.NODE_ENV === 'development') {
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';
}
const { app, BrowserWindow, shell, dialog, Menu, ipcMain } = require('electron');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const isDev = process.env.DEV === '1' || process.env.NODE_ENV === 'development';

// openmud:// URL scheme: register early (macOS emits open-url before ready)
if (!app.isPackaged && process.argv.length >= 2) {
  app.setAsDefaultProtocolClient('openmud', process.execPath, [path.resolve(process.argv[1])]);
  // Keep legacy scheme so old links keep working during migration.
  app.setAsDefaultProtocolClient('mudrag', process.execPath, [path.resolve(process.argv[1])]);
} else if (app.isPackaged) {
  app.setAsDefaultProtocolClient('openmud');
  app.setAsDefaultProtocolClient('mudrag');
}
function handleDeepLink(url) {
  if (!url) return;
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'auth') {
      const accessToken = parsed.searchParams.get('access_token');
      const refreshToken = parsed.searchParams.get('refresh_token');
      if (accessToken && refreshToken) {
        pendingAuthCallback = { access_token: accessToken, refresh_token: refreshToken };
        flushPendingAuthCallback();
      }
    } else {
      const rawPath = ((parsed.hostname && parsed.hostname !== 'openmud') ? ('/' + parsed.hostname) : '') + (parsed.pathname || '');
      const safePath = rawPath && rawPath !== '/' ? rawPath : '/try';
      const port = activeToolPort || TOOL_SERVER_PORT;
      const targetUrl = `http://127.0.0.1:${port}${safePath}${parsed.search || ''}${parsed.hash || ''}`;
      if (mainWindowRef && !mainWindowRef.isDestroyed()) {
        mainWindowRef.loadURL(targetUrl).catch(() => {});
      }
    }
  } catch (e) {
    // not a parseable URL, ignore
  }
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.focus();
  }
}

app.on('open-url', (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

let mainWindowRef = null;
let activeToolPort = null;
let pendingAuthCallback = null;
const pendingDesktopAuthHandoffs = new Map();
const TOOL_SERVER_ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/(?:www\.)?openmud\.ai$/,
  /^https:\/\/openmud-[a-z0-9-]+\.vercel\.app$/,
  /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/,
];
const desktopAuthAttemptState = {
  startByIp: new Map(),
  completeByIp: new Map(),
  completeByRequest: new Map(),
};

function isAllowedToolServerOrigin(origin) {
  const normalizedOrigin = String(origin || '').trim();
  if (!normalizedOrigin) return false;
  return TOOL_SERVER_ALLOWED_ORIGIN_PATTERNS.some((pattern) => pattern.test(normalizedOrigin));
}

function applyToolServerCors(req, res) {
  const origin = String(req.headers.origin || '').trim();
  if (isAllowedToolServerOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function getToolServerClientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket?.remoteAddress || 'unknown';
}

function consumeRateLimit(map, key, limit, windowMs) {
  const normalizedKey = String(key || '').trim();
  if (!normalizedKey) return { ok: true, retryAfterMs: 0 };
  const now = Date.now();
  const existing = map.get(normalizedKey);
  const entry = (!existing || existing.resetAt <= now)
    ? { count: 0, resetAt: now + windowMs }
    : existing;
  if (entry.count >= limit) {
    map.set(normalizedKey, entry);
    return { ok: false, retryAfterMs: Math.max(0, entry.resetAt - now) };
  }
  entry.count += 1;
  map.set(normalizedKey, entry);
  return { ok: true, retryAfterMs: 0 };
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function flushPendingAuthCallback() {
  if (!pendingAuthCallback || !mainWindowRef || mainWindowRef.isDestroyed()) return;
  try {
    mainWindowRef.webContents.send('mudrag:auth-callback', pendingAuthCallback);
    pendingAuthCallback = null;
  } catch (err) {}
}

function cleanupExpiredDesktopAuthHandoffs() {
  const now = Date.now();
  pendingDesktopAuthHandoffs.forEach((value, key) => {
    if (!value || value.expiresAt <= now) pendingDesktopAuthHandoffs.delete(key);
  });
}

function createDesktopAuthHandoff(opts = {}) {
  cleanupExpiredDesktopAuthHandoffs();
  const requestId = crypto.randomUUID();
  const expiresAt = Date.now() + (5 * 60 * 1000);
  pendingDesktopAuthHandoffs.set(requestId, {
    requestId,
    nextPath: opts.nextPath || '/try',
    expiresAt,
  });
  return {
    ok: true,
    requestId,
    port: activeToolPort || TOOL_SERVER_PORT,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

function completeDesktopAuthHandoff(requestId, tokens) {
  cleanupExpiredDesktopAuthHandoffs();
  const handoff = pendingDesktopAuthHandoffs.get(requestId);
  if (!handoff) return { ok: false, error: 'Desktop auth request not found or expired.' };
  pendingDesktopAuthHandoffs.delete(requestId);
  const accessToken = tokens && tokens.access_token;
  const refreshToken = tokens && tokens.refresh_token;
  if (!accessToken || !refreshToken) return { ok: false, error: 'Missing auth tokens.' };
  pendingAuthCallback = { access_token: accessToken, refresh_token: refreshToken };
  flushPendingAuthCallback();
  return {
    ok: true,
    nextPath: handoff.nextPath || '/try',
    deliveredAt: new Date().toISOString(),
  };
}

// Dev: reload window when web files change (no full restart)
if (isDev) {
  try {
    const chokidar = require('chokidar');
    const webPath = path.resolve(__dirname, '..', 'web');
    let reloadTimer = null;
    const watcher = chokidar.watch(webPath, {
      ignored: /node_modules|\.git/,
      awaitWriteFinish: { stabilityThreshold: 200 },
    });
    watcher.on('change', (p) => {
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        if (mainWindowRef && !mainWindowRef.isDestroyed()) {
          console.log('[dev] web changed, reloading:', p);
          mainWindowRef.webContents.reloadIgnoringCache();
        }
      }, 100);
    });
  } catch (e) { console.error('[dev] chokidar failed:', e.message); }
}
const https = require('https');
const { spawn } = require('child_process');
const { autoUpdater } = require('electron-updater');

const TOOL_SERVER_PORT = 3847;
const storage = require('./storage');
const bidFinder = require('./bid-finder');
const dataSync = require('./data-sync');
const bidWatcher = require('./bid-watcher');
const { extractMailAttachments } = require('./mail-attachments');
const {
  FILE_MANAGEMENT_INTENT,
  CREATE_CSV_INTENT,
  HCSS_EXPORT_INTENT,
  BID2WIN_EXPORT_INTENT,
  normalizeUserIntentText,
  arbitrateCoreIntent,
} = require('./intent-router');
const OLLAMA_BASE = 'http://127.0.0.1:11434';
const fs = require('fs');
const { scrapeUDOT, parseContractorPayments, aggregateByContractor } = require('./udot-scraper');
const { scanLocalFiles, readFileForImport } = require('./file-scanner');
const DESKTOP_SYNC_FOLDER_NAME = 'Openmud';
const desktopSyncState = {
  rootPath: '',
  watcher: null,
  eventTimers: {},
  ignoreUntil: 0,
};

function slugifyProjectName(name) {
  const cleaned = String(name || 'Project')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'Project';
}

function ensureDirSync(dirPath) {
  if (!dirPath) return;
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function getDefaultDesktopSyncRoot() {
  return path.join(app.getPath('desktop'), DESKTOP_SYNC_FOLDER_NAME);
}

function getDesktopSyncConfig() {
  const userData = storage.getUserData() || {};
  const cfg = userData.desktopSync || {};
  return {
    rootPath: cfg.rootPath || '',
    projects: cfg.projects || {},
    enabled: cfg.enabled !== false,
    lastSyncAt: cfg.lastSyncAt || null,
  };
}

function setDesktopSyncConfig(next) {
  const current = getDesktopSyncConfig();
  const replaceProjects = !!(next && next.replaceProjects);
  const merged = {
    ...current,
    ...(next || {}),
    projects: replaceProjects
      ? { ...((next && next.projects) || {}) }
      : {
        ...(current.projects || {}),
        ...((next && next.projects) || {}),
      },
  };
  delete merged.replaceProjects;
  storage.setUserData({ desktopSync: merged });
  return merged;
}

function getProjectSyncDir(projectId, projectName, rootPath) {
  const cfg = getDesktopSyncConfig();
  const baseRoot = rootPath || cfg.rootPath || getDefaultDesktopSyncRoot();
  const byId = cfg.projects && cfg.projects[projectId];
  if (byId && byId.path) return byId.path;
  return path.join(baseRoot, slugifyProjectName(projectName));
}

function listRelativeFilesRecursive(rootDir, baseDir, bucket) {
  const target = rootDir || '';
  if (!target || !fs.existsSync(target)) return;
  let entries = [];
  try {
    entries = fs.readdirSync(target, { withFileTypes: true });
  } catch (err) {
    return;
  }
  entries.forEach((entry) => {
    if (!entry || entry.name.startsWith('.')) return;
    const absPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      listRelativeFilesRecursive(absPath, baseDir, bucket);
      return;
    }
    let stat = null;
    try {
      stat = fs.statSync(absPath);
    } catch (err) {
      stat = null;
    }
    bucket.push({
      path: absPath,
      name: entry.name,
      relativePath: path.relative(baseDir, absPath),
      size: stat ? stat.size : 0,
      modifiedAt: stat ? stat.mtime.toISOString() : null,
    });
  });
}

function ensureProjectFolders(projectDir, folders) {
  ensureDirSync(projectDir);
  (folders || []).forEach((folder) => {
    const rel = String(folder && folder.relativePath || '').replace(/^\/+|\/+$/g, '');
    if (!rel) return;
    ensureDirSync(path.join(projectDir, rel));
  });
}

function suspendDesktopSyncWatcher(ms) {
  desktopSyncState.ignoreUntil = Math.max(desktopSyncState.ignoreUntil || 0, Date.now() + (ms || 0));
}

function pruneEmptyDirs(rootDir) {
  if (!rootDir || !fs.existsSync(rootDir)) return;
  let entries = [];
  try {
    entries = fs.readdirSync(rootDir, { withFileTypes: true });
  } catch (err) {
    return;
  }
  entries.forEach((entry) => {
    if (!entry.isDirectory()) return;
    const absPath = path.join(rootDir, entry.name);
    pruneEmptyDirs(absPath);
    try {
      if (fs.readdirSync(absPath).length === 0) fs.rmdirSync(absPath);
    } catch (err) {}
  });
}

function emitDesktopSyncEvent(data) {
  const windows = BrowserWindow.getAllWindows();
  windows.forEach((win) => {
    if (win && !win.isDestroyed()) win.webContents.send('mudrag:desktop-sync', data);
  });
}

function scheduleDesktopSyncEvent(projectId, projectPath, reason) {
  const key = String(projectId || projectPath || 'desktop-sync');
  clearTimeout(desktopSyncState.eventTimers[key]);
  desktopSyncState.eventTimers[key] = setTimeout(() => {
    emitDesktopSyncEvent({ type: 'project-changed', projectId, projectPath, reason: reason || 'fswatch' });
    delete desktopSyncState.eventTimers[key];
  }, 700);
}

function startDesktopSyncWatcher(rootPath) {
  const targetRoot = rootPath || getDesktopSyncConfig().rootPath;
  if (!targetRoot) return;
  ensureDirSync(targetRoot);
  if (desktopSyncState.watcher) {
    try { desktopSyncState.watcher.close(); } catch (err) {}
  }
  desktopSyncState.rootPath = targetRoot;
  try {
    desktopSyncState.watcher = fs.watch(targetRoot, { recursive: true }, (_eventType, filename) => {
      if (desktopSyncState.ignoreUntil && Date.now() < desktopSyncState.ignoreUntil) return;
      const rel = String(filename || '').replace(/\\/g, '/').trim();
      if (!rel || rel.startsWith('.')) return;
      const projectName = rel.split('/')[0];
      const cfg = getDesktopSyncConfig();
      const projectEntries = Object.entries(cfg.projects || {});
      const match = projectEntries.find(([, meta]) => {
        const projectPath = String(meta && meta.path || '').replace(/\\/g, '/');
        return projectPath && projectPath.endsWith('/' + projectName);
      });
      const projectId = match ? match[0] : null;
      const projectPath = match && match[1] ? match[1].path : path.join(targetRoot, projectName);
      scheduleDesktopSyncEvent(projectId, projectPath, 'desktop-change');
    });
  } catch (err) {
    desktopSyncState.watcher = null;
  }
}

function writeProjectSnapshotToDesktop(opts) {
  const payload = opts || {};
  if (!payload.projectId || !payload.projectName) return { ok: false, error: 'projectId and projectName are required.' };
  const cfg = getDesktopSyncConfig();
  const rootPath = payload.rootPath || cfg.rootPath || getDefaultDesktopSyncRoot();
  ensureDirSync(rootPath);
  const desiredDir = path.join(rootPath, slugifyProjectName(payload.projectName));
  const currentMeta = cfg.projects[payload.projectId] || {};
  const previousDir = currentMeta.path;
  if (previousDir && previousDir !== desiredDir && fs.existsSync(previousDir) && !fs.existsSync(desiredDir)) {
    try { fs.renameSync(previousDir, desiredDir); } catch (err) {}
  }
  ensureProjectFolders(desiredDir, payload.folders || []);
  suspendDesktopSyncWatcher(4000);
  (payload.files || []).forEach((file) => {
    const relPath = String(file && file.relativePath || '').replace(/^\/+/, '').replace(/\\/g, '/');
    if (!relPath || !file.base64) return;
    const targetPath = path.join(desiredDir, relPath);
    ensureDirSync(path.dirname(targetPath));
    try {
      fs.writeFileSync(targetPath, Buffer.from(String(file.base64), 'base64'));
    } catch (err) {}
  });
  pruneEmptyDirs(desiredDir);
  const nextProjects = {};
  nextProjects[payload.projectId] = {
    path: desiredDir,
    name: payload.projectName,
    lastSyncAt: new Date().toISOString(),
  };
  setDesktopSyncConfig({
    rootPath,
    enabled: true,
    lastSyncAt: new Date().toISOString(),
    projects: nextProjects,
  });
  startDesktopSyncWatcher(rootPath);
  return { ok: true, rootPath, projectPath: desiredDir };
}

function getWebPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'web');
  }
  return path.join(__dirname, '..', 'web');
}

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'tinyllama';
const DEFAULT_EMAIL_ACCOUNTS = (process.env.OPENMUD_EMAIL_ACCOUNTS || 'you@company.com')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const UPDATE_PREFS_DEFAULTS = Object.freeze({
  autoCheckForUpdates: true,
  autoDownloadUpdates: true,
  installUpdatesOnQuit: true,
});

function getToolsPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'tools', 'desktop');
  }
  return path.join(__dirname, '..', 'tools', 'desktop');
}

const CONSTRUCTION_TOOLS = ['calculate_material_cost', 'calculate_labor_cost', 'calculate_equipment_cost', 'estimate_project_cost'];
const SCHEDULE_TOOLS = ['build_schedule'];
const DOCUMENT_TOOLS = ['export_estimate_csv', 'export_estimate_pdf', 'export_proposal_pdf', 'export_bid_pdf', 'html_to_pdf', 'md_to_pdf', 'generate_resume_pdf', 'generate_pm_doc', 'extract_bid_items', 'render_document', 'read_template_source', 'update_template_source', 'generate_diagram'];
const PM_WORKFLOW_TOOLS = ['manage_rfi_workflow', 'manage_submittal_workflow', 'autofill_daily_report', 'manage_change_order_workflow', 'manage_pay_app_workflow'];
const MAIL_TOOLS = ['search_mail'];
const RUNNER_TOOLS = [...CONSTRUCTION_TOOLS, ...SCHEDULE_TOOLS, ...DOCUMENT_TOOLS, ...PM_WORKFLOW_TOOLS, ...MAIL_TOOLS];
const AGENTIC_EXPORT_TOOLS = ['export_estimate_csv', 'export_estimate_pdf', 'export_bid_pdf'];

// ── Agentic Tool Loop ─────────────────────────────────────────────────────────
// Tool names for local execution routing (schemas live on the backend)
// see web/api/agentic-step.js

const AGENTIC_STEP_URL = 'https://openmud.ai/api/agentic-step';

function emitAgenticProgress(text, done = false) {
  if (!mainWindowRef || mainWindowRef.isDestroyed()) return;
  mainWindowRef.webContents.send('mudrag:system', { type: 'agentic-progress', text, done: !!done });
}

/**
 * Agentic tool loop: calls backend /api/agentic-step for each LLM decision,
 * executes tools locally (file system, Mail.app, etc.), then loops.
 * API key lives on the server — never in the Electron app.
 * Hard cap at 8 steps. Returns { response, tools_used }.
 */
async function agenticToolLoop(messages, userText, authToken) {
  if (!authToken) return null; // requires auth for usage limits

  emitAgenticProgress('Starting agent workflow…');
  const toolsUsed = [];

  // Convert incoming messages to Claude format
  const claudeMessages = messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({ role: m.role, content: String(m.content || '') }));

  let iterations = 0;
  const MAX_STEPS = 8;
  const buildDefaultExportPath = (toolName, projectName) => {
    const os = require('os');
    const ts = new Date().toISOString().slice(0, 10);
    const safeProject = String(projectName || 'Estimate').replace(/[^a-zA-Z0-9-_]/g, '_');
    const ext = toolName === 'export_estimate_csv' ? 'csv' : 'pdf';
    return path.join(os.homedir(), 'Desktop', `${safeProject}-${ts}.${ext}`);
  };

  try {
    while (iterations < MAX_STEPS) {
      iterations++;
      emitAgenticProgress(`Planning step ${iterations}…`);

      // Ask the backend for the next step (key check, usage gate, Claude call all happen server-side)
      let stepData;
      try {
        const stepRes = await fetch(AGENTIC_STEP_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`,
            'X-openmud-Source': 'desktop',
          },
          body: JSON.stringify({ messages: claudeMessages }),
          signal: AbortSignal.timeout(30000),
        });
        if (stepRes.status === 429) {
          const d = await stepRes.json().catch(() => ({}));
          return { response: d.error || 'Daily limit reached. Upgrade at openmud.ai/subscribe.html', tools_used: toolsUsed };
        }
        if (stepRes.status === 401) return null; // not signed in — fall through to other handlers
        if (!stepRes.ok) return null;
        stepData = await stepRes.json();
      } catch (e) {
        console.warn('[agentic loop] backend step failed:', e.message);
        return null;
      }

      const { stop_reason, text, tool_calls, content } = stepData;

      // Add the assistant's full content blocks to the conversation
      if (content && content.length > 0) {
        claudeMessages.push({ role: 'assistant', content });
      } else if (text) {
        claudeMessages.push({ role: 'assistant', content: text });
      }

      // If no tool calls or done, return the text
      if (!tool_calls || tool_calls.length === 0 || stop_reason === 'end_turn') {
        emitAgenticProgress('Done.', true);
        if (text && text.trim()) {
          return { response: text.trim(), tools_used: toolsUsed };
        }
        return null;
      }

      // Execute each tool locally and collect results
      const toolResults = [];
      for (const call of tool_calls) {
        toolsUsed.push(call.name);
        emitAgenticProgress(`Running ${call.name.replace(/_/g, ' ')}…`);
        let result;
        try {
          const params = { ...(call.input || {}) };
          // Merge saved user rates for construction tools
          if (CONSTRUCTION_TOOLS.includes(call.name)) {
            try {
              const rates = storage.getRates();
              if (!params.rates) params.rates = { labor: rates.labor, equipment: rates.equipment };
            } catch (_) {}
          }

          if (call.name === 'find_work') {
            const inferred = parseWorkFinderIntent(String(userText || ''));
            const trade = params.trade || inferred.trade || null;
            const location = params.location || inferred.location || null;
            const [emailBids, webResults] = await Promise.all([
              searchEmailBids(trade).catch(() => []),
              bidFinder.findBids(trade, location, process.env.SAM_GOV_API_KEY || null).catch(() => ({ bids: [], sources: {}, warnings: [] })),
            ]);
            result = {
              trade,
              location,
              email_bids: emailBids,
              web_bids: webResults.bids || [],
              sources: webResults.sources || {},
              warnings: webResults.warnings || [],
              searched_at: new Date().toISOString(),
            };
          } else {
            if (AGENTIC_EXPORT_TOOLS.includes(call.name)) {
              const estimateData = params.estimate_data || lastEstimateData;
              if (!estimateData) {
                result = { error: 'No active estimate found. Run estimate_project_cost first before exporting.' };
              } else {
                params.estimate_data = estimateData;
                if (!params.project_name) params.project_name = 'Estimate';
                if (!params.output_path) params.output_path = buildDefaultExportPath(call.name, params.project_name);
                if (call.name === 'export_bid_pdf') {
                  params.line_items = estimateDataToLineItems(estimateData);
                  params.direct_cost = estimateData.subtotal || 0;
                  params.contingency = params.contingency || 0;
                  params.profit = estimateData.overhead_profit || 0;
                  params.total = estimateData.total || 0;
                }
              }
            }
            if (!result) {
              result = await runDesktopToolAsync(call.name, params);
            }
          }

          if (call.name === 'estimate_project_cost' && result && !result.error) {
            setLastEstimateData(result);
          }
        } catch (e) {
          result = { error: e.message };
        }
        toolResults.push({ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(result).slice(0, 8000) });
      }

      // Feed tool results back into conversation for next iteration
      claudeMessages.push({ role: 'user', content: toolResults });
    }
  } finally {
    emitAgenticProgress('', true);
  }

  return null;
}

/**
 * Detect if the user's message is complex enough to warrant the agentic loop.
 * Returns true for multi-step requests that single-tool intent detection can't handle.
 */
function needsAgenticLoop(userText) {
  const t = (userText || '').toLowerCase();
  // Multi-step bid/package requests
  if (/\b(build|create|put\s+together|prepare)\b.{0,30}\b(bid\s+package|full\s+bid|complete\s+bid)\b/i.test(t)) return true;
  // Requests combining multiple deliverables
  if (/\bestimate\b.*\b(and|then|also)\b.*\b(schedule|proposal|pdf)\b/i.test(t)) return true;
  if (/\b(proposal|schedule)\b.*\b(and|then|also)\b.*\b(estimate|pdf|csv)\b/i.test(t)) return true;
  // Generic "do everything" requests
  if (/\b(everything|full\s+package|complete\s+package|all\s+the\s+documents)\b/i.test(t)) return true;
  return false;
}

let lastEstimateData = null;
let lastResumePath = null;

function runDesktopTool(toolName, params, cb) {
  const toolsPath = getToolsPath();
  const fs = require('fs');
  const runnerPath = path.join(toolsPath, 'tool_runner.py');

  if (RUNNER_TOOLS.includes(toolName)) {
    if (!fs.existsSync(runnerPath)) {
      cb(JSON.stringify({ error: 'Construction tools not found. Reinstall the app.' }));
      return;
    }
    const mergedParams = { ...(params || {}) };
    if (CONSTRUCTION_TOOLS.includes(toolName)) {
      try {
        const rates = storage.getRates();
        if (!mergedParams.rates) mergedParams.rates = { labor: rates.labor, equipment: rates.equipment };
      } catch (e) { /* use defaults if storage fails */ }
    }
    const args = [runnerPath, toolName, JSON.stringify(mergedParams)];
    const py = spawn('python3', args, { cwd: toolsPath });
    let out = '';
    let err = '';
    py.stdout.on('data', (d) => { out += d.toString(); });
    py.stderr.on('data', (d) => { err += d.toString(); });
    py.on('error', (spawnErr) => {
      cb(JSON.stringify({ error: 'Could not start Python: ' + spawnErr.message + '. Make sure Python 3 is installed.' }));
    });
    py.on('close', (code) => {
      if (code !== 0 || code === null) {
        // tool_runner.py prints error JSON to stdout even on failure — prefer that
        try {
          const parsed = JSON.parse(out);
          if (parsed && parsed.error) {
            cb(JSON.stringify({ error: parsed.error, code }));
            return;
          }
        } catch (_) {}
        cb(JSON.stringify({ error: err || out || 'Tool failed (exit ' + code + ')', code }));
        return;
      }
      try {
        const result = JSON.parse(out || '{}');
        cb(JSON.stringify(result));
      } catch (e) {
        cb(JSON.stringify({ error: out || err || 'No output' }));
      }
    });
    return;
  }

  const runPythonTool = (scriptName, scriptParams) => {
    const scriptPath = path.join(toolsPath, scriptName);
    if (!fs.existsSync(scriptPath)) {
      cb(JSON.stringify({ error: scriptName + ' not found. Reinstall the app.' }));
      return;
    }
    const py = spawn('python3', [scriptPath, JSON.stringify(scriptParams)], { cwd: toolsPath });
    let out = '';
    let err = '';
    py.stdout.on('data', (d) => { out += d.toString(); });
    py.stderr.on('data', (d) => { err += d.toString(); });
    py.on('error', (spawnErr) => {
      cb(JSON.stringify({ error: 'Could not start Python: ' + spawnErr.message }));
    });
    py.on('close', (code) => {
      if (code !== 0 || code === null) {
        try {
          const parsed = JSON.parse(out);
          if (parsed && parsed.error) {
            cb(JSON.stringify({ error: parsed.error, code }));
            return;
          }
        } catch (_) {}
        cb(JSON.stringify({ error: err || out || 'Tool failed (exit ' + code + ')', code }));
        return;
      }
      try {
        const result = JSON.parse(out || '{}');
        cb(JSON.stringify(result));
      } catch (e) {
        cb(JSON.stringify({ error: out || err || 'No output' }));
      }
    });
  };

  if (toolName === 'add_to_calendar') {
    const text = (params && params.text) ? String(params.text).trim() : '';
    runPythonTool('add_to_calendar.py', { text });
    return;
  }
  if (toolName === 'add_reminder') {
    const text = (params && params.text) ? String(params.text).trim() : '';
    runPythonTool('add_reminder.py', { text });
    return;
  }
  if (toolName === 'quick_note') {
    const text = (params && params.text) ? String(params.text).trim() : '';
    runPythonTool('quick_note.py', { text });
    return;
  }
  if (toolName === 'weather') {
    const location = (params && params.location) ? String(params.location).trim() : '';
    const text = (params && params.text) ? String(params.text).trim() : '';
    runPythonTool('weather.py', { location: location || text });
    return;
  }
  if (toolName === 'send_email') {
    const text = (params && params.text) ? String(params.text).trim() : '';
    runPythonTool('send_email.py', { text });
    return;
  }

  const scriptPath = path.join(toolsPath, 'desktop_cleanup.py');
  if (!fs.existsSync(scriptPath)) {
    cb(JSON.stringify({ error: 'Desktop tools not found. Reinstall the app.' }));
    return;
  }
  const args = [];
  if (toolName === 'cleanup_desktop') {
    args.push(scriptPath, path.join(require('os').homedir(), 'Desktop'));
  } else if (toolName === 'cleanup_downloads') {
    args.push(scriptPath, path.join(require('os').homedir(), 'Downloads'));
  } else if (toolName === 'cleanup_folder' && params && params.path) {
    args.push(scriptPath, params.path);
  } else {
    cb(JSON.stringify({ error: 'Unknown tool: ' + toolName }));
    return;
  }
  if (params && params.dry_run) args.push('--dry');

  const py = spawn('python3', args, { cwd: toolsPath });
  let out = '';
  let err = '';
  py.stdout.on('data', (d) => { out += d.toString(); });
  py.stderr.on('data', (d) => { err += d.toString(); });
  py.on('close', (code) => {
    if (code !== 0) {
      cb(JSON.stringify({ error: err || 'Tool failed', code }));
      return;
    }
    try {
      const result = JSON.parse(out || '{}');
      cb(JSON.stringify(result));
    } catch (e) {
      cb(JSON.stringify({ moved: 0, folders: [], projects: [], errors: [out || err || 'No output'] }));
    }
  });
}

function getMud1Path() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'mud1');
  }
  return path.join(__dirname, '..', 'mud1');
}

function getMud1Prompt() {
  try {
    return require(path.join(getMud1Path(), 'prompts', 'construction.js'));
  } catch {
    return "You are mud1, openmud's AI for all of construction. Help with estimates, bids, schedules across residential, commercial, civil, and underground utility. Be concise.";
  }
}

const OLLAMA_SETUP_MSG = '';

const GREETING_RESPONSES = [
  "Hey! What can I help with?",
  "How's it going? What do you need today?",
  "What's up—got you. What can I do for you?",
  "Hey there! What do you need?",
];

function getBundledResponse(userText) {
  const t = (userText || '').toLowerCase().trim();
  if (/^(hi|hey|hello|howdy|yo|sup)\s*[!.]?$/i.test(t) || /^how\s+(are\s+you|is\s+it\s+going|you\s+doing)/i.test(t) || /^what'?s?\s*up(\s+with\s+you)?\s*[!?.]?$/i.test(t)) {
    return GREETING_RESPONSES[Math.floor(Math.random() * GREETING_RESPONSES.length)];
  }
  if (/^are\s+you\s+(there|working|ok|here)\s*[!?.]?$/i.test(t) || /^(you\s+there|anyone\s+there)\s*[!?.]?$/i.test(t)) {
    return GREETING_RESPONSES[Math.floor(Math.random() * GREETING_RESPONSES.length)];
  }
  if (/^(what|who)\s+are\s+you/i.test(t) || /what\s+is\s+mud1/i.test(t)) {
    return "I'm mud1, openmud's AI for all of construction. I help with estimates, proposals, schedules, and bidding across residential, commercial, civil, and underground utility.";
  }
  if (/^(help|what can you do)\s*[!?.]?$/i.test(t)) {
    return "I can help with: cost estimates across all of construction (residential, commercial, civil, underground utility), proposals, project schedules, and construction questions. I can also search your email (e.g. 'find the email from Granite about material pricing') and organize your desktop or downloads. Just ask in chat—e.g. 'Estimate 1500 LF of 8 inch sewer', 'help me bid a job', or 'generate a proposal'.";
  }
  return null;
}

/**
 * OpenClaw-style agentic intent detection.
 * Covers desktop/productivity tools that run directly (no Ollama needed).
 */
function detectAgenticIntent(userText) {
  const t = (userText || '').toLowerCase().trim();
  const dryRun = /\b(dry|preview|don'?t move|would you|what would)\b/i.test(t);

  // ── File system ──────────────────────────────────────────────────────────
  if (/\b(organize|clean|tidy|sort)\b.*\b(desktop|my desktop)\b/i.test(t) || /\b(desktop)\b.*\b(organize|clean|tidy|sort)\b/i.test(t)) {
    return { tool: 'cleanup_desktop', params: { dry_run: dryRun } };
  }
  if (/\b(organize|clean|tidy|sort)\b.*\b(downloads?|my downloads?)\b/i.test(t) || /\b(downloads?)\b.*\b(organize|clean|tidy|sort)\b/i.test(t)) {
    return { tool: 'cleanup_downloads', params: { dry_run: dryRun } };
  }

  // ── Calendar ─────────────────────────────────────────────────────────────
  if (/\b(add|create|schedule|set\s+up|put)\b.{0,40}\b(calendar|event|meeting|appointment)\b/i.test(t) ||
      /\b(calendar|event|meeting|appointment)\b.{0,20}\b(add|create|schedule|set)\b/i.test(t) ||
      /\bschedule\s+(a\s+)?(meeting|call|appointment)\b/i.test(t)) {
    const raw = userText.replace(/^(add\s+(to\s+)?calendar|calendar\s*[:,]?|schedule\s+(a\s+)?meeting|schedule\s+(a\s+)?event)\s*/i, '').trim();
    return { tool: 'add_to_calendar', params: { text: raw || userText } };
  }

  // ── Reminder ─────────────────────────────────────────────────────────────
  if (/\b(add|set|create)\b.{0,20}\breminder\b/i.test(t) ||
      /\bremind\s+(me|us)\b/i.test(t)) {
    const raw = userText.replace(/^(add\s+(a\s+)?reminder|set\s+(a\s+)?reminder|remind\s+me)\s*(to\s+|about\s+)?/i, '').trim();
    return { tool: 'add_reminder', params: { text: raw || userText } };
  }

  // ── Quick note ───────────────────────────────────────────────────────────
  if (/\b(take|add|save|create|quick)\b.{0,20}\bnote\b/i.test(t) ||
      /^note\s*:/i.test(t) ||
      /\bnote\s+(this|that|down)\b/i.test(t)) {
    const raw = userText.replace(/^(take\s+(a\s+)?note|add\s+(a\s+)?note|save\s+(a\s+)?note|quick\s+note|note\s*:?)\s*/i, '').trim();
    return { tool: 'quick_note', params: { text: raw || userText } };
  }

  // ── Weather ──────────────────────────────────────────────────────────────
  if (/\b(weather|forecast|temperature|rain|snow|sunny)\b/i.test(t) &&
      !/\b(email|estimate|bid|proposal|schedule)\b/i.test(t)) {
    const locMatch = t.match(/\bin\s+([\w\s,]+?)(?:\?|$)/i) ||
                     t.match(/\bfor\s+([\w\s,]+?)(?:\?|$)/i) ||
                     t.match(/\b(?:weather|forecast)\s+(?:in\s+|for\s+)?([\w\s,]+?)(?:\?|$)/i);
    const location = locMatch ? locMatch[1].trim() : 'Salt Lake City';
    return { tool: 'weather', params: { location } };
  }

  return null;
}

/** Parse send-email intent: "send email to John about invoice: message body" */
function parseSendEmailIntent(userText) {
  const t = userText || '';
  if (!/\b(send|compose|write|email)\b.{0,30}\b(email|message)\b/i.test(t) &&
      !/\b(email)\s+\w+\s+(about|re:|regarding)\b/i.test(t)) {
    return null;
  }
  // Extract recipient
  const toMatch = t.match(/\b(?:to|email)\s+([A-Za-z][A-Za-z\s]+?)(?:\s+(?:about|re:|regarding|saying|with subject|:))/i) ||
                  t.match(/\b(?:send|compose|email)\s+(?:an?\s+)?email\s+to\s+([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+)/i);
  const to = toMatch ? toMatch[1].trim() : null;
  // Extract subject
  const subjMatch = t.match(/\b(?:about|re:|regarding|with subject)\s+["']?([^"':]+?)["']?\s*(?::|saying|$)/i);
  const subject = subjMatch ? subjMatch[1].trim() : null;
  // Extract body — everything after the colon at the end
  const bodyMatch = t.match(/:\s*(.+)$/s);
  const body = bodyMatch ? bodyMatch[1].trim() : null;
  if (!to && !subject) return null;
  return { to, subject, body };
}

/** Parse email search intent. "find email from granite about material" -> { sender, subject/query } */
/** Parse inbox review intent — broad "check my email / anything important" queries. */
function parseInboxReviewIntent(userText) {
  const t = (userText || '').trim();
  if (!INBOX_REVIEW_INTENT.test(t)) return null;
  if (isTargetedEmailLookupText(t)) return null;
  // Don't treat as inbox review if the user is asking to find/import specific docs from email
  // (those are handled by parseProjectEmailDocumentIntent)
  if (EMAIL_PROJECT_DOC_IMPORT_INTENT.test(t)) return null;
  const unreadOnly = /\b(unread|haven'?t\s+responded|not\s+responded|need\s+to\s+respond|needs?\s+(a\s+)?response)\b/i.test(t);
  // Determine time window: "today", "week", "month"
  let since = 'week'; // default
  if (/\btoday\b|\blast\s+24\s+hours?\b|\bthis\s+morning\b/i.test(t)) since = 'today';
  else if (/\bthis\s+week\b|\blast\s+7\s+days?\b|\brecent\b/i.test(t)) since = 'week';
  else if (/\bthis\s+month\b|\blast\s+30\s+days?\b/i.test(t)) since = 'month';
  else if (/\byesterday\b/i.test(t)) since = 'yesterday';
  return {
    tool: 'search_mail',
    params: { since, unread_only: unreadOnly, inbox_only: true, limit: 30 },
    review_mode: true,
    unread_only: unreadOnly,
    since,
  };
}

// Stop words for email keyword extraction — stripped before building search terms
const EMAIL_QUERY_STOP_WORDS = new Set([
  'pull','find','search','get','show','look','check','fetch','grab','bring','retrieve',
  'from','my','the','a','an','this','that','those','these','and','or','but','into',
  'over','last','couple','few','some','all','any','recent','recently','latest','new',
  'months','weeks','days','years','month','week','day','year','time','ago','past','back',
  'based','category','please','will','you','move','attachments','attachment','folder',
  'email','emails','mail','inbox','message','messages','me','send','sent','received',
  'about','regarding','for','re','can','with','out','of','in','on','at','by','to','up',
  'have','has','had','been','are','were','was','is','be','do','did','does','its','it',
  'pricing','price', // these will be handled by synonym expansion instead
]);

// ── Email intent classification + synonym expansion ─────────────────────────
// Maps high-level user intents to curated subject-line keywords.
// These cover real-world supplier / vendor email subject patterns.
const EMAIL_INTENT_SYNONYMS = {
  pricing: [
    'quote', 'quotation', 'price', 'pricing', 'rate', 'rates', 'cost', 'costs',
    'estimate', 'proposal', 'price list', 'rate sheet', 'material pricing',
    'unit price', 'unit cost', 'aggregate', 'bid', 'material cost',
    'equipment rate', 'rental rate', 'hourly rate',
  ],
  bids: [
    'bid', 'ITB', 'invitation to bid', 'RFP', 'RFQ', 'bid opening',
    'bid solicitation', 'bid invitation', 'request for proposal',
    'request for quote', 'pre-bid', 'bid results', 'bid tab',
  ],
  contracts: [
    'contract', 'agreement', 'subcontract', 'subcontractor agreement',
    'NDA', 'scope of work', 'SOW', 'work order', 'purchase order', 'PO',
    'signed', 'executed', 'award', 'notice to proceed', 'NTP',
  ],
  invoices: [
    'invoice', 'pay app', 'payment', 'AIA', 'G702', 'G703', 'billing',
    'payment application', 'pay request', 'lien waiver', 'retainage',
    'progress payment', 'final payment',
  ],
  permits: [
    'permit', 'approval', 'encroachment', 'right of way', 'ROW',
    'traffic control', 'SWPPP', 'notice of intent', 'NOI',
  ],
  documents: [
    'scope', 'plans', 'drawings', 'specifications', 'specs', 'submittal',
    'shop drawing', 'cut sheet', 'as-built', 'record drawing', 'RFI',
    'change order', 'CCO', 'PCO', 'daily report',
  ],
  equipment: [
    'equipment', 'rental', 'excavator', 'dozer', 'compactor', 'crane',
    'loader', 'grader', 'skid steer', 'dump truck', 'water truck',
    'equipment rate', 'equipment quote',
  ],
};

/**
 * Classify the user's email search intent into a category.
 * Returns the category key or null.
 */
function classifyEmailSearchIntent(userText) {
  const t = (userText || '').toLowerCase();
  if (/\bpric|quote|quotat|rate\s|cost|estimate|material\s+pric|aggregate|unit\s+price/i.test(t)) return 'pricing';
  if (/\bbid\b|itb\b|rfp\b|rfq\b|invitation\s+to\s+bid/i.test(t)) return 'bids';
  if (/\bcontract|subcontract|agreement|nda|purchase\s+order|\bpo\b|award|ntp\b/i.test(t)) return 'contracts';
  if (/\binvoice|pay\s+app|payment\s+app|billing|lien\s+waiver/i.test(t)) return 'invoices';
  if (/\bpermit|encroachment|approval|row\b|right.of.way/i.test(t)) return 'permits';
  if (/\bequipment|excavator|dozer|compactor|crane|rental/i.test(t)) return 'equipment';
  if (/\bscope|drawing|spec\b|submittal|rfi\b|change\s+order/i.test(t)) return 'documents';
  return null;
}

/**
 * Build a prioritised list of search passes for multi-pass email search.
 * Each pass is a params object for search_mail.
 */
function buildEmailSearchPasses(intent, extractedQuery, extractedSender, since, senderCandidates) {
  const passes = [];
  const synonyms = intent ? (EMAIL_INTENT_SYNONYMS[intent] || []) : [];
  const timeParam = since || '90 days';
  const senders = Array.isArray(senderCandidates) && senderCandidates.length
    ? senderCandidates
    : (extractedSender ? [extractedSender] : []);

  if (senders.length > 0) {
    // Sender-specific: search all synonyms for that sender
    for (const snd of senders.slice(0, 5)) {
      for (const kw of synonyms.slice(0, 5)) {
        passes.push({ sender: snd, subject: kw, since: timeParam, limit: 10 });
      }
      // Also search sender without keyword filter
      passes.push({ sender: snd, since: timeParam, limit: 15 });
    }
  } else if (synonyms.length > 0) {
    // Search by subject synonym — single-keyword searches work best
    for (const kw of synonyms.slice(0, 8)) {
      passes.push({ subject: kw, since: timeParam, limit: 10 });
    }
    // Also try each synonym as a broad query (matches sender name too)
    for (const kw of synonyms.slice(0, 4)) {
      passes.push({ query: kw, since: timeParam, limit: 8 });
    }
  } else if (extractedQuery) {
    // Fallback: use extracted keywords as subject and as query
    passes.push({ subject: extractedQuery, since: timeParam, limit: 15 });
    passes.push({ query: extractedQuery, since: timeParam, limit: 15 });
    // Broader — remove time filter
    passes.push({ subject: extractedQuery, since: 'year', limit: 15 });
  }

  // Always cap total
  return passes.slice(0, 10);
}

function parseEmailSearchSince(text) {
  const t = text.toLowerCase();
  // Explicit relative phrases first (most specific)
  if (/\btoday\b|\bthis\s+morning\b/i.test(t)) return 'today';
  if (/\byesterday\b/i.test(t)) return 'yesterday';
  if (/\bthis\s+week\b|\blast\s+7\s+days?\b/i.test(t)) return 'week';
  // "couple months" / "few months" / "last 2-3 months" / "past couple months"
  if (/\bcouple\s+(?:of\s+)?months?\b|\bfew\s+months?\b|\blast\s+[23]\s+months?\b|\bpast\s+(?:couple|few|2|3)\s+months?\b/i.test(t)) return '90 days';
  // "last month" / "past month" / "this month"
  if (/\bthis\s+month\b|\blast\s+(?:30\s+)?days?\b|\blast\s+month\b|\bpast\s+month\b/i.test(t)) return 'month';
  // "last year" / "past year" / "this year"
  if (/\bthis\s+year\b|\blast\s+year\b|\bpast\s+year\b/i.test(t)) return 'year';
  // Plural fallbacks — "months", "weeks" (without "last/this")
  if (/\bmonths?\b/i.test(t)) return '90 days';
  if (/\bweeks?\b/i.test(t)) return 'week';
  return undefined;
}

function extractEmailKeywords(text) {
  // Remove common stop words and extract meaningful nouns (2-3 words max)
  const words = text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !EMAIL_QUERY_STOP_WORDS.has(w));
  return words.slice(0, 3);
}

function stripEmailSenderNoise(value) {
  var out = String(value || '').trim();
  out = out.replace(/^[\s,;:.-]+|[\s,;:.-]+$/g, '');
  out = out.replace(/\b(please|pls|thanks|thank you|thx|kindly)\b/gi, '').trim();
  out = out.replace(/\s+/g, ' ').trim();
  return out;
}

function splitSenderCandidates(value) {
  var cleaned = stripEmailSenderNoise(value);
  if (!cleaned) return [];
  var parts = cleaned
    .split(/\s*(?:,|\/|&|\bor\b|\band\b)\s*/i)
    .map(function (p) { return stripEmailSenderNoise(p); })
    .filter(Boolean);
  if (!parts.length) return [];
  return Array.from(new Set(parts)).slice(0, 5);
}

function isTargetedEmailLookupText(text) {
  var t = String(text || '').trim().toLowerCase();
  if (!t) return false;
  var hasEmailWord = /\b(email|emails|mail|inbox|message|messages)\b/.test(t);
  var hasLookupVerb = /\b(find|search|look\s*up|get|show|pull|scan|check)\b/.test(t);
  var hasDomain = /\b[a-z0-9.-]+\.(?:com|net|org|co|io|us|biz|gov|edu)\b/.test(t);
  var hasAddress = /[\w.+-]+@[\w.-]+\.[a-z]{2,}/.test(t);
  var hasSenderPhrase = /\b(from|by|sender|vendor|supplier)\b/.test(t);
  var hasPricingCue = /\b(pric|quote|quotation|rate|cost|proposal|material)\b/.test(t);
  return (hasEmailWord && (hasLookupVerb || hasSenderPhrase || hasPricingCue)) || hasDomain || hasAddress;
}

function parseEmailSearchIntent(userText) {
  const t = (userText || '').trim();

  const hasEmailKeyword = /\b(email|emails|mail|inbox|message|messages)\b/i.test(t);
  const hasSearchKeyword = /\b(find|search|look\s*up|get|show|pull\s*up|where\s*is|do\s*you\s*have|pull|can\s+you|anything\s+more|more\s+recent)\b/i.test(t);
  const hasFromAbout = /\b(email|emails|mail)\b.*\b(from|about|regarding|for|re:)\b/i.test(t) ||
                       /\b(from|about|regarding)\b.*\b(email|emails|mail)\b/i.test(t);
  const hasSenderSignal = /\b(from|by)\s+\S+@\S+|\b(from|by)\s+\S+\.(com|net|org|co|io)\b|emails?\s+(from|by|ending\s+in|that\s+end\s+in)\s+\S+|@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i.test(t);
  const hasBareDomainSignal = /\b[a-z0-9.-]+\.(?:com|net|org|co|io|us|biz|gov|edu)\b/i.test(t);
  const hasPricingCue = /\b(pric|quote|quotation|rate|cost|material)\b/i.test(t);
  const isFollowup = /\b(anything\s+more|more\s+recent|more\s+from|from\s+him|from\s+her|from\s+them|those|same\s+sender|same\s+vendor|again)\b/i.test(t);

  // If this is broad inbox review and doesn't contain targeted lookup signals, let inbox handler own it.
  if (INBOX_REVIEW_INTENT.test(t) && !isTargetedEmailLookupText(t)) return null;

  const hasLookupIntent = hasSearchKeyword || hasFromAbout || hasSenderSignal || hasBareDomainSignal || hasPricingCue || isFollowup;
  if (!(hasEmailKeyword || hasSenderSignal || hasBareDomainSignal || isFollowup) || !hasLookupIntent) {
    return null;
  }

  let sender = null;
  let senderCandidates = [];
  let subject = null;
  let query = null;

  // Extract email address or domain as sender (highest priority)
  const emailAddrMatch = t.match(/\b(?:from|by|of)\s+([\w.+-]+@[\w.-]+\.[a-zA-Z]{2,})/i) ||
                         t.match(/([\w.+-]+@[\w.-]+\.[a-zA-Z]{2,})/);
  if (emailAddrMatch) {
    sender = stripEmailSenderNoise(emailAddrMatch[1]);
    senderCandidates = splitSenderCandidates(sender);
  }

  // Extract domain-based sender: "emails ending in wadsbro.com" / "from @wadsbro.com"
  if (!sender) {
    const domainMatch = t.match(/(?:end(?:ing)?\s+in|from\s+@|emails?\s+from\s+@?)([\w.-]+\.[a-zA-Z]{2,})/i) ||
                        t.match(/@([\w.-]+\.[a-zA-Z]{2,})/) ||
                        t.match(/\b([a-z0-9.-]+\.(?:com|net|org|co|io|us|biz|gov|edu))\b/i);
    if (domainMatch) {
      sender = stripEmailSenderNoise(domainMatch[1]);
      senderCandidates = splitSenderCandidates(sender);
    }
  }

  // Extract named sender: "from X" / "by X" — stop at prepositions and email keywords
  if (!sender) {
    const fromMatch = t.match(/\b(?:from|by)\s+(?:the\s+)?([a-zA-Z0-9\s&'._@-]+?)(?:\s+(?:about|regarding|for|re:|on|over|last|past|this|into)|[.?!]|$)/i);
    if (fromMatch) {
      const raw = stripEmailSenderNoise(fromMatch[1].replace(/\s+(about|regarding|for|re:|on|over|last|past|this|into).*$/i, '').trim());
      if (raw && raw.length > 1 && !/\b(email|mail|inbox|message|supplier|suppliers|vendor|vendors|people)\b/i.test(raw)) {
        senderCandidates = splitSenderCandidates(raw);
        sender = senderCandidates[0] || raw;
      }
    }
  }

  // Extract subject/topic: "about X", "regarding X", "re: X"
  const aboutMatch = t.match(/\b(?:about|regarding|re:|concerning)\s+([a-zA-Z0-9\s&'.,-]+?)(?:\s+from|[.?!]|$)/i);
  if (aboutMatch) {
    const raw = stripEmailSenderNoise(aboutMatch[1].trim().replace(/\s+from.*$/i, '').trim());
    if (raw && !/\b(email|mail|inbox|message)\b/i.test(raw)) subject = raw;
  }

  // Keyword extraction: strip stop words, take 2-3 meaningful nouns
  if (!sender && !subject) {
    const keywords = extractEmailKeywords(t);
    if (keywords.length > 0) query = keywords.join(' ');
  }

  const since = parseEmailSearchSince(t);

  // Follow-up intent: re-use the last successful/attempted email context.
  if (!sender && !subject && !query && isFollowup && lastEmailSearchContext) {
    senderCandidates = Array.isArray(lastEmailSearchContext.sender_candidates)
      ? lastEmailSearchContext.sender_candidates.slice(0, 5)
      : [];
    sender = senderCandidates[0] || lastEmailSearchContext.sender || null;
    subject = lastEmailSearchContext.subject || null;
    query = lastEmailSearchContext.query || null;
  }

  // Broad request like "find emails" should still run a useful inbox search
  // instead of falling back to generic cloud chat behavior.
  if (!sender && !subject && !query) {
    return {
      tool: 'search_mail',
      params: {
        since: since || 'month',
        inbox_only: true,
        limit: 30,
      },
    };
  }

  return {
    tool: 'search_mail',
    params: {
      sender: sender || undefined,
      sender_candidates: senderCandidates.length ? senderCandidates : undefined,
      subject: subject || undefined,
      query: query || undefined,
      since: since || undefined,
      limit: 15,
    },
  };
}

function parseProjectEmailDocumentIntent(userText) {
  const t = (userText || '').trim();
  if (!t) return null;
  if (!EMAIL_PROJECT_DOC_IMPORT_INTENT.test(t)) return null;

  // Don't match if this looks like a targeted email search (has sender/topic patterns)
  // Pattern 1: "email/mail from [person]" where person is not a possessive/article
  const emailFromMatch = t.match(/\b(email|emails|mail)\s+from\s+(\S+)/i);
  if (emailFromMatch) {
    const nextWord = emailFromMatch[2].toLowerCase().replace(/[.,!?;:]+$/, '');
    if (!['my', 'your', 'our', 'the', 'a', 'an'].includes(nextWord)) {
      return null;
    }
  }
  // Pattern 2: "email/mail about [topic]" indicates email search
  if (/\b(email|emails|mail)\s+about\b/i.test(t)) {
    return null;
  }

  const lower = t.toLowerCase();
  const requested = new Set();
  if (/\b(photo|photos|image|images|picture|pictures|pic|pics)\b/.test(lower)) {
    requested.add('photo');
    requested.add('image');
  }
  if (/\b(contract|contracts|agreement|agreements)\b/.test(lower)) requested.add('contract');
  if (/\b(permit|permits)\b/.test(lower)) requested.add('permit');
  if (/\b(plan|plans|drawing|drawings|blueprint|blueprints|spec|specs)\b/.test(lower)) {
    requested.add('plan');
    requested.add('drawing');
    requested.add('spec');
  }
  if (/\b(proposal|quote|bid|invoice|submittal)\b/.test(lower)) {
    requested.add('proposal');
    requested.add('quote');
    requested.add('invoice');
  }
  if (/\b(attachment|attachments|attached)\b/.test(lower)) requested.add('attachment');
  if (/\b(all\s+of\s+the\s+above|everything|all\s+docs|all\s+documents)\b/.test(lower)) {
    EMAIL_DOC_KEYWORDS.forEach((kw) => requested.add(kw));
  }

  let since = 'year';
  if (/\btoday\b|\blast\s+24\s+hours?\b/.test(lower)) since = 'today';
  else if (/\bthis\s+week\b|\blast\s+7\s+days?\b/.test(lower)) since = 'week';
  else if (/\bthis\s+month\b|\blast\s+30\s+days?\b/.test(lower)) since = 'month';

  const requestedDocKeywords = requested.size ? Array.from(requested) : EMAIL_DOC_KEYWORDS.slice(0, 7);
  return { requested_doc_keywords: requestedDocKeywords, since };
}

/** Parse estimate/bid intent from natural language. Returns params for estimate_project_cost or null. */
function parseEstimateIntent(userText) {
  const t = (userText || '').trim();
  if (!/\b(estimate|how much|price|cost)\b/i.test(t)) return null;
  if (/\b(bid)\b/i.test(t) && !/\d/.test(t)) return null;
  const lfMatch = t.match(/(\d[\d,]*)\s*(?:LF|linear\s*feet?|ln\s*ft)/i);
  const inchMatch = t.match(/(\d+)\s*(?:inch|in\.?|")\s*(?:pipe|sewer|waterline|storm|gas)/i) || t.match(/(?:pipe|sewer|waterline|storm|gas)\s*[^\d]*(\d+)\s*(?:inch|in\.?|")/i);
  const linearFeet = lfMatch ? parseInt(String(lfMatch[1]).replace(/,/g, ''), 10) : 1000;
  const pipeSize = inchMatch ? inchMatch[1] : '8';
  const isSewer = /sewer/i.test(t);
  const isWaterline = /waterline|water\s*line/i.test(t);
  const isStorm = /storm/i.test(t);
  const isGas = /gas/i.test(t);
  const matType = isSewer || isWaterline || isStorm ? 'pipe' : 'pipe';
  const hoursPer100 = 12;
  const daysPer100 = 1.5;
  const laborHours = Math.ceil((linearFeet / 100) * hoursPer100);
  const equipDays = Math.ceil((linearFeet / 100) * daysPer100);
    return {
      tool: 'estimate_project_cost',
      params: {
        materials: [{ type: matType, quantity: linearFeet, size: pipeSize }],
        labor: [{ type: 'operator', hours: laborHours }, { type: 'laborer', hours: laborHours }],
        equipment: [{ type: 'excavator', days: equipDays }],
        markup: 0.15,
      },
    };
}

function estimateDataToLineItems(ed) {
  const items = [];
  for (const r of (ed.materials?.breakdown || [])) {
    items.push({
      description: r.material || '—',
      qty: r.quantity ?? 0,
      unit: r.unit || 'EA',
      unitCost: r.unit_cost ?? 0,
      total: r.total_with_waste ?? r.total_cost ?? 0,
    });
  }
  for (const r of (ed.labor?.breakdown || [])) {
    items.push({
      description: r.labor_type || 'Labor',
      qty: r.hours ?? 0,
      unit: 'hr',
      unitCost: r.hourly_rate ?? 0,
      total: r.total_cost ?? 0,
    });
  }
  for (const r of (ed.equipment?.breakdown || [])) {
    items.push({
      description: r.equipment || 'Equipment',
      qty: r.days ?? 0,
      unit: 'day',
      unitCost: r.daily_rate ?? 0,
      total: r.total_cost ?? 0,
    });
  }
  return items;
}

function parseDocumentIntent(userText) {
  const t = (userText || '').toLowerCase().trim();

  // Detect save destination from the user's wording
  const saveToProject = /\b(in|into|to|save\s+to|add\s+to|store\s+in)\s+(this\s+)?(project|folder|documents?|doc\s+folder)\b|\bproject\s+documents?\b|\bsave\s+(it\s+)?(?:to|in)\s+(?:the\s+)?project\b/i.test(userText);
  const saveToDesktop = /\b(to|on|save\s+to)\s+(the\s+)?desktop\b|\bopen\s+on\s+desktop\b/i.test(userText);
  // Default when neither specified: save to both
  const destination = saveToProject && !saveToDesktop ? 'project' : saveToDesktop && !saveToProject ? 'desktop' : 'both';

  if (/\b(create|make|export|save|generate)\b.*\b(csv|spreadsheet)\b/i.test(t) || /\b(csv|spreadsheet)\b.*\b(of\s+this|of\s+that|the\s+estimate)\b/i.test(t)) {
    return { tool: 'export_estimate_csv', params: {}, destination };
  }
  if (/\b(create|make|export|save|generate)\b.*\b(bid\s+pdf|quick\s+bid)\b/i.test(t) || /\b(bid\s+pdf|quick\s+bid)\b.*\b(of\s+this|of\s+that)\b/i.test(t)) {
    return { tool: 'export_bid_pdf', params: {}, destination };
  }
  if (/\b(create|make|export|save|generate)\b.*\b(pdf|document)\b/i.test(t) || /\b(pdf|document)\b.*\b(of\s+this|of\s+that|the\s+estimate)\b/i.test(t) || /\bexport\s+to\s+pdf\b/i.test(t)) {
    return { tool: 'export_estimate_pdf', params: {}, destination };
  }
  return null;
}

function parseResumeIntent(userText) {
  const t = (userText || '').toLowerCase().trim();
  if (/\b(help\s+me\s+)?(build|create|make|generate)\s+(my\s+)?resume\b/i.test(t) ||
      /\b(create|make|generate)\s+(my\s+)?resume\s+(pdf)?\b/i.test(t) ||
      /\bresume\s+(pdf|pdf\s+please)\b/i.test(t)) {
    return true;
  }
  return false;
}

const PROPOSAL_INTENT = /\b(generate|create|build|make|draft)\s+(a\s+)?proposal\b|\bproposal\s+(for|please)\b|\bneed\s+(a\s+)?proposal\b|\bwant\s+(a\s+)?proposal\b|\bget\s+(a\s+)?proposal\b|\bturn\s+(it|this)\s+into\s+(a\s+)?proposal\b/i;

const BID_WORKFLOW_INTENT = /\b(help\s+(me\s+)?(bid|build\s+a\s+bid|put\s+together\s+a\s+bid|with\s+a\s+bid))\b|\b(bid\s+(a|this|the)\s+(job|project))\b|\b(start\s+a\s+bid)\b|\b(new\s+bid)\b|\b(bidding\s+(a|this|the)\s+(job|project))\b|\b(put\s+together\s+(a\s+)?bid)\b|\b(work\s+on\s+(a\s+)?bid)\b/i;

// Inbox review — "check my email", "anything important in my email", "go through my inbox"
const INBOX_REVIEW_INTENT = /\b(anything|what('?s| is))\b.{0,40}\b(important|urgent|new|unread|missed)\b.{0,40}\b(email|inbox|mail)\b|\b(check|review|go\s+through|scan|look\s+at)\b.{0,30}\b(my\s+)?(email|inbox|mail)\b|\b(what('?s| is| are))\b.{0,20}\b(in\s+(my\s+)?)?(email|inbox|mail)\b|\b(haven'?t\s+responded|not\s+responded|need\s+to\s+respond|needs?\s+(a\s+)?response|need\s+response)\b|\b(unread\s+email|email.*unread)\b|\b(go\s+through\s+my|check\s+my|review\s+my)\b.{0,20}\b(email|inbox)\b/i;

// Bid watch intent — "watch for sewer bids", "alert me when new bids come in"
const BID_WATCH_INTENT = /\b(watch|monitor|alert|notify)\b.{0,40}\b(bid|bids|job|jobs|opportunity|opportunities)\b|\b(bid|job)\s+(watch|alert|monitor)\b|\b(let\s+me\s+know|tell\s+me)\b.{0,30}\b(new\s+)?(bid|job|opportunity)/i;

// Explicit inbox/email bid search — requires email/inbox context
const EMAIL_BIDS_INTENT = /\b(bid\s+opportunit|invitation\s+to\s+bid|bid\s+invit|itb|rfp|rfq)\b.{0,40}\b(inbox|email|mail|sent)\b|\b(inbox|email|mail)\b.{0,40}\b(bid\s+opportunit|invitation\s+to\s+bid|bid\s+invit|itb|rfp|rfq)\b|\bare\s+there\s+(any\s+)?(bid|itb|rfp)\s+(opportunit|invit)/i;

// Project document import via email — "pull docs from my email for this job"
const EMAIL_PROJECT_DOC_IMPORT_INTENT = /\b(pull|import|bring|get|find|search|scan|load|sync|grab)\b.{0,100}\b(doc|docs|document|documents|file|files|attachment|attachments|photo|photos|image|images|contract|contracts|permit|permits|plan|plans|drawing|drawings|spec|specs|scope|proposal|quote|invoice|info|data)\b.{0,100}\b(email|emails|mail|inbox|my email|my inbox)\b|\b(email|emails|mail|inbox)\b.{0,100}\b(doc|docs|document|documents|file|files|attachment|attachments|photo|photos|image|images|contract|contracts|permit|permits|plan|plans|drawing|drawings|spec|specs|scope|proposal|quote|invoice)\b|\bfrom\s+my\s+email\b.{0,80}\b(load|import|bring|add|pull)\b|\b(load|import|bring|add|pull)\b.{0,40}\b(from\s+(?:my\s+)?email|from\s+(?:my\s+)?inbox)\b/i;
const EMAIL_DOC_KEYWORDS = ['contract', 'permit', 'plan', 'spec', 'scope', 'drawing', 'proposal', 'quote', 'invoice', 'photo', 'image', 'attachment', 'file'];
const EMAIL_SEARCH_STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'your', 'you', 'our',
  'job', 'project', 'email', 'emails', 'mail', 'inbox', 'documents', 'document',
  'attachment', 'attachments', 'about', 'please', 'need', 'help', 'find', 'search',
  'pull', 'import', 'bring', 'some', 'into', 'through', 'all', 'above',
]);

// Work / bid finder — explicit job search, deliberately excludes file-management phrases
const WORK_FINDER_INTENT = /\b(find|search|look\s*for|get|show|check|scan)\b.{0,50}\b(job|bid|bids|opportunity|opportunities|contract|contracts)\b|\b(find|get)\s+(me\s+)?(some\s+)?(jobs|bids)\b|\bare\s+there\s+(any\s+)?(job|bid|contract|opportunity)\b|\bwork\s+(finder|search)\b|\bsearch\s+for\s+(sewer|water|gas|electrical|paving|civil|utility|grading)\b/i;

// Construction project management — change orders, pay apps, RFIs, submittals, schedule
const CONSTRUCTION_PM_INTENT = /\b(change\s+order|co\b|c\.o\.)\b|\b(pay\s+app|payment\s+application|schedule\s+of\s+values|sov)\b|\b(rfi|request\s+for\s+information)\b|\b(submittal|sub\s+log|submittal\s+log)\b|\b(daily\s+(report|log)|field\s+(report|log))\b|\b(punch\s+list)\b|\b(project\s+schedule|construction\s+schedule|baseline\s+schedule)\b|\b(lien\s+waiver|lien\s+release)\b|\bstatus\s+(on|of)\s+(the\s+)?(last|latest|current|open|pending)\b/i;

// Plan sheet / spec extraction — "extract bid items from the plans", "read the plans"
const PLAN_EXTRACT_INTENT = /\b(extract|pull|read|scan|parse|analyze)\b.{0,30}\b(bid\s+items?|quantities|takeoff|take\s*-?\s*off|line\s+items?)\b.{0,20}\b(from|in|on)?\b.{0,20}\b(plans?|specs?|pdf|drawings?|documents?)\b|\b(plans?|specs?|pdf)\b.{0,20}\b(extract|pull|read|scan)\b|\b(auto[\s-]?estimate|estimate\s+from\s+(the\s+)?plans?)\b/i;

// Document creation intent — "create a schedule", "generate a diagram", "make a Gantt"
const DOC_CREATE_INTENT = /\b(create|generate|make|build|produce|draft|write)\b.{0,40}\b(schedule|gantt|diagram|flowchart|flow\s+chart|org\s+chart|site\s+plan|process\s+flow|mindmap|mind\s+map|resume|cv|proposal\s+doc|pay\s+app|change\s+order|daily\s+report|rfi|submittal|punch\s+list|lien\s+waiver)\b/i;

// Diagram intent — "draw a diagram", "visualize the process", "site layout diagram"
const DIAGRAM_INTENT = /\b(diagram|visualize|draw|sketch|chart|map)\b.{0,40}\b(process|workflow|site|layout|org|organization|pipe|utility|flow|sequence|project|plan)\b|\b(org\s+chart|flow\s+chart|flowchart|gantt|site\s+layout|utility\s+layout|process\s+map|mind\s+map|mindmap)\b/i;

// Document edit intent — "change the header", "update the template", "edit the document"
const DOC_EDIT_INTENT = /\b(edit|update|change|modify|customize|fix|revise)\b.{0,30}\b(template|document|doc|header|footer|color|font|style|layout|column|row|section)\b/i;

// Estimating plan intent — create a structured .md plan document
const ESTIMATE_PLAN_INTENT = /\b(estimating\s+plan|estimate\s+plan|bid\s+plan|bid\s+strategy|plan\s+to\s+estimate|plan\s+to\s+bid|build\s+(a\s+)?plan|create\s+(a\s+)?plan|make\s+(a\s+)?plan)\b|\b(plan\s+(for|out)\s+(this|the)\s+(bid|estimate|job|project))\b|\b(how\s+(do|should)\s+(i|we)\s+(approach|tackle|estimate|bid)\s+(this|the)\s+(job|project|bid))\b/i;

const AUTO_FOLDER_SUGGEST_INTENT = /\b(suggest|recommend|propose)\b.{0,30}\bfolder\s+structure\b|\bfolder\s+structure\b.{0,30}\b(for|based\s+on)\b/i;
const AUTO_FOLDER_APPLY_INTENT = /\b(create|build|apply|use|make)\b.{0,30}\b(suggested|recommended|that|the)\b.{0,30}\bfolder\s+structure\b|\b(auto|automatically)\b.{0,30}\b(organize|sort)\b.{0,30}\b(project\s+)?(documents|files)\b/i;

/** Extract trade type and location from a work-finder request */
function parseWorkFinderIntent(userText) {
  const t = userText || '';
  let trade = null;
  if (/waterline|water\s*line|water\s*main/i.test(t)) trade = 'waterline';
  else if (/\bsewer|sanitary\b/i.test(t)) trade = 'sewer';
  else if (/storm\s*(drain)?|drainage\b/i.test(t)) trade = 'storm';
  else if (/\bgas\s*(line|main|pipe|distribution)?\b/i.test(t)) trade = 'gas';
  else if (/\belectrical|conduit\b/i.test(t)) trade = 'electrical';
  else if (/\bpaving|asphalt\b/i.test(t)) trade = 'paving';
  else if (/\bgrading|earthwork|excavat\b/i.test(t)) trade = 'grading';
  else if (/\bconcrete\b/i.test(t)) trade = 'concrete';
  else if (/\bcivil|road|highway|infrastructure\b/i.test(t)) trade = 'civil';
  else if (/\butility|underground\b/i.test(t)) trade = 'utility';

  const locMatch = t.match(/\b(?:in|near|around)\s+([\w\s]+?(?:,\s*[\w]{2})?)\b(?=\s*[,.]|\s*\?|$)/i);
  const location = locMatch ? locMatch[1].trim() : null;

  return { trade, location };
}

function dedupeNonEmpty(values) {
  const seen = new Set();
  const out = [];
  for (const v of (values || [])) {
    const s = String(v || '').trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

function extractSearchKeywordsFromText(text, limit = 6) {
  const words = String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !EMAIL_SEARCH_STOP_WORDS.has(w));
  return dedupeNonEmpty(words).slice(0, Math.max(1, limit));
}

function buildProjectEmailSearchPlan(payload, projectDocIntent) {
  const projectData = (payload && payload.project_data) || {};
  const bidMeta = projectData.bid_items_meta || {};
  const projectPhrases = dedupeNonEmpty([
    payload && payload.project_name,
    projectData.project_name,
    projectData.client,
    projectData.scope,
    bidMeta.source_doc_name,
    bidMeta.source,
  ]).slice(0, 5);

  const projectTerms = dedupeNonEmpty(
    projectPhrases.flatMap((p) => extractSearchKeywordsFromText(p, 5))
  ).slice(0, 8);

  const docKeywords = dedupeNonEmpty(projectDocIntent?.requested_doc_keywords || EMAIL_DOC_KEYWORDS).slice(0, 8);
  const queries = new Set();

  for (const phrase of projectPhrases.slice(0, 2)) {
    queries.add(phrase);
    for (const dk of docKeywords.slice(0, 3)) queries.add(`${phrase} ${dk}`);
  }
  for (const term of projectTerms.slice(0, 4)) {
    queries.add(term);
    for (const dk of docKeywords.slice(0, 2)) queries.add(`${term} ${dk}`);
  }
  for (const dk of docKeywords.slice(0, 4)) queries.add(dk);
  if (queries.size === 0) queries.add('project documents');

  const cleanedQueries = Array.from(queries)
    .map((q) => String(q || '').replace(/\s+/g, ' ').trim())
    .filter((q) => q.length >= 2)
    .map((q) => q.slice(0, 120))
    .slice(0, 8);

  return {
    queries: cleanedQueries,
    projectLabel: projectPhrases[0] || (payload && payload.project_name) || 'this project',
    projectTerms,
    docKeywords,
    since: projectDocIntent?.since || 'year',
  };
}

function parseEmailDateMs(email) {
  const ms = Date.parse(String(email?.date || ''));
  return Number.isFinite(ms) ? ms : 0;
}

function scoreEmailForProjectDocs(email, searchPlan) {
  const subject = String(email?.subject || '').toLowerCase();
  const sender = `${email?.sender || ''} ${email?.sender_address || ''}`.toLowerCase();
  let score = 0;

  if (/\b(attach|attachment|attached)\b/.test(subject)) score += 3;
  if (/\b(contract|permit|plan|spec|drawing|proposal|quote|invoice|photo|image|pdf)\b/.test(subject)) score += 3;
  if (email?.read === false) score += 1;
  if (email?.flagged) score += 1;

  for (const kw of (searchPlan?.docKeywords || [])) {
    const k = String(kw || '').toLowerCase();
    if (k.length < 3) continue;
    if (subject.includes(k)) score += 2;
  }
  for (const term of (searchPlan?.projectTerms || [])) {
    const t = String(term || '').toLowerCase();
    if (t.length < 3) continue;
    if (subject.includes(t)) score += 2;
    if (sender.includes(t)) score += 1;
  }

  return score;
}

async function searchProjectEmailDocuments(searchPlan) {
  const byKey = new Map();
  const errors = [];
  const queries = (searchPlan && searchPlan.queries) || [];

  for (const query of queries) {
    const data = await runDesktopToolAsync('search_mail', {
      query,
      since: searchPlan.since || 'year',
      inbox_only: true,
      limit: 12,
    }).catch((e) => ({ error: e.message || String(e), emails: [] }));

    if (data?.error && !(data?.emails || []).length) {
      errors.push(data.error);
      continue;
    }

    for (const email of (data?.emails || [])) {
      const key = `${email.message_id || ''}::${email.sender_address || email.sender || ''}::${email.subject || ''}`;
      const score = scoreEmailForProjectDocs(email, searchPlan);
      const existing = byKey.get(key);
      if (existing) {
        existing.relevance_score = Math.max(existing.relevance_score || 0, score);
        existing.relevant_document = existing.relevance_score >= 4;
        if (!existing.matched_queries.includes(query)) existing.matched_queries.push(query);
        continue;
      }
      byKey.set(key, {
        ...email,
        relevance_score: score,
        relevant_document: score >= 4,
        matched_queries: [query],
      });
    }
  }

  const emails = Array.from(byKey.values())
    .sort((a, b) => {
      const s = (b.relevance_score || 0) - (a.relevance_score || 0);
      if (s !== 0) return s;
      return parseEmailDateMs(b) - parseEmailDateMs(a);
    })
    .slice(0, 20);

  return { emails, errors };
}

function buildMailErrorResponse(errorText) {
  const msg = String(errorText || 'Email search failed.');
  const setupPattern = /mail database not found|add your email accounts|mail app|mail\.app is set up/i;
  const accessPattern = /full disk access|permission denied|operation not permitted|cannot access apple mail|unable to open database file/i;
  if (accessPattern.test(msg)) {
    return `${msg}\n\nTo use email search on macOS, grant **Full Disk Access** to openmud in System Settings → Privacy & Security → Full Disk Access, then restart openmud and try again.`;
  }
  if (setupPattern.test(msg)) {
    return `${msg}\n\nTo use email search, add your accounts in Mail.app: Mail → Settings → Accounts → + to add iCloud, Gmail, or other providers. See openmud.ai/mail-search-setup.html for setup.`;
  }
  return `I couldn't complete email search: ${msg}`;
}

/** Build bid-search keyword list for email search */
function getBidEmailKeywords(trade) {
  const BASE = ['invitation to bid', 'ITB', 'bid opening', 'RFP', 'bid opportunity'];
  const TRADE_KWS = {
    waterline:  ['waterline', 'water main'],
    sewer:      ['sewer', 'sanitary sewer'],
    storm:      ['storm drain', 'stormwater'],
    gas:        ['gas line', 'gas main'],
    electrical: ['electrical', 'conduit'],
    paving:     ['paving', 'asphalt'],
    grading:    ['grading', 'earthwork'],
    concrete:   ['concrete'],
    civil:      ['civil construction', 'road construction'],
    utility:    ['underground utility', 'utility'],
  };
  const specific = (trade && TRADE_KWS[trade]) ? TRADE_KWS[trade] : [];
  return [...specific.slice(0, 2), ...BASE.slice(0, 3)];
}

/** Search Mac Mail.app for bid-related emails matching the trade type */
async function searchEmailBids(trade) {
  const keywords = getBidEmailKeywords(trade);
  const seen = new Set();
  const results = [];

  // Run 2-3 focused searches, deduplicate by sender+subject
  for (const kw of keywords.slice(0, 3)) {
    try {
      const data = await runDesktopToolAsync('search_mail', {
        query: kw,
        limit: 8,
        since: '90 days',
      });
      for (const email of (data.emails || [])) {
        const key = `${email.sender || ''}::${email.subject || ''}`;
        if (!seen.has(key)) {
          seen.add(key);
          const isBid = /\b(bid|proposal|rfp|itb|invitation|solicitation|procurement|opportunity|quote|rfq|plan\s*holder)\b/i.test(
            email.subject || ''
          );
          results.push({ ...email, is_bid: isBid, matched_kw: kw });
        }
      }
    } catch (e) { /* continue on error */ }
  }

  results.sort((a, b) => (b.is_bid ? 1 : 0) - (a.is_bid ? 1 : 0));
  return results.slice(0, 15);
}

/** Fetch active bids from SAM.gov federal procurement API */
function searchSAMGovBids(trade, apiKey) {
  return new Promise((resolve) => {
    if (!apiKey || apiKey === 'DEMO_KEY') {
      resolve([]);
      return;
    }
    const https = require('https');
    const TRADE_QUERY = {
      waterline:  'waterline "water main" "water distribution"',
      sewer:      'sewer "sanitary sewer" wastewater',
      storm:      '"storm drain" stormwater drainage',
      gas:        '"gas line" "gas main" "natural gas"',
      electrical: 'electrical conduit "power line"',
      paving:     'paving asphalt resurfacing',
      grading:    'grading earthwork excavation',
      concrete:   'concrete foundation',
      civil:      '"civil construction" road highway bridge',
      utility:    '"underground utility" utility construction',
    };

    const keyword = encodeURIComponent(TRADE_QUERY[trade] || (trade ? trade + ' construction' : 'utility construction'));

    const today = new Date();
    const from = new Date(today);
    from.setDate(from.getDate() - 60);
    const fmt = (d) => `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;

    const reqPath = `/opportunities/v2/search?api_key=${encodeURIComponent(apiKey)}&keyword=${keyword}&limit=10&postedFrom=${encodeURIComponent(fmt(from))}&status=active`;

    const req = https.request(
      { hostname: 'api.sam.gov', path: reqPath, method: 'GET', headers: { Accept: 'application/json', 'User-Agent': 'openmud/1.0' } },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            const bids = (json.opportunitiesData || []).slice(0, 8).map((opp) => ({
              title: opp.title || 'Untitled Opportunity',
              agency: (opp.organizationHierarchy || [])[0]?.name || opp.subtierName || 'Federal Agency',
              due_date: opp.responseDeadLine ? opp.responseDeadLine.split(' ')[0] : (opp.archiveDate || null),
              location: [opp.placeOfPerformance?.city?.name, opp.placeOfPerformance?.state?.name].filter(Boolean).join(', ') || 'Varies',
              url: `https://sam.gov/opp/${opp.noticeId}/view`,
              source: 'SAM.gov',
              posted: opp.postedDate ? opp.postedDate.split(' ')[0] : null,
            }));
            resolve(bids);
          } catch (e) { resolve([]); }
        });
      }
    );
    req.on('error', () => resolve([]));
    req.setTimeout(10000, () => { req.destroy(); resolve([]); });
    req.end();
  });
}

/** Scrape Utah Division of Purchasing for relevant bid listings */
function searchUtahBids(trade) {
  return new Promise((resolve) => {
    const https = require('https');
    const TRADE_KWS = {
      waterline:  ['water', 'waterline', 'water main'],
      sewer:      ['sewer', 'wastewater', 'sanitary'],
      storm:      ['storm', 'drainage', 'stormwater'],
      gas:        ['gas'],
      electrical: ['electrical', 'conduit'],
      paving:     ['paving', 'asphalt'],
      grading:    ['grading', 'earthwork'],
      civil:      ['civil', 'road', 'highway'],
      utility:    ['utility', 'pipe', 'underground'],
      concrete:   ['concrete'],
    };
    const keywords = (trade && TRADE_KWS[trade]) ? TRADE_KWS[trade] : ['construction', 'infrastructure', 'utility'];

    const req = https.request(
      { hostname: 'purchasing.utah.gov', path: '/bids/', method: 'GET', headers: { 'User-Agent': 'openmud/1.0', Accept: 'text/html' } },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          try {
            const bids = [];
            const linkPattern = /<a\s+[^>]*href="([^"]*(?:solicitation|bid|rfp|itb|event)[^"]*)"[^>]*>([^<]{5,150})<\/a>/gi;
            let m;
            while ((m = linkPattern.exec(data)) !== null && bids.length < 6) {
              const url = m[1];
              const title = m[2].trim().replace(/\s+/g, ' ');
              const titleLow = title.toLowerCase();
              if (keywords.some((kw) => titleLow.includes(kw))) {
                bids.push({
                  title,
                  agency: 'State of Utah',
                  due_date: null,
                  location: 'Utah',
                  url: url.startsWith('http') ? url : `https://purchasing.utah.gov${url}`,
                  source: 'Utah Division of Purchasing',
                  posted: null,
                });
              }
            }
            resolve(bids);
          } catch (e) { resolve([]); }
        });
      }
    );
    req.on('error', () => resolve([]));
    req.setTimeout(10000, () => { req.destroy(); resolve([]); });
    req.end();
  });
}

/** Run all work-finder searches in parallel and return combined results */
async function findWork(trade, location) {
  const samApiKey = process.env.SAM_GOV_API_KEY || null;
  const warnings = [];
  if (!samApiKey || samApiKey === 'DEMO_KEY') {
    warnings.push('SAM.gov source unavailable: set SAM_GOV_API_KEY to enable federal bid search.');
  }
  const [emailBids, samBids, utahBids] = await Promise.all([
    searchEmailBids(trade).catch(() => []),
    searchSAMGovBids(trade, samApiKey).catch(() => []),
    searchUtahBids(trade).catch(() => []),
  ]);

  return {
    trade: trade || null,
    location: location || null,
    email_bids: emailBids,
    web_bids: [
      ...samBids.map((b) => ({ ...b, source_type: 'federal' })),
      ...utahBids.map((b) => ({ ...b, source_type: 'state' })),
    ],
    warnings,
    searched_at: new Date().toISOString(),
  };
}

let lastBidState = null;
let lastEmailSearchContext = null;

function persistSessionState() {
  try {
    storage.setUserData({
      lastEstimateData: lastEstimateData || null,
      lastBidState: lastBidState || null,
      lastEmailSearchContext: lastEmailSearchContext || null,
    });
  } catch (e) {
    console.warn('[storage] failed to persist session state:', e.message);
  }
}

function hydrateSessionState() {
  try {
    const data = storage.getUserData() || {};
    if (data.lastEstimateData && typeof data.lastEstimateData === 'object') {
      lastEstimateData = data.lastEstimateData;
    }
    if (data.lastBidState && typeof data.lastBidState === 'object') {
      lastBidState = data.lastBidState;
    }
    if (data.lastEmailSearchContext && typeof data.lastEmailSearchContext === 'object') {
      lastEmailSearchContext = data.lastEmailSearchContext;
    }
  } catch (e) {
    console.warn('[storage] failed to hydrate session state:', e.message);
  }
}

function setLastEstimateData(nextValue) {
  lastEstimateData = nextValue || null;
  persistSessionState();
}

function setLastBidState(nextValue) {
  lastBidState = nextValue || null;
  persistSessionState();
}

function setLastEmailSearchContext(nextValue) {
  lastEmailSearchContext = nextValue || null;
  persistSessionState();
}

function parseBidDetails(messages) {
  const state = lastBidState || {
    project_name: null,
    client: null,
    location: null,
    scope_text: null,
    project_type: null,
    quantities: [],
    timeline: null,
    special_conditions: [],
    notes: [],
    step: 'start',
  };

  const allText = messages
    .filter((m) => m.role === 'user')
    .map((m) => String(m.content || ''))
    .join('\n');

  if (!state.project_name) {
    const nameMatch = allText.match(/(?:project\s+(?:name|called|named|is)|for\s+(?:the\s+)?project)\s*[:\-]?\s*["']?([^"'\n,]{3,60})["']?/i);
    if (nameMatch) state.project_name = nameMatch[1].trim();
  }
  if (!state.client) {
    const clientMatch = allText.match(/(?:client\s+is|for\s+(?:client|owner))\s*[:\-]?\s*["']?([^"'\n,]{3,60})["']?/i)
      || allText.match(/(?:city\s+of|town\s+of|county\s+of)\s+([^,.\n]{3,40})/i);
    if (clientMatch) state.client = clientMatch[1].trim();
  }
  if (!state.location) {
    const locMatch = allText.match(/(?:location|located|in)\s*[:\-]?\s*([\w\s]{3,40}(?:,\s*\w{2})?)/i);
    if (locMatch) state.location = locMatch[1].trim();
  }
  if (!state.project_type) {
    if (/\b(sewer|sanitary)\b/i.test(allText)) state.project_type = 'sewer';
    else if (/\bwaterline|water\s*line|water\s*main\b/i.test(allText)) state.project_type = 'waterline';
    else if (/\bstorm\s*(drain)?|drainage\b/i.test(allText)) state.project_type = 'storm_drain';
    else if (/\bgas\b/i.test(allText)) state.project_type = 'gas';
    else if (/\belectrical|conduit\b/i.test(allText)) state.project_type = 'electrical';
    else if (/\bresidential|house|home\b/i.test(allText)) state.project_type = 'residential';
    else if (/\bcommercial|building\b/i.test(allText)) state.project_type = 'commercial';
    else if (/\bcivil|road|highway\b/i.test(allText)) state.project_type = 'civil';
  }

  const lfMatch = allText.match(/(\d[\d,]*)\s*(?:LF|linear\s*feet?|ln\s*ft|feet)/i);
  if (lfMatch && state.quantities.length === 0) {
    state.quantities.push({ item: 'pipe', qty: parseInt(String(lfMatch[1]).replace(/,/g, ''), 10), unit: 'LF' });
  }

  if (/\b(dewatering)\b/i.test(allText) && !state.special_conditions.includes('dewatering')) state.special_conditions.push('dewatering');
  if (/\b(rock\s*(excavation|removal)?)\b/i.test(allText) && !state.special_conditions.includes('rock excavation')) state.special_conditions.push('rock excavation');
  if (/\b(traffic\s*control)\b/i.test(allText) && !state.special_conditions.includes('traffic control')) state.special_conditions.push('traffic control');
  if (/\b(shoring|trench\s*box)\b/i.test(allText) && !state.special_conditions.includes('shoring')) state.special_conditions.push('shoring');

  const scopeBlock = allText.match(/(?:scope|spec|specification|description)[:\-\s]*\n?([\s\S]{20,})/i);
  if (scopeBlock && !state.scope_text) {
    state.scope_text = scopeBlock[1].slice(0, 2000).trim();
  }

  return state;
}

function getBidStepResponse(state) {
  if (state.step === 'start') {
    state.step = 'gathering';
    return `Let's build this bid step by step. I'll need some info:\n\n` +
      `1. **Project name** — what's this job called?\n` +
      `2. **Client / owner** — who's it for?\n` +
      `3. **Scope of work** — paste the scope text here, or upload the scope document (use the paperclip button). The more detail the better.\n` +
      `4. **Location** — city/state\n` +
      `5. **Type of work** — sewer, waterline, storm, gas, electrical, civil, residential, commercial?\n\n` +
      `You can give me all of this at once, or one piece at a time. If you have a scope document (PDF, Word, or text), upload it and I'll pull the details out.\n\n` +
      `What do you have?`;
  }

  const missing = [];
  if (!state.project_name) missing.push('project name');
  if (!state.client) missing.push('client/owner');
  if (!state.scope_text && state.quantities.length === 0) missing.push('scope of work or quantities');
  if (!state.project_type) missing.push('type of work');

  if (missing.length > 0 && missing.length >= 3) {
    return `Got it. I still need a few things to build a solid bid:\n\n` +
      missing.map((m, i) => `${i + 1}. **${m.charAt(0).toUpperCase() + m.slice(1)}**`).join('\n') +
      `\n\nPaste the scope text, upload a scope document, or just tell me what you know.`;
  }

  state.step = 'ready';
  return null;
}

function generateBidDocument(state) {
  const ts = new Date().toISOString().slice(0, 10);
  const name = state.project_name || 'Untitled Bid';
  let md = `# Bid Worksheet: ${name}\n`;
  md += `_Created ${ts} — updated as info comes in_\n\n`;
  md += `---\n\n`;
  md += `## Project Info\n\n`;
  md += `| Field | Value |\n|-------|-------|\n`;
  md += `| Project | ${state.project_name || '—'} |\n`;
  md += `| Client | ${state.client || '—'} |\n`;
  md += `| Location | ${state.location || '—'} |\n`;
  md += `| Type | ${state.project_type || '—'} |\n`;
  md += `| Timeline | ${state.timeline || '—'} |\n\n`;

  if (state.scope_text) {
    md += `## Scope of Work\n\n${state.scope_text}\n\n`;
  }

  md += `## Quantities & Line Items\n\n`;
  md += `| Item | Qty | Unit | Unit Cost | Total |\n|------|-----|------|-----------|-------|\n`;
  if (state.quantities.length > 0) {
    state.quantities.forEach((q) => {
      md += `| ${q.item} | ${(q.qty || 0).toLocaleString()} | ${q.unit || 'EA'} | — | — |\n`;
    });
  } else {
    md += `| _(add items as scope is defined)_ | | | | |\n`;
  }
  md += `\n`;

  md += `## Cost Summary\n\n`;
  md += `| Category | Amount |\n|----------|--------|\n`;
  md += `| Materials | — |\n`;
  md += `| Labor | — |\n`;
  md += `| Equipment | — |\n`;
  md += `| Subcontractors | — |\n`;
  md += `| Overhead | — |\n`;
  md += `| Markup | — |\n`;
  md += `| **Total** | **—** |\n\n`;

  if (state.special_conditions.length > 0) {
    md += `## Special Conditions\n\n`;
    state.special_conditions.forEach((c) => { md += `- ${c}\n`; });
    md += `\n`;
  }

  md += `## Notes\n\n`;
  if (state.notes.length > 0) {
    state.notes.forEach((n) => { md += `- ${n}\n`; });
  } else {
    md += `_Add notes as the bid develops._\n`;
  }
  md += `\n---\n_This is a working document. Update it as you gather more info._\n`;

  return { filename: `Bid-${(state.project_name || 'Project').replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '-')}-${ts}.md`, content: md };
}

function buildProposalFromEstimateData(ed) {
  if (!ed) return null;
  const lineItems = estimateDataToLineItems(ed);
  const bidItems = lineItems.map((li) => ({
    description: li.description || '—',
    amount: li.total ?? 0,
  })).filter((b) => b.description && b.amount != null);
  const total = ed.total ?? 0;
  let scope = 'Project scope';
  if (ed.materials?.breakdown?.length) {
    const parts = ed.materials.breakdown.map((r) => {
      const qty = r.quantity ?? 0;
      const mat = (r.material || r.type || '').toString();
      const unit = r.unit || 'EA';
      return qty ? `${qty} ${unit} ${mat}`.trim() : mat;
    }).filter(Boolean);
    if (parts.length) scope = parts.join(', ');
  }
  return { client: 'Project', scope, total, duration: null, bid_items: bidItems };
}

function buildProposalFromEstimateContext(estimateContext) {
  if (!estimateContext || !estimateContext.payload || !estimateContext.result) return null;
  const p = estimateContext.payload;
  const r = estimateContext.result;
  const pt = (p.project_type || 'pipe').replace('_', ' ');
  const scope = `${p.linear_feet || 0} LF of ${p.pipe_diameter || ''}" ${pt}, ${p.soil_type || ''} soil, ${p.trench_depth || ''} ft depth`;
  const total = r.predicted_cost || 0;
  const duration = r.duration_days ?? null;
  const breakdown = r.breakdown || {};
  const bidItems = [];
  if (breakdown.material) bidItems.push({ description: 'Material', amount: breakdown.material });
  if (breakdown.labor) bidItems.push({ description: 'Labor', amount: breakdown.labor });
  if (breakdown.equipment) bidItems.push({ description: 'Equipment', amount: breakdown.equipment });
  if (breakdown.misc) bidItems.push({ description: 'Miscellaneous', amount: breakdown.misc });
  if (breakdown.overhead) bidItems.push({ description: 'Overhead', amount: breakdown.overhead });
  if (breakdown.markup) bidItems.push({ description: 'Markup', amount: breakdown.markup });
  return { client: 'Project', scope, total, duration, bid_items: bidItems };
}

function buildProposalFromProjectData(projectData) {
  if (!projectData || !Array.isArray(projectData.bid_items) || projectData.bid_items.length === 0) return null;
  const bidItems = projectData.bid_items.map((item) => {
    const description = String(item.description || item.desc || item.item || '').trim();
    const amountRaw = item.amount != null ? item.amount : item.total;
    const amount = Number(amountRaw);
    return {
      description: description || 'Bid Item',
      amount: Number.isFinite(amount) ? amount : 0,
    };
  }).filter((item) => item.description);
  if (!bidItems.length) return null;
  const total = bidItems.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const meta = projectData.bid_items_meta || {};
  const sourceName = meta.source_doc_name || meta.source || 'imported bid items';
  const scope = `Proposal based on ${bidItems.length} line item${bidItems.length === 1 ? '' : 's'} from ${sourceName}.`;
  return { client: 'Project', scope, total, duration: null, bid_items: bidItems };
}

function runDesktopToolAsync(toolName, params) {
  return new Promise((resolve) => {
    runDesktopTool(toolName, params, (result) => {
      try {
        resolve(JSON.parse(result));
      } catch {
        resolve({ error: result });
      }
    });
  });
}

function formatOrganizeResult(data, dryRun) {
  if (data.error) return `Couldn't organize: ${data.error}`;
  const moved = data.moved || 0;
  const folders = data.folders || [];
  const projects = data.projects || [];
  const errs = data.errors || [];
  if (moved === 0 && errs.length === 0) {
    return dryRun ? "Nothing to organize—your desktop is already tidy." : "Nothing to organize—your desktop is already tidy.";
  }
  const verb = dryRun ? "Would organize" : "Organized";
  let msg = `${verb} ${moved} file${moved === 1 ? '' : 's'}.`;
  if (projects.length) msg += ` ${dryRun ? 'Would create' : 'Created'} project folders: ${projects.join(', ')}.`;
  if (folders.length) msg += ` By type: ${folders.join(', ')}.`;
  if (errs.length) msg += ` (${errs.length} error${errs.length === 1 ? '' : 's'})`;
  if (dryRun) msg += " Say it again without 'dry' or 'preview' to actually move files.";
  return msg;
}

async function chatViaOllama(body, authToken) {
  const { messages, model = 'mud1', max_tokens = 1024, temperature = 0.7 } = body || {};
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return { error: 'messages array required' };
  }
  const lastUser = messages.filter((m) => m.role === 'user').pop();
  if (!lastUser) return { error: 'Last message must be from user' };
  const userText = String(lastUser.content || '').trim();
  const routingText = normalizeUserIntentText(userText);
  const intentArbitration = arbitrateCoreIntent(routingText);

  const bundled = getBundledResponse(routingText);
  if (bundled) {
    return { response: bundled, tools_used: [] };
  }

  if (intentArbitration.needsDisambiguation) {
    const actions = [
      { label: 'Remove Duplicates', text: 'remove duplicate files from my project' },
      { label: 'Export to HCSS', text: 'export to HCSS HeavyBid' },
      { label: 'Export to Bid2Win', text: 'export to Bid2Win' },
    ];
    return {
      response: `I want to make sure I run the right action. Do you want to **clean up duplicate files** or **export a bid CSV format**?\n\n[MUDRAG_ACTIONS]${JSON.stringify(actions)}[/MUDRAG_ACTIONS]`,
      tools_used: ['intent_disambiguation'],
    };
  }

  // Agentic intent: calendar, reminder, note, weather, desktop/downloads
  const intent = detectAgenticIntent(routingText);
  if (intent) {
    const data = await runDesktopToolAsync(intent.tool, intent.params);
    if (intent.tool === 'cleanup_desktop' || intent.tool === 'cleanup_downloads') {
      let response = formatOrganizeResult(data, intent.params?.dry_run);
      if (!response || !response.trim()) response = 'Done.';
      return { response, tools_used: [intent.tool] };
    }
    if (intent.tool === 'add_to_calendar') {
      if (data.error) return { response: `Couldn't add to calendar: ${data.error}`, tools_used: [intent.tool] };
      const summary = data.title || data.summary || intent.params.text;
      return { response: `Added to Calendar: **${summary}**${data.date ? ' on ' + data.date : ''}${data.time ? ' at ' + data.time : ''}.`, tools_used: [intent.tool] };
    }
    if (intent.tool === 'add_reminder') {
      if (data.error) return { response: `Couldn't set reminder: ${data.error}`, tools_used: [intent.tool] };
      return { response: `Reminder set: **${data.title || data.text || intent.params.text}**${data.due ? ' — due ' + data.due : ''}.`, tools_used: [intent.tool] };
    }
    if (intent.tool === 'quick_note') {
      if (data.error) return { response: `Couldn't save note: ${data.error}`, tools_used: [intent.tool] };
      return { response: `Note saved${data.location ? ' to ' + data.location : ''}.`, tools_used: [intent.tool] };
    }
    if (intent.tool === 'weather') {
      if (data.error) return { response: `Couldn't get weather for ${intent.params.location}: ${data.error}`, tools_used: [intent.tool] };
      const w = data.weather || data;
      const loc = w.location || intent.params.location;
      const temp = w.temperature_current != null ? `${Math.round(w.temperature_current)}°F` : '';
      const cond = w.condition || w.description || '';
      const hi = w.temperature_max != null ? `High ${Math.round(w.temperature_max)}°F` : '';
      const lo = w.temperature_min != null ? `Low ${Math.round(w.temperature_min)}°F` : '';
      const parts = [temp, cond, hi, lo].filter(Boolean);
      return { response: `**${loc}:** ${parts.join(' · ')}${w.precipitation_probability != null ? `\nPrecip. chance: ${w.precipitation_probability}%` : ''}${w.wind_speed != null ? `  Wind: ${Math.round(w.wind_speed)} mph` : ''}`, tools_used: [intent.tool] };
    }
    let response = data.result || data.message || JSON.stringify(data);
    return { response: response || 'Done.', tools_used: [intent.tool] };
  }

  // Send email intent: "send email to John about the invoice: message"
  const sendEmailIntent = parseSendEmailIntent(routingText);
  if (sendEmailIntent) {
    const { to, subject, body } = sendEmailIntent;
    if (!to) {
      return { response: "Who should I send this to? Try: \"Email John about the invoice: message body\"", tools_used: [] };
    }
    const accounts = DEFAULT_EMAIL_ACCOUNTS;
    const emailBlock = `[MUDRAG_CHOOSE_EMAIL_ACCOUNT]${JSON.stringify({ accounts: accounts.map(e => ({ name: e.split('@')[0], email: e })), text: body || subject || '', to, subject: subject || '' })}[/MUDRAG_CHOOSE_EMAIL_ACCOUNT]`;
    return { response: `Ready to send to **${to}**${subject ? ` about "${subject}"` : ''}. Which account?\n\n${emailBlock}`, tools_used: ['send_email'] };
  }

  // Project email document import intent: "pull documents from my email for this job"
  const projectEmailDocIntent = parseProjectEmailDocumentIntent(routingText);
  if (projectEmailDocIntent) {
    const searchPlan = buildProjectEmailSearchPlan(body || {}, projectEmailDocIntent);
    const searchResult = await searchProjectEmailDocuments(searchPlan);
    const emails = searchResult.emails || [];
    if (emails.length === 0) {
      if (searchResult.errors && searchResult.errors.length > 0) {
        return { response: buildMailErrorResponse(searchResult.errors[0]), tools_used: [] };
      }
      const searched = (searchPlan.queries || []).slice(0, 4).map((q) => `"${q}"`).join(', ');
      const label = searchPlan.projectLabel ? ` for **${searchPlan.projectLabel}**` : '';
      return {
        response: `I searched Mail.app${label} and didn't find matching emails with attachments.\n\n**Searched for:** ${searched || 'project documents'}\n\n**Try:**\n- Tell me the exact sender address — e.g. "find emails from rdahl@wadsbro.com"\n- Make sure the email account receiving those emails is set up in Mail.app (Mail → Settings → Accounts)\n- Or drag the files directly into the Documents panel on the right`,
        tools_used: ['search_mail'],
      };
    }

    const highlyRelevant = emails.filter((e) => e.relevant_document).length;
    const headerLine = `I searched your email for project documents${searchPlan.projectLabel ? ` for **${searchPlan.projectLabel}**` : ''} and found **${emails.length}** relevant email${emails.length === 1 ? '' : 's'}. Use **Import docs** to extract attachments and add them into this project automatically.${highlyRelevant ? ` ${highlyRelevant} look highly relevant.` : ''}`;
    const block = `[MUDRAG_EMAIL_RESULTS]${JSON.stringify({
      emails,
      mode: 'project_doc_import',
      project: searchPlan.projectLabel,
      query: { queries: searchPlan.queries, since: searchPlan.since, doc_keywords: searchPlan.docKeywords },
    })}[/MUDRAG_EMAIL_RESULTS]`;
    return { response: `${headerLine}\n\n${block}`, tools_used: ['search_mail', 'import_email_documents'] };
  }

  // Email search intent: "find email from granite about material"
  // Intentionally evaluated before inbox review so targeted lookup is never swallowed by broad inbox intent.
  const emailIntent = parseEmailSearchIntent(routingText);
  if (emailIntent) {
    const p0 = emailIntent.params;

    // ── Multi-pass search engine ───────────────────────────────────────────
    // Classify the user intent and build synonym-based search passes.
    const emailCategory = classifyEmailSearchIntent(routingText);
    const passes = buildEmailSearchPasses(
      emailCategory,
      p0.query || p0.subject || null,
      p0.sender || null,
      p0.since || null,
      p0.sender_candidates || null
    );

    // If no passes were generated (no known intent + no keywords), fall back to the raw params
    if (passes.length === 0) {
      passes.push({ ...p0, limit: 15 });
    }

    // Run all passes, dedup by message_id, score and rank
    const byMsgId = new Map();
    let toolError = null;
    const triedKeywords = new Set();

    const passResults = await Promise.all(
      passes.map(async (passParams) => {
        const searchKey = passParams.subject || passParams.query || passParams.sender || '';
        if (searchKey) triedKeywords.add(searchKey);
        const data = await runDesktopToolAsync('search_mail', { ...passParams, limit: passParams.limit || 12 });
        return { passParams, data };
      })
    );

    for (const pass of passResults) {
      const data = pass.data || {};
      if (data.error && !(data.emails || []).length) {
        if (!toolError) toolError = data.error;
        continue;
      }
      for (const email of (data.emails || [])) {
        const key = String(email.message_id || `${email.sender_address}::${email.subject}`);
        if (!byMsgId.has(key)) {
          // Score: attachment = +5, matched a high-priority keyword = +3, recency handled by sort
          let score = 0;
          if (email.has_attachments) score += 5;
          const subj = (email.subject || '').toLowerCase();
          const synonyms = emailCategory ? (EMAIL_INTENT_SYNONYMS[emailCategory] || []) : [];
          for (const syn of synonyms.slice(0, 6)) {
            if (subj.includes(syn.toLowerCase())) { score += 3; break; }
          }
          byMsgId.set(key, { ...email, _score: score });
        } else {
          // Keep highest score
          const existing = byMsgId.get(key);
          const subj = (email.subject || '').toLowerCase();
          let score = existing._score;
          if (email.has_attachments && !existing.has_attachments) { score += 5; existing.has_attachments = true; }
          byMsgId.set(key, { ...existing, _score: score });
        }
      }
    }

    if (toolError && byMsgId.size === 0) {
      return { response: buildMailErrorResponse(toolError), tools_used: [] };
    }

    // Sort: score DESC, then recency DESC
    const emails = Array.from(byMsgId.values())
      .sort((a, b) => {
        if (b._score !== a._score) return b._score - a._score;
        return (new Date(b.date || 0).getTime()) - (new Date(a.date || 0).getTime());
      })
      .slice(0, 25)
      .map(({ _score, ...e }) => e); // strip internal score field

    if (emails.length === 0) {
      const triedList = Array.from(triedKeywords).slice(0, 8).map((k) => `"${k}"`).join(', ');
      const timeDesc = p0.since ? ` in the past ${p0.since}` : '';
      const senderList = (Array.isArray(p0.sender_candidates) && p0.sender_candidates.length) ? p0.sender_candidates : (p0.sender ? [p0.sender] : []);
      const senderDesc = senderList.length ? ` from **${senderList.join(' / ')}**` : '';
      setLastEmailSearchContext({
        sender: p0.sender || null,
        sender_candidates: senderList.slice(0, 5),
        subject: p0.subject || null,
        query: p0.query || null,
        since: p0.since || null,
        category: emailCategory || null,
        at: Date.now(),
      });

      // Smart suggestion buttons based on what was searched
      const suggestions = [];
      if (emailCategory && EMAIL_INTENT_SYNONYMS[emailCategory]) {
        const topSyns = EMAIL_INTENT_SYNONYMS[emailCategory].slice(0, 3);
        topSyns.forEach((kw) => suggestions.push({ label: `Search subject: "${kw}"`, text: `find email with subject ${kw}` }));
      }
      suggestions.push({ label: 'Show all inbox emails this month', text: 'check my inbox this month' });
      suggestions.push({ label: 'Broaden to past year', text: `${userText} past year` });

      return {
        response: `Searched Mail.app${senderDesc}${timeDesc} — no matching emails found.\n\n**Searched for:** ${triedList || 'general keywords'}\n\n**These keywords cover real subject-line patterns. If emails exist, they may be in an account not connected to Mail.app (Mail → Settings → Accounts).**\n\n[MUDRAG_ACTIONS]${JSON.stringify(suggestions)}[/MUDRAG_ACTIONS]`,
        tools_used: ['search_mail'],
      };
    }

    // Success — format result
    const withAttachments = emails.filter((e) => e.has_attachments).length;
    const senderList = (Array.isArray(p0.sender_candidates) && p0.sender_candidates.length) ? p0.sender_candidates : (p0.sender ? [p0.sender] : []);
    const senderLabel = senderList.length ? ` from **${senderList.join(' / ')}**` : '';
    const categoryLabel = emailCategory ? ` (${emailCategory})` : '';
    const attachNote = withAttachments > 0 ? ` — **${withAttachments} have attachments**` : '';
    const headerLine = `Found **${emails.length}** email${emails.length !== 1 ? 's' : ''}${senderLabel}${categoryLabel}${attachNote}. Click the envelope icon to open or the download icon to import attachments.`;
    setLastEmailSearchContext({
      sender: p0.sender || null,
      sender_candidates: Array.isArray(p0.sender_candidates) ? p0.sender_candidates.slice(0, 5) : (p0.sender ? [p0.sender] : []),
      subject: p0.subject || null,
      query: p0.query || null,
      since: p0.since || null,
      category: emailCategory || null,
      at: Date.now(),
    });
    const block = `[MUDRAG_EMAIL_RESULTS]${JSON.stringify({ emails, query: p0, mode: emailCategory === 'pricing' || emailCategory === 'documents' ? 'project_doc_import' : undefined })}[/MUDRAG_EMAIL_RESULTS]`;
    return { response: `${headerLine}\n\n${block}`, tools_used: ['search_mail'] };
  }

  // Inbox review intent: "anything important in my email", "check my inbox", "go through my email"
  const inboxIntent = parseInboxReviewIntent(routingText);
  if (inboxIntent) {
    const data = await runDesktopToolAsync(inboxIntent.tool, inboxIntent.params);
    if (data.error && !data.emails?.length) {
      return {
        response: buildMailErrorResponse(data.error),
        tools_used: [],
      };
    }
    const emails = data.emails || [];
    if (emails.length === 0) {
      const period = inboxIntent.since === 'today' ? 'today' : `this ${inboxIntent.since}`;
      return {
        response: `No ${inboxIntent.unread_only ? 'unread ' : ''}emails found ${period}. Your inbox looks clear.`,
        tools_used: [inboxIntent.tool],
      };
    }
    // Build a compact email list for the LLM to analyze
    const emailListText = emails.slice(0, 20).map((e, i) =>
      `${i + 1}. From: ${e.sender} | Subject: ${e.subject} | Date: ${e.date}${e.read === false ? ' [UNREAD]' : ''}${e.replied ? ' [REPLIED]' : ''}`
    ).join('\n');
    const period = inboxIntent.since === 'today' ? 'today' : `in the past ${inboxIntent.since}`;
    const reviewPrompt = `You are an assistant reviewing a user's email inbox. Based on the emails below (received ${period}), identify which ones seem most important, time-sensitive, or need a response. Be concise — list 3-5 standout emails with a 1-line reason each. If nothing stands out, say so.\n\nEmails:\n${emailListText}\n\nImportant emails and why:`;
    let llmSummary = '';
    try {
      const fallbackRes = await fetch('https://openmud.ai/api/mud1-fallback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: reviewPrompt }] }),
        signal: AbortSignal.timeout(12000),
      });
      const fallbackData = await fallbackRes.json().catch(() => ({}));
      if (fallbackRes.ok && fallbackData.response) {
        llmSummary = fallbackData.response.trim();
      }
    } catch (_) {
      try {
        const Anthropic = require('@anthropic-ai/sdk');
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (apiKey) {
          const ant = new Anthropic({ apiKey });
          const msg = await ant.messages.create({
            model: 'claude-haiku-4-5',
            max_tokens: 400,
            messages: [{ role: 'user', content: reviewPrompt }],
          });
          llmSummary = (msg.content?.[0]?.text || '').trim();
        }
      } catch (_) { /* fall through to plain list */ }
    }
    const unreadCount = emails.filter((e) => e.read === false).length;
    const headerLine = `Found **${emails.length}** email${emails.length !== 1 ? 's' : ''} (${period}${unreadCount ? `, ${unreadCount} unread` : ''}). Click **Open in Mail** on any to view it.`;
    const block = `[MUDRAG_EMAIL_RESULTS]${JSON.stringify({ emails, query: inboxIntent.params })}[/MUDRAG_EMAIL_RESULTS]`;
    const responseText = llmSummary
      ? `${headerLine}\n\n**What stands out:**\n${llmSummary}\n\n${block}`
      : `${headerLine}\n\n${block}`;
    return { response: responseText, tools_used: [inboxIntent.tool] };
  }

  // Document intent: create CSV or PDF from last estimate
  const docIntent = parseDocumentIntent(routingText);
  if (docIntent && lastEstimateData) {
    const os = require('os');
    const ts = new Date().toISOString().slice(0, 10);
    const dest = docIntent.destination || 'both';          // 'project' | 'desktop' | 'both'
    const saveDesktop = dest === 'desktop' || dest === 'both';
    const saveProject = dest === 'project' || dest === 'both';

    const baseDir = path.join(os.homedir(), 'Desktop');
    const activeProjectName = (body && body.project_name) ? body.project_name : null;
    const projectName = (activeProjectName || docIntent.project_name || 'Estimate').replace(/[^a-zA-Z0-9-_\s]/g, '').trim().replace(/\s+/g, '_');
    const params = { ...docIntent.params, estimate_data: lastEstimateData, project_name: projectName };
    const isCSV = docIntent.tool.includes('csv');
    const ext = isCSV ? 'csv' : 'pdf';
    const fileType = isCSV ? 'CSV' : 'PDF';
    const fileName = `${projectName}-${ts}.${ext}`;

    params.output_path = path.join(baseDir, fileName);   // always write to disk first so we can read it back

    if (docIntent.tool === 'export_bid_pdf') {
      params.line_items = estimateDataToLineItems(lastEstimateData);
      params.direct_cost = lastEstimateData.subtotal || 0;
      params.contingency = 0;
      params.profit = lastEstimateData.overhead_profit || 0;
      params.total = lastEstimateData.total || 0;
    }
    const data = await runDesktopToolAsync(docIntent.tool, params);
    if (data.error) return { response: `Couldn't create document: ${data.error}`, tools_used: [docIntent.tool] };
    const filePath = data.path || data.csv || params.output_path;
    const projectId = (body && body.project_id) || null;

    // Build response based on destination
    const parts = [];
    let saveBlock = '';

    if (saveProject && filePath && fs.existsSync(filePath)) {
      const { readFileForImport } = require('./file-scanner');
      const imported = readFileForImport(filePath);
      if (imported.ok) {
        const folderName = isCSV ? 'Spreadsheets' : 'Documents';
        saveBlock = `[MUDRAG_SAVE_DOC]${JSON.stringify({
          name: path.basename(filePath),
          base64: imported.base64,
          mime: imported.mime,
          folder: folderName,
          project_id: projectId,
        })}[/MUDRAG_SAVE_DOC]`;
        parts.push(`Saved to project **Documents → ${folderName}**`);
      }
    }
    if (saveDesktop) {
      parts.push(`Saved to Desktop at \`${filePath}\``);
    }

    const summary = parts.length ? parts.join('\n') : `${fileType} created: **${path.basename(filePath)}**`;
    return {
      response: `${fileType} ready: **${path.basename(filePath)}**\n\n${summary}${saveBlock ? '\n\n' + saveBlock : ''}`,
      tools_used: [docIntent.tool],
    };
  }
  if (docIntent && !lastEstimateData) {
    return { response: "Run an estimate first (e.g. 'Estimate 1500 LF of 8 inch sewer'), then say 'create a csv of that' or 'export to pdf'.", tools_used: ['export'] };
  }

  // Proposal intent: generate [MUDRAG_PROPOSAL] from estimate context (matches web behavior)
  if (PROPOSAL_INTENT.test(routingText)) {
    const estimateContext = (body && body.estimate_context) || null;
    const projectData = (body && body.project_data) || null;
    let params = buildProposalFromEstimateContext(estimateContext);
    if (!params) params = buildProposalFromEstimateData(lastEstimateData);
    if (!params) params = buildProposalFromProjectData(projectData);
    if (params) {
      const block = `[MUDRAG_PROPOSAL]${JSON.stringify({ client: params.client, scope: params.scope, total: params.total, duration: params.duration, bid_items: params.bid_items })}[/MUDRAG_PROPOSAL]`;
      return { response: block, tools_used: ['generate_proposal'] };
    }
    return { response: "I need bid data to build a proposal. You can either run an estimate, or say “extract bid items from this file and load them into proposal,” then ask me to generate the proposal.", tools_used: ['generate_proposal'] };
  }

  // Auto folder workflow: suggest and apply smart folder organization.
  if (AUTO_FOLDER_APPLY_INTENT.test(routingText)) {
    return {
      response: `Got it — I'll auto-organize your project files by document type, create clearly named folders, and place each file where it belongs.\n\n[MUDRAG_AUTO_FOLDER]${JSON.stringify({ mode: 'apply' })}[/MUDRAG_AUTO_FOLDER]`,
      tools_used: ['auto_folder_organize'],
    };
  }
  if (AUTO_FOLDER_SUGGEST_INTENT.test(routingText) && /document|file|folder|project/i.test(routingText)) {
    const actions = [{ label: 'Create Suggested Folder Structure', text: 'create the suggested folder structure' }];
    return {
      response: `I can analyze your current project documents and suggest a clean folder structure by file type and content.\n\n[MUDRAG_AUTO_FOLDER]${JSON.stringify({ mode: 'preview' })}[/MUDRAG_AUTO_FOLDER]\n\n[MUDRAG_ACTIONS]${JSON.stringify(actions)}[/MUDRAG_ACTIONS]`,
      tools_used: ['auto_folder_organize'],
    };
  }

  // Create folder intent: "add that .md to a new folder called biditems", "create a folder named X"
  // Must run BEFORE file management so "add file to folder" doesn't fall through to the cloud LLM.
  const CREATE_FOLDER_INTENT = /\b(add|save|put|move|copy)\b.{0,80}\b(new\s+)?folder\b|\b(create|make|build)\b.{0,20}\b(a\s+)?(new\s+)?folder\b/i;
  if (CREATE_FOLDER_INTENT.test(routingText)) {
    const nameMatch = routingText.match(/\b(called|named|as)\s+["']?([\w][\w\s-]*)["']?(?:\s|$|\.|\?)/i);
    const folderName = nameMatch ? nameMatch[2].trim() : 'New Folder';
    const hasMdRef = /\b(that|the|this|it)\b.{0,30}\b(file|doc|document|\.md|md)\b|\b(\.md|md\s+file)\b/i.test(routingText);
    const fileNote = hasMdRef ? ' Your last saved document has been moved into it.' : '';
    const block = `[MUDRAG_CREATE_FOLDER]${JSON.stringify({ name: folderName, move_last: hasMdRef })}[/MUDRAG_CREATE_FOLDER]`;
    return {
      response: `Created **"${folderName}"** folder in your project documents.${fileNote} You can drag any files into it from the sidebar.\n\n${block}`,
      tools_used: ['create_folder'],
    };
  }

  // File management intent — must check BEFORE work finder to avoid false matches
  const shouldHandleFileManagement =
    intentArbitration.primary === 'file_management' ||
    (intentArbitration.primary === null && FILE_MANAGEMENT_INTENT.test(routingText));
  if (shouldHandleFileManagement) {
    const isDuplicate = /duplicate|dupe/i.test(routingText);
    const isDelete    = /delete|remove|take\s+out/i.test(routingText);
    const isOrganize  = /organize|sort|manage/i.test(routingText);
    const isClean     = /clean\s+up/i.test(routingText);
    let msg = '';
    const actions = [];
    if (isDuplicate || isClean) {
      msg = `I can help you find and remove duplicate files in your project.\n\n**To find duplicates:**\n- Open the Documents panel (sidebar) and look for files with the same name or similar size.\n- Right-click any file → **Delete** — I'll always ask you to confirm before removing anything.\n\n**To quickly scan for duplicates**, use the "Find Duplicates" button below:`;
      actions.push({ label: 'Find Duplicates', text: '__find_duplicates__' });
      actions.push({ label: 'Clean Up Project', text: '__clean_duplicates__' });
    } else if (isDelete) {
      msg = `To delete files from your project:\n- Right-click any file in the **Documents** sidebar → **Delete**\n- I'll always ask you to confirm before anything is removed.\n\nWhich file(s) would you like to remove? Tell me the name and I'll help you locate it.`;
    } else if (isOrganize) {
      msg = `Here's how to organize your project files:\n\n1. **Create folders** — click the folder icon (+) in the Documents header\n2. **Drag files** into folders to organize them\n3. **Rename** files or folders by right-clicking → Rename\n4. **Find Duplicates** to clean up redundant files\n\nWould you like me to suggest a folder structure based on your project type?`;
      actions.push({ label: 'Find Duplicates', text: '__find_duplicates__' });
      actions.push({ label: 'Suggest Folder Structure', text: 'suggest a folder structure for my project documents' });
    } else {
      msg = `I can help you manage files in your project. What would you like to do?\n- **Add files** — upload button in the Documents sidebar\n- **Delete files** — right-click → Delete (with confirmation)\n- **Rename** — right-click → Rename\n- **Organize into folders** — drag and drop\n- **Find duplicates** — scan for duplicate files`;
      actions.push({ label: 'Find Duplicates', text: '__find_duplicates__' });
      actions.push({ label: 'New Folder', text: '__new_folder__' });
    }
    const actionsBlock = actions.length ? `\n\n[MUDRAG_ACTIONS]${JSON.stringify(actions)}[/MUDRAG_ACTIONS]` : '';
    return { response: msg + actionsBlock, tools_used: ['file_management'] };
  }

  // Bid watch — "watch for sewer bids in Utah", "alert me when new jobs come up"
  if (BID_WATCH_INTENT.test(routingText) && !WORK_FINDER_INTENT.test(routingText)) {
    const tradeMatch = routingText.match(/\b(sewer|water|gas|electrical|paving|civil|utility|grading|concrete|storm|underground)\b/i);
    const locMatch = routingText.match(/\bin\s+([\w\s,]+?)(?:\s+(?:over|above|under|below|worth)|[.?!]|$)/i);
    const valMatch = routingText.match(/\b(?:over|above|more\s+than)\s+\$?([\d,]+)/i);
    const trade = tradeMatch ? tradeMatch[1].toLowerCase() : null;
    const location = locMatch ? locMatch[1].trim() : null;
    const minValue = valMatch ? parseInt(valMatch[1].replace(/,/g, ''), 10) : null;
    const watch = bidWatcher.addWatch({ trade, location, min_value: minValue, keywords: trade });
    const details = [trade, location, minValue ? `over $${minValue.toLocaleString()}` : null].filter(Boolean).join(', ');
    const actions = [
      { label: 'Check Now', text: '__bid_watch_check__' },
      { label: 'View Watches', text: '__bid_watch_list__' },
    ];
    return {
      response: `Bid watch set up${details ? ': **' + details + '**' : ''}. I'll check every 2 hours and send you a desktop notification when new matching bids appear.\n\n[MUDRAG_ACTIONS]${JSON.stringify(actions)}[/MUDRAG_ACTIONS]`,
      tools_used: ['bid_watch'],
    };
  }

  // Email bid search — explicit inbox/email context required
  if (EMAIL_BIDS_INTENT.test(routingText)) {
    const emailBids = await searchEmailBids(null).catch(() => []);
    if (emailBids.length === 0) {
      return { response: "I checked your inbox and didn't find any bid invitations (ITBs, RFPs, or RFQs) in recent emails. Try searching manually:\n\n[MUDRAG_ACTIONS]" + JSON.stringify([{ label: 'Search inbox for bids', text: 'search email for bid invitations' }]) + '[/MUDRAG_ACTIONS]', tools_used: ['email_bids'] };
    }
    const combined = { email_bids: emailBids, web_bids: [], sources: {}, searched_at: new Date().toISOString() };
    const block = `[MUDRAG_WORK_RESULTS]${JSON.stringify(combined)}[/MUDRAG_WORK_RESULTS]`;
    return { response: `Found **${emailBids.length}** bid invitation${emailBids.length !== 1 ? 's' : ''} in your inbox:\n\n${block}`, tools_used: ['email_bids'] };
  }

  // Construction PM intent — change orders, pay apps, RFIs, submittals, schedule
  // Construction PM documents — use agentic loop to extract fields and generate real PDFs
  if (CONSTRUCTION_PM_INTENT.test(routingText)) {
    const t = routingText.toLowerCase();
    const hasDraftKeyword = /\b(draft|create|generate|write|make|prepare|build)\b/i.test(t);
    const hasSpecificDetails = /\$|(\d+\s*(lf|sf|cy|ea|ls|days?|hours?))/i.test(t) ||
                               /\b(crew\s+size|work\s+done|weather|scope|amount)\b/i.test(t);

    // If user gives enough details to actually generate a doc, use the agentic loop
    if (hasDraftKeyword || hasSpecificDetails) {
      try {
        const agenticResult = await agenticToolLoop(messages, userText, authToken);
        if (agenticResult) return agenticResult;
      } catch (e) {
        console.warn('[pm-doc agentic] failed:', e.message);
      }
    }

    // Fallback: show quick-action buttons to guide the user
    let msg = '';
    const actions = [];
    if (/change\s+order|co\b|c\.o\./i.test(t)) {
      msg = `I can **draft a change order PDF** for you. Tell me the details:\n- Scope of change\n- Price or quantity\n- Reason for the change\n\nExample: "Draft a change order for adding 200 LF of 6 inch gate valve at $85/LF due to field condition"`;
      actions.push({ label: 'Draft Change Order', text: 'draft a change order for: ' });
    } else if (/pay\s+app|payment\s+application|schedule\s+of\s+values|sov/i.test(t)) {
      msg = `I can **generate a pay application PDF**. Tell me:\n- Contract amount\n- Work completed this period (% or $)\n- Retainage rate\n\nExample: "Prepare a pay app: contract $450,000, 35% complete, 10% retainage"`;
      actions.push({ label: 'Prepare Pay App', text: 'prepare a pay app: contract $' });
    } else if (/rfi|request\s+for\s+information/i.test(t)) {
      msg = `I can **draft an RFI document** for you. Describe the question or conflict:\n\nExample: "Draft an RFI: plan sheet C-3 shows 8 inch PVC but spec section 33 31 00 calls for 12 inch DIP — which is correct?"`;
      actions.push({ label: 'Draft RFI', text: 'draft an RFI: ' });
    } else if (/submittal|sub\s+log/i.test(t)) {
      msg = `I can **generate a submittal transmittal**. Tell me the spec section and what you're submitting:\n\nExample: "Create a submittal transmittal for spec 33 31 00 — DIP pipe shop drawings from US Pipe"`;
      actions.push({ label: 'Draft Submittal', text: 'create a submittal transmittal for: ' });
    } else if (/daily\s+(report|log)|field\s+(report|log)/i.test(t)) {
      msg = `I can **write a daily report PDF**. Tell me what happened today:\n- Crew size and trades on site\n- Work performed\n- Weather conditions\n- Equipment used\n\nExample: "Write a daily report: 8 crew, installed 350 LF 8in sewer, sunny 75F, Cat 320 excavator"`;
      actions.push({ label: 'Write Daily Report', text: 'write a daily report: crew size ' });
    } else if (/punch\s+list/i.test(t)) {
      msg = `I can **generate a punch list PDF**. Describe the project and areas:\n\nExample: "Generate a punch list for the Draper City waterline project — valve boxes, surface restoration, as-built markups"`;
      actions.push({ label: 'Generate Punch List', text: 'generate a punch list for: ' });
    } else if (/lien\s+(waiver|release)/i.test(t)) {
      msg = `I can **draft a lien waiver PDF**. Tell me:\n- Project name\n- Payment amount\n- Through date\n- Conditional or unconditional\n\nExample: "Draft a conditional lien waiver: Gerber Gas Line, $125,000, through March 2026"`;
      actions.push({ label: 'Draft Lien Waiver', text: 'draft a conditional lien waiver: project ' });
    } else {
      msg = `**Construction PM Documents** — I can generate real PDFs:\n\n- **Change Orders** — draft with scope, price, signatures\n- **Daily Reports** — crew, work, weather, equipment\n- **RFIs** — formatted with routing info\n- **Pay Applications** — SOV + cover sheet\n- **Submittals** — transmittal covers\n- **Punch Lists** — by area\n- **Lien Waivers** — conditional or unconditional\n\nJust tell me what you need with enough detail and I'll generate the document.`;
      actions.push({ label: 'Draft Change Order', text: 'draft a change order for: ' });
      actions.push({ label: 'Write Daily Report', text: 'write a daily report: ' });
      actions.push({ label: 'Draft RFI', text: 'draft an RFI: ' });
    }
    const actionsBlock = actions.length ? `\n\n[MUDRAG_ACTIONS]${JSON.stringify(actions)}[/MUDRAG_ACTIONS]` : '';
    return { response: msg + actionsBlock, tools_used: ['construction_pm'] };
  }

  // ── Document & Diagram Creation ─────────────────────────────────────────────

  // Diagram intent — "draw a site layout diagram", "create a Gantt chart", "flowchart for approval process"
  if (DIAGRAM_INTENT.test(routingText) && !CONSTRUCTION_PM_INTENT.test(routingText)) {
    const t = routingText.toLowerCase();
    const isGemini = /\b(site\s+layout|utility\s+layout|visual|image|photo|realistic|drawing|sketch)\b/i.test(t);
    const projectName = payload.project_name || null;

    if (isGemini) {
      const prompt = routingText.replace(/\b(create|generate|make|draw|diagram|visualize)\b/gi, '').trim();
      const apiKey = process.env.GEMINI_API_KEY || null;
      if (!apiKey) {
        const actions = [{ label: 'Add Gemini Key', text: '__open_settings__' }];
        return {
          response: `To generate AI visual diagrams (site layouts, equipment schematics, etc.) I need a Gemini API key. Add it in Settings → API Keys.\n\nFor now I can create structured diagrams (Gantt, flowcharts, org charts) without any API key — just ask!\n\n[MUDRAG_ACTIONS]${JSON.stringify(actions)}[/MUDRAG_ACTIONS]`,
          tools_used: [],
        };
      }
      const data = await runDesktopToolAsync('generate_diagram', { diagram_type: 'gemini', prompt, project_name: projectName, api_key: apiKey });
      if (data.error) return { response: `Diagram generation failed: ${data.error}`, tools_used: [] };
      const block = `[MUDRAG_DOCUMENT]${JSON.stringify({ html_path: data.html_path, image_path: data.image_path, doc_name: data.doc_name, type: 'diagram' })}[/MUDRAG_DOCUMENT]`;
      return { response: `Here's your diagram — saved to **Documents/openmud**.\n\n${block}`, tools_used: ['generate_diagram'] };
    }

    // Mermaid diagram — detect type
    let diagram_type = 'flowchart';
    if (/gantt|schedule/i.test(t)) diagram_type = 'gantt';
    else if (/org\s+chart|organization/i.test(t)) diagram_type = 'org_chart';
    else if (/sequence/i.test(t)) diagram_type = 'sequence';
    else if (/mind\s*map/i.test(t)) diagram_type = 'mindmap';
    else if (/pie|breakdown/i.test(t)) diagram_type = 'pie';

    const actions = [
      { label: 'Open Diagram', text: '__open_last_doc__' },
      { label: 'Edit Template', text: 'edit the diagram template — change the color scheme to blue' },
    ];
    const data = await runDesktopToolAsync('generate_diagram', {
      diagram_type,
      title: routingText.replace(/\b(create|generate|make|draw|diagram|visualize|a|an|the)\b/gi, '').trim().slice(0, 60) || 'Diagram',
      project_name: projectName,
    });
    if (data.error) return { response: `Diagram creation failed: ${data.error}`, tools_used: [] };
    const block = `[MUDRAG_DOCUMENT]${JSON.stringify({ html_path: data.html_path, doc_name: data.doc_name, type: 'diagram', mermaid_code: data.mermaid_code })}[/MUDRAG_DOCUMENT]`;
    return {
      response: `Created a **${diagram_type.replace('_', ' ')} diagram** — saved to Documents/openmud. Open it in your browser to view the interactive version.\n\n${block}\n\nTo customize it, just say "edit the diagram" and describe what to change.\n\n[MUDRAG_ACTIONS]${JSON.stringify(actions)}[/MUDRAG_ACTIONS]`,
      tools_used: ['generate_diagram'],
    };
  }

  // Doc creation intent — "create a project schedule document", "generate a change order PDF"
  if (DOC_CREATE_INTENT.test(routingText) && !CONSTRUCTION_PM_INTENT.test(routingText)) {
    const t = routingText.toLowerCase();
    let doc_type = null;
    if (/schedule|gantt/i.test(t)) doc_type = 'project_schedule';
    else if (/change\s+order|co\b/i.test(t)) doc_type = 'change_order';
    else if (/daily\s+report|field\s+log/i.test(t)) doc_type = 'daily_report';
    else if (/rfi|request\s+for\s+info/i.test(t)) doc_type = 'rfi';
    else if (/pay\s+app|payment\s+application/i.test(t)) doc_type = 'pay_application';

    if (doc_type) {
      const data = await runDesktopToolAsync('render_document', {
        doc_type,
        fields: { project_name: payload.project_name || 'Your Project', date: new Date().toISOString().slice(0, 10) },
        project_name: payload.project_name,
      });
      if (data.error) return { response: `Document creation failed: ${data.error}`, tools_used: [] };
      const block = `[MUDRAG_DOCUMENT]${JSON.stringify({ ...data, type: 'document' })}[/MUDRAG_DOCUMENT]`;
      const actions = [
        { label: 'Open Source File', text: '__open_source__' },
        { label: 'Open PDF', text: '__open_pdf__' },
        { label: 'Edit Template', text: 'customize the template — change the header color to dark blue' },
      ];
      return {
        response: `Created your **${doc_type.replace(/_/g, ' ')}** document — both the editable HTML source and PDF are saved to **Documents/openmud**.\n\n${block}\n\nYou can say "edit the template" to customize fonts, colors, and layout.\n\n[MUDRAG_ACTIONS]${JSON.stringify(actions)}[/MUDRAG_ACTIONS]`,
        tools_used: ['render_document'],
      };
    }
  }

  // Doc edit intent — "change the header color", "add a notes column to the template"
  if (DOC_EDIT_INTENT.test(routingText)) {
    const block = `[MUDRAG_EDIT_DOC]${JSON.stringify({ instruction: userText })}[/MUDRAG_EDIT_DOC]`;
    return {
      response: `Got it — I'll edit the document template based on your instructions.\n\n${block}`,
      tools_used: ['edit_template'],
    };
  }

  // Work finder intent: "find me a waterline job" / "search for sewer bids"
  if (WORK_FINDER_INTENT.test(routingText) && !BID_WORKFLOW_INTENT.test(routingText) && !FILE_MANAGEMENT_INTENT.test(routingText)) {
    const { trade, location } = parseWorkFinderIntent(routingText);
    const tradeLabel = trade || 'construction';

    // Run both email search and the new comprehensive web scraper in parallel
    const [emailBids, webResults] = await Promise.all([
      searchEmailBids(trade).catch(() => []),
      bidFinder.findBids(trade, location, process.env.SAM_GOV_API_KEY || null).catch(() => ({ bids: [], sources: {}, warnings: [] })),
    ]);

    const webBids  = webResults.bids || [];
    const emailCount = emailBids.length;
    const webCount   = webBids.length;
    const warnings = webResults.warnings || [];
    const warningText = warnings.length ? `\n\nNote: ${warnings.join(' ')}` : '';

    if (emailCount === 0 && webCount === 0) {
      const openLink = `[MUDRAG_ACTIONS]${JSON.stringify([{ label: 'Open Bid Finder', url: '/tools/bid-finder.html' }, { label: 'Browse SAM.gov', url: 'https://sam.gov/search/?index=opp' }, { label: 'Check Horrocks', url: 'https://www.horrocksplanroom.com/jobs/calendar' }])}[/MUDRAG_ACTIONS]`;
      return {
        response: `I searched for **${tradeLabel}** bids across SAM.gov, Horrocks, Utah Purchasing, Bonfire Hub, and QuestCDN but didn't find anything matching right now.${warningText}\n\nYou can scan all sources in the Bid Finder tool, or browse sources directly:\n\n${openLink}`,
        tools_used: ['find_work'],
      };
    }

    // Build combined results for display block
    const combined = {
      trade: trade || null, location: location || null,
      email_bids: emailBids,
      web_bids: webBids.map(b => ({ ...b, source_type: b.source?.toLowerCase().includes('federal') ? 'federal' : 'state' })),
      sources: webResults.sources,
      warnings,
      searched_at: new Date().toISOString(),
    };
    const block = `[MUDRAG_WORK_RESULTS]${JSON.stringify(combined)}[/MUDRAG_WORK_RESULTS]`;
    const openAction = `[MUDRAG_ACTIONS]${JSON.stringify([{ label: 'Open Bid Finder', url: '/tools/bid-finder.html' + (trade ? `?trade=${encodeURIComponent(trade)}` : '') }, { label: 'Export CSV', text: 'export bids to CSV' }])}[/MUDRAG_ACTIONS]`;
    const summary = `Found **${emailCount}** email bid${emailCount !== 1 ? 's' : ''} and **${webCount}** public bid${webCount !== 1 ? 's' : ''} for ${tradeLabel}.`;
    return { response: `${summary}${warningText}\n\n${block}\n\n${openAction}`, tools_used: ['find_work'] };
  }

  // Resume intent: create resume PDF from profile
  if (parseResumeIntent(routingText)) {
    const profile = storage.getProfile();
    if (!profile || !profile.name) {
      return {
        response: "I'll need your contact info first. Go to **Settings → Profile** (in the dropdown) and add your name, email, and phone. Or tell me: \"My name is X, email is Y, phone is Z\" and I'll save it.",
        tools_used: ['generate_resume_pdf'],
      };
    }
    const os = require('os');
    const ts = new Date().toISOString().slice(0, 10);
    const baseDir = path.join(os.homedir(), 'Desktop');
    const safeName = (profile.name || 'Resume').replace(/[^a-zA-Z0-9-_]/g, '_');
    const outputPath = path.join(baseDir, `Resume_${safeName}-${ts}.pdf`);
    const resumeContent = storage.getResumeContent();
    const data = await runDesktopToolAsync('generate_resume_pdf', {
      profile: { name: profile.name, email: profile.email, phone: profile.phone, city: profile.city, linkedin: profile.linkedin, website: profile.website, title: profile.title },
      output_path: outputPath,
      content: Object.keys(resumeContent).length ? resumeContent : undefined,
    });
    if (data.error) {
      return { response: `Couldn't create resume: ${data.error}. Make sure Chrome is installed.`, tools_used: ['generate_resume_pdf'] };
    }
    lastResumePath = data.path;
    const filename = path.basename(data.path);
    const resumeBlock = `[MUDRAG_RESUME]${JSON.stringify({ filename })}[/MUDRAG_RESUME]`;
    return {
      response: `Your resume is ready.\n\n${resumeBlock}`,
      tools_used: ['generate_resume_pdf'],
    };
  }

  // Bid workflow: multi-step bid building process
  if ((BID_WORKFLOW_INTENT.test(routingText) || (lastBidState && lastBidState.step === 'gathering')) && !isTargetedEmailLookupText(routingText)) {
    const state = parseBidDetails(messages);
    const stepResponse = getBidStepResponse(state);
    if (stepResponse) {
      setLastBidState(state);
      return { response: stepResponse, tools_used: ['bid_workflow'] };
    }
    const doc = generateBidDocument(state);
    const block = `[MUDRAG_BID_DOC]${JSON.stringify({ filename: doc.filename, content: doc.content })}[/MUDRAG_BID_DOC]`;
    const summary = `I've created a bid worksheet for **${state.project_name || 'this project'}** with everything we have so far. It's saved as a document in your project.\n\nNext steps:\n- Add more detail to the scope and I'll update the doc\n- Say "estimate" with quantities to price line items\n- Say "generate a proposal" when you're ready for the formal document\n\n${block}`;
    setLastBidState(null);
    return { response: summary, tools_used: ['bid_worksheet'] };
  }

  // Estimate/bid intent: build bid using user's rates (specific numbers provided)
  const estIntent = parseEstimateIntent(routingText);
  if (estIntent) {
    const data = await runDesktopToolAsync(estIntent.tool, estIntent.params);
    if (data.error) return { response: `Couldn't run estimate: ${data.error}`, tools_used: ['estimate_project_cost'] };
    setLastEstimateData(data);
    const sub = (data.subtotal || 0).toLocaleString();
    const total = (data.total || 0).toLocaleString();
    const laborSub = (data.labor?.subtotal || 0).toLocaleString();
    const equipSub = (data.equipment?.subtotal || 0).toLocaleString();
    const matSub = (data.materials?.subtotal || 0).toLocaleString();
    const markup = data.markup_percentage || 15;
    const actions = JSON.stringify([
      { label: 'Generate Proposal', text: 'generate a proposal' },
      { label: 'Build Schedule',    text: 'build a schedule' },
      { label: 'Export to PDF',     text: 'export to PDF' },
      { label: 'Export to CSV',     text: 'export to CSV' },
    ]);
    let response = `Estimate: $${total} total (subtotal $${sub})\n\n• Materials: $${matSub}\n• Labor: $${laborSub}\n• Equipment: $${equipSub}\n• Markup: ${markup}%\n\n[MUDRAG_ACTIONS]${actions}[/MUDRAG_ACTIONS]`;
    return { response, tools_used: [estIntent.tool] };
  }

  // Estimating plan intent — generate a structured .md plan and save to project
  if (ESTIMATE_PLAN_INTENT.test(routingText)) {
    const msgs = (body && body.messages) || messages || [];
    // Try to infer project name / scope from context
    const recentUser = msgs.filter((m) => m.role === 'user').slice(-3).map((m) => m.content).join(' ');
    const t = (recentUser || routingText).toLowerCase();

    let scope = 'Construction Project';
    let projectType = 'underground utility / civil';
    if (/waterline|water\s*main/i.test(t)) { scope = 'Water Main'; projectType = 'waterline installation'; }
    else if (/sewer|sanitary/i.test(t)) { scope = 'Sewer'; projectType = 'sewer installation'; }
    else if (/gas\s*(line|main)?/i.test(t)) { scope = 'Gas Line'; projectType = 'gas main installation'; }
    else if (/storm\s*(drain)?/i.test(t)) { scope = 'Storm Drain'; projectType = 'storm drain installation'; }
    else if (/pav|asphalt/i.test(t)) { scope = 'Paving'; projectType = 'asphalt paving'; }
    else if (/concrete/i.test(t)) { scope = 'Concrete'; projectType = 'concrete work'; }
    else if (/civil|road|highway/i.test(t)) { scope = 'Civil / Roadway'; projectType = 'civil construction'; }

    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const planContent = `# Estimating Plan — ${scope}
*Generated by openmud mud1 · ${today}*

---

## 1. Project Overview
- **Scope:** ${projectType}
- **Project Type:** [ ] Public (prevailing wage)  [ ] Private  [ ] Federal
- **Location / Region:** _______________
- **Estimated Duration:** _______________ days / weeks
- **Due Date:** _______________

---

## 2. Scope Review Checklist
- [ ] Read full plans and specifications
- [ ] Identify all bid items (LF, EA, CY, LS)
- [ ] Note alternates and unit prices required
- [ ] Check for liquidated damages clause
- [ ] Identify bid bond requirement (usually 5–10%)
- [ ] Review special conditions (traffic control, noise, hours)
- [ ] Flag unknown soil conditions / rock excavation
- [ ] Identify utility conflicts (call 811 before estimating depth)

---

## 3. Quantity Takeoff
| Item | Unit | Quantity | Notes |
|------|------|----------|-------|
| Pipe (main) | LF | | Size: ___ |
| Pipe (service) | LF | | |
| Manholes / Structures | EA | | |
| Valves / Hydrants | EA | | |
| Excavation | CY | | Soil type: ___ |
| Bedding | CY | | Class B or import |
| Backfill / Compaction | CY | | Native or import |
| Pavement Restoration | SF | | Asphalt / Concrete |
| Mobilization | LS | 1 | |
| Traffic Control | LS | 1 | |
| Erosion Control | LS | 1 | |

---

## 4. Labor Plan
| Crew | Rate | Hours/Day | Days | Total |
|------|------|-----------|------|-------|
| Operator | $85/hr | | | |
| Foreman | $55/hr | | | |
| Laborer (×2) | $35/hr | | | |
| **Subtotal** | | | | |

> Adjust for prevailing wage if public work — check wage determination.

---

## 5. Equipment Plan
| Equipment | Rate | Days | Total |
|-----------|------|------|-------|
| Excavator (Cat 320) | $400/day | | |
| Compactor | $100/day | | |
| Pump / Dewatering | $150/day | | |
| Shoring Box | $300/day | | |
| Auger / Drill | $450/day | | |

---

## 6. Material Pricing
- [ ] Get pipe quote from supplier (______________________)
- [ ] Get bedding / aggregate quote
- [ ] Get concrete quote (manholes, thrust blocks)
- [ ] Get valve / fitting quote
- [ ] Confirm lead times — anything >2 weeks?

---

## 7. Subcontractor Quotes Needed
- [ ] Survey / staking: $___________
- [ ] Traffic control: $___________
- [ ] Directional drill (if applicable): $___________
- [ ] Concrete restoration: $___________
- [ ] Specialty (e.g. CIPP, pipe lining): $___________

---

## 8. Markup & Contingency
| Component | Amount |
|-----------|--------|
| Direct Cost Subtotal | $ |
| Overhead & Profit (15%) | $ |
| Contingency (___%) | $ |
| **Total Bid** | **$** |

> Rule of thumb: 5% contingency for well-defined scope, 10–15% for unknown conditions.

---

## 9. Risk Factors
- [ ] Unknown soil / rock → add unit price alternate
- [ ] Groundwater / dewatering risk
- [ ] Existing utility conflicts
- [ ] Schedule constraints / L.D. exposure
- [ ] Material price escalation risk
- [ ] Subcontractor reliability

---

## 10. Submission Checklist
- [ ] Bid form complete (all unit prices filled in)
- [ ] Bid bond attached
- [ ] Addenda acknowledged
- [ ] Alternates priced
- [ ] Submitted on time ([ ] email  [ ] online portal  [ ] hand-delivered)

---

*Reference this plan during estimation and update as scope is clarified.*
*openmud commands: "Estimate [LF] of [pipe size] [type]" · "Generate a proposal" · "Build a schedule"*
`;

    const planBlock = `[MUDRAG_SAVE_DOC]${JSON.stringify({ name: `Estimating Plan — ${scope}.md`, content: planContent, type: 'text/markdown' })}[/MUDRAG_SAVE_DOC]`;
    const actions = [
      { label: 'Run Estimate', text: `Estimate the ${scope.toLowerCase()} based on this plan` },
      { label: 'Generate Proposal', text: 'generate a proposal' },
      { label: 'Build Schedule', text: 'build a schedule' },
    ];
    return {
      response: `Here's your **${scope} Estimating Plan**. I've saved it as a \`.md\` file in your project documents — you can open it anytime from the sidebar.\n\n${planBlock}\n\n[MUDRAG_ACTIONS]${JSON.stringify(actions)}[/MUDRAG_ACTIONS]`,
      tools_used: ['estimating_plan'],
    };
  }

  // HCSS HeavyBid export
  const shouldHandleHCSSExport =
    intentArbitration.primary === 'hcss_export' ||
    (intentArbitration.primary === null && HCSS_EXPORT_INTENT.test(routingText) && !BID2WIN_EXPORT_INTENT.test(routingText));
  if (shouldHandleHCSSExport) {
    const actions = [
      { label: 'Open CSV', text: '__open_last_csv__' },
      { label: 'Export to Bid2Win', text: 'export to Bid2Win' },
      { label: 'Generate Proposal', text: 'generate a proposal' },
    ];
    return {
      response: `Scanning your project files and formatting a **HCSS HeavyBid**-compatible import CSV now.\n\nThis file will include the columns HeavyBid expects: Item No., Description, Quantity, Unit, Unit Price, Amount, Section, and Notes — ready to import directly into your estimate.\n\n[MUDRAG_EXPORT_HCSS]{"hint":"${routingText.replace(/"/g, '')}"}[/MUDRAG_EXPORT_HCSS]\n\n[MUDRAG_ACTIONS]${JSON.stringify(actions)}[/MUDRAG_ACTIONS]`,
      tools_used: ['hcss_export'],
    };
  }

  // Bid2Win export
  const shouldHandleBid2WinExport =
    intentArbitration.primary === 'bid2win_export' ||
    (intentArbitration.primary === null && BID2WIN_EXPORT_INTENT.test(routingText));
  if (shouldHandleBid2WinExport) {
    const actions = [
      { label: 'Open CSV', text: '__open_last_csv__' },
      { label: 'Export to HCSS', text: 'export to HCSS HeavyBid' },
      { label: 'Generate Proposal', text: 'generate a proposal' },
    ];
    return {
      response: `Scanning your project files and formatting a **Bid2Win**-compatible import CSV now.\n\nThis file will include the columns Bid2Win expects: Item No, Item Code, Description, Quantity, Unit, Unit Price, Amount, Category, and Notes — ready to import directly into your Bid2Win estimate.\n\n[MUDRAG_EXPORT_BID2WIN]{"hint":"${routingText.replace(/"/g, '')}"}[/MUDRAG_EXPORT_BID2WIN]\n\n[MUDRAG_ACTIONS]${JSON.stringify(actions)}[/MUDRAG_ACTIONS]`,
      tools_used: ['bid2win_export'],
    };
  }

  // Plan sheet extraction — "extract bid items from plans", "read the specs", "auto-estimate from PDF"
  if (PLAN_EXTRACT_INTENT.test(routingText)) {
    const block = `[MUDRAG_EXTRACT_BID_ITEMS]${JSON.stringify({ hint: routingText })}[/MUDRAG_EXTRACT_BID_ITEMS]`;
    const actions = [
      { label: 'Run Estimate', text: 'estimate based on the extracted items' },
      { label: 'Export to CSV', text: 'export bid items to CSV' },
    ];
    return {
      response: `I'll scan your project PDFs for bid items and quantities. Select a PDF from your project documents and I'll extract all the line items.\n\n${block}\n\n[MUDRAG_ACTIONS]${JSON.stringify(actions)}[/MUDRAG_ACTIONS]`,
      tools_used: ['extract_bid_items'],
    };
  }

  // Generic CSV scan intent — tell the frontend to scan docs and extract bid items
  const shouldHandleCsvScan =
    intentArbitration.primary === 'csv_scan' ||
    (intentArbitration.primary === null && CREATE_CSV_INTENT.test(routingText));
  if (shouldHandleCsvScan) {
    const scanPayload = JSON.stringify({ type: 'bid_items', hint: routingText });
    const actions = [
      { label: 'Open CSV', text: '__open_last_csv__' },
      { label: 'Export to HCSS', text: 'export to HCSS HeavyBid' },
      { label: 'Export to Bid2Win', text: 'export to Bid2Win' },
      { label: 'Generate Proposal', text: 'generate a proposal' },
    ];
    return {
      response: `On it — scanning your project files for bid items, quantities, and line items now.\n\n[MUDRAG_SCAN_FOR_CSV]${scanPayload}[/MUDRAG_SCAN_FOR_CSV]\n\n[MUDRAG_ACTIONS]${JSON.stringify(actions)}[/MUDRAG_ACTIONS]`,
      tools_used: ['csv_scan'],
    };
  }

  // Agentic multi-step loop: for complex requests that need multiple tools in sequence
  if (needsAgenticLoop(routingText)) {
    try {
      const agenticResult = await agenticToolLoop(messages, userText, authToken);
      if (agenticResult) return agenticResult;
    } catch (e) {
      console.warn('[agentic loop] failed:', e.message);
    }
  }

  // ── Local file scan ────────────────────────────────────────────────────────
  const LOCAL_FILE_INTENT = /\b(find|search|scan|look\s+for|pull|grab|import|get)\b.{0,60}\b(file|files|doc|docs|document|documents|pdf|folder)\b.{0,60}\b(desktop|computer|mac|local|download|downloads|my\s+computer|hard\s+drive|finder|folder)\b|\b(desktop|my\s+computer|local\s+files?|my\s+files?|downloads?|finder)\b.{0,60}\b(find|search|scan|pull|import|look\s+for|get|grab)\b|\bpull\s+(files?|docs?|documents?)\s+(from|off)\b/i;
  if (LOCAL_FILE_INTENT.test(routingText)) {
    // Build search query from project name + user text
    const activeProject = (body && body.project_name) ? body.project_name : '';
    const combinedQuery = [activeProject, userText].join(' ');

    const result = scanLocalFiles({ query: combinedQuery, maxResults: 25 });
    const { files, keywords, inaccessibleRoots } = result;

    if (files.length === 0) {
      const kwStr = keywords.length ? keywords.join(', ') : 'project documents';
      const actions = [
        { label: 'Scan broader (no keyword filter)', text: 'scan my desktop for recent files' },
        { label: 'Open a folder in Finder', text: 'open desktop folder' },
      ];
      const inaccessible = Array.isArray(inaccessibleRoots) ? inaccessibleRoots : [];
      if (inaccessible.length > 0) {
        const blocked = inaccessible.map((r) => r.label).join(', ');
        return {
          response: `I couldn't scan some local folders because macOS blocked access (${blocked}).\n\nGrant openmud access in System Settings → Privacy & Security → Files and Folders (or Full Disk Access), restart openmud, then try again.\n\n[MUDRAG_ACTIONS]${JSON.stringify(actions)}[/MUDRAG_ACTIONS]`,
          tools_used: ['scan_local_files'],
        };
      }
      return {
        response: `I searched your Desktop, Downloads, Documents, and iCloud Drive for **${kwStr}** but didn't find matching files.\n\n[MUDRAG_ACTIONS]${JSON.stringify(actions)}[/MUDRAG_ACTIONS]`,
        tools_used: ['scan_local_files'],
      };
    }

    // Group by relevance tier
    const highRelevance = files.filter((f) => f.score >= 10);
    const others = files.filter((f) => f.score < 10);
    const kwStr = keywords.length ? `"${keywords.slice(0, 4).join('", "')}"` : 'recent files';
    const total = files.length;

    const block = `[MUDRAG_FILE_RESULTS]${JSON.stringify({
      files,
      query: combinedQuery,
      keywords,
      project: activeProject,
    })}[/MUDRAG_FILE_RESULTS]`;

    return {
      response: `Found **${total} file${total !== 1 ? 's' : ''}** on your computer matching ${kwStr}${highRelevance.length ? ` — **${highRelevance.length}** look highly relevant` : ''}.\n\nClick **Import** on any file to add it to this project, or **Import all relevant** to pull them all in at once.\n\n${block}`,
      tools_used: ['scan_local_files'],
    };
  }

  // ── UDOT Market Intelligence scan ─────────────────────────────────────────
  const UDOT_INTENT = /\b(udot|utah\s+dot|utah\s+department\s+of\s+transportation)\b.{0,80}\b(contractor|contractor\s+payment|bid|project|scan|pull|scrape|find|show|market|intel|who\s+is\s+working|who('?s|\s+is)\s+winning)\b|\b(contractor\s+payment|market\s+intel|who\s+is\s+working\s+for|who\s+works\s+for|udot\s+jobs|udot\s+contract|udot\s+project|udot\s+bid)\b/i;
  if (UDOT_INTENT.test(routingText)) {
    // Determine which sources to pull based on user query
    const wantAds = /\badvertis|bid\s+report|upcoming|advertise\b/i.test(routingText);
    const wantPayments = /\bpayment|paid|amount|contract\s+value|how\s+much\b/i.test(routingText);
    const wantAll = /\ball|everything|full\b/i.test(routingText);
    let sources = ['payments'];
    if (wantAds || wantAll) sources = wantPayments || wantAll ? ['payments', 'advertising'] : ['advertising'];

    try {
      const progressMsgs = [];
      const results = await scrapeUDOT(sources, (msg) => progressMsgs.push(msg));
      const contractors = parseContractorPayments(results);
      const summary = aggregateByContractor(contractors);

      if (summary.length === 0) {
        return {
          response: `I tried to pull UDOT contractor data but didn't get any rows. The Looker Studio report may have taken too long to load or has changed its layout.\n\nProgress: ${progressMsgs.join(' | ')}\n\nYou can open the reports directly:\n- [Contractor Payments](https://lookerstudio.google.com/u/0/reporting/65911f69-a708-4dac-9abb-a90caf87b9e9/page/p_hpbtriuwbd)\n- [Advertising Report](https://lookerstudio.google.com/u/0/reporting/2e81147b-2caf-4105-856d-3bcdcdefab9c/page/p_6a2zjbwync)`,
          tools_used: ['udot_scan'],
        };
      }

      // Format top contractors table
      const topN = summary.slice(0, 20);
      const tableRows = topN.map((c, i) =>
        `${i + 1}. **${c.name}** — $${c.totalPaid.toLocaleString('en-US', { maximumFractionDigits: 0 })} across ${c.projectCount} project${c.projectCount !== 1 ? 's' : ''} (${c.regions.join(', ')})`
      ).join('\n');

      const totalValue = summary.reduce((s, c) => s + c.totalPaid, 0);
      const totalFormatted = '$' + Math.round(totalValue).toLocaleString('en-US');

      const block = `[MUDRAG_WORK_RESULTS]${JSON.stringify({
        contractors: topN,
        total_contractors: summary.length,
        total_value: totalValue,
        sources: sources,
        scraped_at: new Date().toISOString(),
      })}[/MUDRAG_WORK_RESULTS]`;

      return {
        response: `Pulled UDOT data from **${sources.join(' + ')}**. Found **${summary.length} contractors** totaling **${totalFormatted}** in payments.\n\n**Top contractors by total paid:**\n${tableRows}\n\nTo reach out to any of these companies with a partnership opportunity, say: *"Draft an outreach email to [Company Name]"*\n\n${block}`,
        tools_used: ['udot_scan'],
      };
    } catch (err) {
      return {
        response: `UDOT scan failed: ${err.message}. You can open the reports directly at [Contractor Payments](https://lookerstudio.google.com/u/0/reporting/65911f69-a708-4dac-9abb-a90caf87b9e9/page/p_hpbtriuwbd).`,
        tools_used: [],
      };
    }
  }

  // ── UDOT outreach email draft ───────────────────────────────────────────────
  const UDOT_OUTREACH_INTENT = /\b(draft|write|send|email|reach\s+out)\b.{0,60}\b(partnership|subcontract|partner|work\s+together|collaborate|opportunity)\b/i;
  if (UDOT_OUTREACH_INTENT.test(routingText)) {
    // Extract company name from the user text
    const companyMatch = userText.match(/(?:to|for|outreach\s+to)\s+([A-Z][A-Z\s,.'&-]{3,60}?)(?:\s+(?:about|for|regarding)|[.?!]|$)/i);
    const company = companyMatch ? companyMatch[1].trim() : 'the contractor';
    const senderProfile = storage.getProfile();
    const senderName = senderProfile.name || 'Your Name';
    const senderCompany = senderProfile.company || 'Your Company';
    const senderEmail = senderProfile.email || DEFAULT_EMAIL_ACCOUNTS[0] || 'you@company.com';
    const emailBody = `Hi [Contact Name],

My name is ${senderName} with ${senderCompany}. I came across ${company} through UDOT's contractor records and noticed the significant work you're doing in the region — impressive portfolio.

We specialize in underground utility construction (waterline, sewer, gas, storm), civil/site work, and equipment operations across Utah. We're actively looking for partnership opportunities with prime contractors on UDOT and other DOT-funded projects.

I'd love to connect and explore whether there are opportunities to sub on any upcoming work. Would you be open to a quick call this week?

Best,
${senderName}
${senderCompany}
${senderEmail}`;

    const accounts = DEFAULT_EMAIL_ACCOUNTS;
    const block = `[MUDRAG_CHOOSE_EMAIL_ACCOUNT]${JSON.stringify({ accounts: accounts.map(e => ({ name: e.split('@')[0], email: e })), text: emailBody, to: company, subject: `Subcontractor Partnership — ${senderCompany}` })}[/MUDRAG_CHOOSE_EMAIL_ACCOUNT]`;
    return {
      response: `Here's a draft partnership outreach email for **${company}**. Select which account to send from:\n\n${block}`,
      tools_used: ['send_email'],
    };
  }

  // True RAG: retrieve + LLM. Handler calls mud1-fallback which does retrieval and GPT-4o.
  return { needFallback: true, messages };
}

// ── Ollama setup helper ───────────────────────────────────────────────────────
// States:
//   'ready'         — Ollama running + model pulled, good to go
//   'needs-model'   — Ollama running, model not pulled yet
//   'installed'     — binary/app found but server not reachable
//   'missing'       — nothing found, needs download
//   'unknown'       — couldn't determine

let ollamaStatus = 'unknown';
let ollamaProcess = null;

function isOllamaInstalled() {
  const { execFileSync } = require('child_process');
  const candidates = [
    '/Applications/Ollama.app',
    '/usr/local/bin/ollama',
    '/opt/homebrew/bin/ollama',
    '/usr/bin/ollama',
  ];
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return true; } catch (_) {}
  }
  try { execFileSync('which', ['ollama'], { stdio: 'ignore', timeout: 2000 }); return true; } catch (_) {}
  return false;
}

async function isOllamaRunning() {
  try {
    const r = await fetch(`${OLLAMA_BASE}/api/version`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch (_) { return false; }
}

async function isModelPulled(model) {
  try {
    const r = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return false;
    const data = await r.json();
    const models = (data.models || []).map(m => (m.name || '').split(':')[0].toLowerCase());
    return models.includes(model.toLowerCase());
  } catch (_) { return false; }
}

async function tryStartOllama() {
  // Try launching via the macOS app first
  try {
    spawn('open', ['-a', 'Ollama'], { detached: false, stdio: 'ignore' }).unref();
  } catch (_) {}
  // Also try ollama serve directly
  try {
    ollamaProcess = spawn('ollama', ['serve'], { detached: false, stdio: 'ignore' });
    ollamaProcess.unref();
  } catch (_) {}
  // Wait for server to come up
  await new Promise(r => setTimeout(r, 4000));
  return isOllamaRunning();
}

async function checkAndStartOllama() {
  const model = OLLAMA_MODEL;

  // 1. Already running?
  if (await isOllamaRunning()) {
    const pulled = await isModelPulled(model);
    ollamaStatus = pulled ? 'ready' : 'needs-model';
    return ollamaStatus;
  }

  // 2. Installed but not running?
  if (isOllamaInstalled()) {
    const started = await tryStartOllama();
    if (started) {
      const pulled = await isModelPulled(model);
      ollamaStatus = pulled ? 'ready' : 'needs-model';
      return ollamaStatus;
    }
    ollamaStatus = 'installed';
    return 'installed';
  }

  ollamaStatus = 'missing';
  return 'missing';
}

function notifyOllamaStatus(win, status) {
  if (!win || win.isDestroyed()) return;
  if (status === 'ready') return;
  win.webContents.send('mudrag:system', { type: 'ollama-setup', status, model: OLLAMA_MODEL });
}

async function chatViaOllamaOnly(body) {
  const { messages = [], max_tokens, temperature } = body || {};
  const chatMessages = messages.map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content || ''),
  }));
  const lastUser = chatMessages.filter((m) => m.role === 'user').pop();
  const userText = lastUser ? String(lastUser.content || '').trim() : '';

  // Build system prompt with RAG context injected
  let system = getMud1Prompt();
  let ragMeta = { confidence: 'low', fallback_used: true, sources: [] };
  try {
    const rag = require(path.join(getMud1Path(), 'src', 'rag.js'));
    const ragPkg = typeof rag.getRAGPackage === 'function'
      ? rag.getRAGPackage(userText, 6)
      : {
        context: rag.formatContextForLLM(rag.retrieveTopK(userText, 6)),
        confidence: 'medium',
        fallback_used: false,
        sources: [],
      };
    const ctx = ragPkg && ragPkg.context ? ragPkg.context : '';
    ragMeta = {
      confidence: ragPkg && ragPkg.confidence ? ragPkg.confidence : 'low',
      fallback_used: !!(ragPkg && ragPkg.fallback_used),
      sources: (ragPkg && Array.isArray(ragPkg.sources)) ? ragPkg.sources : [],
    };
    if (ctx && ctx.trim()) {
      // Place retrieved context BEFORE the rules so it's prioritized
      system = `${system}\n\n## KNOWLEDGE BASE — use this data for your answer:\n\n${ctx}\n\n## END KNOWLEDGE BASE`;
    }
  } catch (_) { /* ignore — continue without RAG context */ }

  try {
    const ollamaClient = require(path.join(getMud1Path(), 'src', 'ollama-client.js'));
    const result = await ollamaClient.chat({ system, messages: chatMessages, max_tokens, temperature });
    return {
      response: result.text || 'No response.',
      tools_used: [],
      model_used: result.model,
      usage: result.usage || null,
      rag: ragMeta,
    };
  } catch (err) {
    console.error('[mud1] Ollama chat error:', err.message);
    return null;
  }
}

async function recordDesktopUsage(authToken, payload) {
  if (!authToken) return;
  try {
    await fetch('https://openmud.ai/api/usage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
        'X-openmud-Source': 'desktop',
      },
      body: JSON.stringify(payload || {}),
      signal: AbortSignal.timeout(5000),
    });
  } catch (_) { /* best-effort only */ }
}

function startToolServer(cb) {
  const server = http.createServer(async (req, res) => {
    applyToolServerCors(req, res);
    if (req.method === 'OPTIONS') {
      res.writeHead(isAllowedToolServerOrigin(req.headers.origin) ? 200 : 403);
      res.end();
      return;
    }
    const pathname = (req.url || '').split('?')[0];
    if (req.method === 'GET' && pathname === '/api/config') {
      fetch('https://openmud.ai/api/config')
        .then((r) => r.json())
        .then((cfg) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(cfg));
        })
        .catch(() => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ supabaseUrl: '', supabaseAnonKey: '' }));
        });
      return;
    }
    if (req.method === 'GET' && pathname === '/api/platform') {
      fetch('https://openmud.ai/api/platform')
        .then((r) => r.json())
        .then((cfg) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(cfg));
        })
        .catch(() => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            beta_phase: true,
            default_model: 'mud1',
            tier_limits: { free: 5, personal: 100, pro: null, executive: null },
            notes: {
              mud1: 'mud1 is always free.',
              hosted_beta: 'A small hosted model set is available during beta with platform limits.',
              byok: 'You can always add your own provider keys in Settings.',
            },
            models: [],
          }));
        });
      return;
    }
    if (req.method === 'POST' && pathname === '/api/desktop-auth/start') {
      if (!isAllowedToolServerOrigin(req.headers.origin)) {
        sendJson(res, 403, { ok: false, error: 'Origin not allowed.' });
        return;
      }
      const startLimit = consumeRateLimit(
        desktopAuthAttemptState.startByIp,
        `start:${getToolServerClientIp(req)}`,
        12,
        60 * 1000
      );
      if (!startLimit.ok) {
        res.setHeader('Retry-After', String(Math.ceil(startLimit.retryAfterMs / 1000)));
        sendJson(res, 429, { ok: false, error: 'Too many auth handoff attempts. Try again shortly.' });
        return;
      }
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        try {
          const data = JSON.parse(body || '{}');
          const result = createDesktopAuthHandoff({ nextPath: data.nextPath || '/try' });
          sendJson(res, 200, result);
        } catch (e) {
          sendJson(res, 500, { ok: false, error: e.message });
        }
      });
      return;
    }
    if (req.method === 'POST' && pathname === '/api/desktop-auth/complete') {
      if (!isAllowedToolServerOrigin(req.headers.origin)) {
        sendJson(res, 403, { ok: false, error: 'Origin not allowed.' });
        return;
      }
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        try {
          const data = JSON.parse(body || '{}');
          const ipLimit = consumeRateLimit(
            desktopAuthAttemptState.completeByIp,
            `complete-ip:${getToolServerClientIp(req)}`,
            20,
            60 * 1000
          );
          const requestLimit = consumeRateLimit(
            desktopAuthAttemptState.completeByRequest,
            `complete-request:${String(data.requestId || '').trim() || 'unknown'}`,
            5,
            5 * 60 * 1000
          );
          if (!ipLimit.ok || !requestLimit.ok) {
            const retryAfterMs = Math.max(ipLimit.retryAfterMs || 0, requestLimit.retryAfterMs || 0);
            res.setHeader('Retry-After', String(Math.ceil(retryAfterMs / 1000)));
            sendJson(res, 429, { ok: false, error: 'Too many auth redemption attempts. Try again shortly.' });
            return;
          }
          const result = completeDesktopAuthHandoff(data.requestId, data);
          sendJson(res, result.ok ? 200 : 400, result);
        } catch (e) {
          sendJson(res, 500, { ok: false, error: e.message });
        }
      });
      return;
    }
    if (req.method === 'GET' && pathname === '/api/storage/rates') {
      try {
        const rates = storage.getRates();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(rates));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }
    if (req.method === 'POST' && pathname === '/api/storage/rates') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        try {
          const data = JSON.parse(body || '{}');
          const rates = storage.setRates(data);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(rates));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }
    if (req.method === 'GET' && pathname === '/api/storage/projects') {
      try {
        const projects = storage.getProjects();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(projects));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }
    if (req.method === 'POST' && pathname === '/api/storage/projects') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        try {
          const data = JSON.parse(body || '{}');
          if (Array.isArray(data)) {
            storage.setProjects(data);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data));
          } else {
            const project = storage.addProject(data);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(project));
          }
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }
    if (req.method === 'DELETE' && pathname.startsWith('/api/storage/projects/')) {
      const projectId = pathname.replace('/api/storage/projects/', '');
      try {
        const projects = storage.deleteProject(projectId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(projects));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }
    if (req.method === 'GET' && pathname === '/api/storage/profile') {
      try {
        const profile = storage.getProfile();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(profile));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }
    if (req.method === 'POST' && pathname === '/api/storage/profile') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        try {
          const data = JSON.parse(body || '{}');
          const profile = storage.setProfile(data);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(profile));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }
    if (req.method === 'GET' && pathname === '/api/storage/user-data') {
      try {
        const data = storage.getUserData();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }
    if (req.method === 'POST' && pathname === '/api/storage/user-data') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        try {
          const data = JSON.parse(body || '{}');
          const result = storage.setUserData(data);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }
    if (req.method === 'POST' && pathname === '/api/data-sync/contacts') {
      try {
        const result = await dataSync.syncContacts();
        if (result.ok) {
          const existing = storage.getUserData();
          storage.setUserData({
            contacts: result.contacts,
            lastSyncedContacts: new Date().toISOString(),
            companyInfo: existing.companyInfo || {},
          });
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
      return;
    }
    if (req.method === 'POST' && pathname === '/api/data-sync/emails') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', async () => {
        try {
          const opts = JSON.parse(body || '{}');
          const result = await dataSync.syncEmails(opts);
          if (result.ok) {
            storage.setUserData({
              recentEmails: result.emails,
              lastSyncedEmails: new Date().toISOString(),
            });
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
      return;
    }
    if (req.method === 'GET' && pathname === '/api/data-sync/status') {
      try {
        const data = storage.getUserData();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          lastSyncedContacts: data.lastSyncedContacts || null,
          lastSyncedEmails: data.lastSyncedEmails || null,
          contactCount: (data.contacts || []).length,
          emailCount: (data.recentEmails || []).length,
        }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }
    if (req.method === 'POST' && pathname === '/api/resume/generate') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', async () => {
        try {
          const opts = JSON.parse(body || '{}');
          const profile = storage.getProfile();
          if (!profile || !profile.name) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'No profile found. Go to Settings → Profile and add your name first.' }));
            return;
          }
          const resumeContent = opts.content || storage.getResumeContent();
          const ts = new Date().toISOString().slice(0, 10);
          const safeName = (profile.name || 'Resume').replace(/[^a-zA-Z0-9-_]/g, '_');
          const resumeDir = path.join(require('os').homedir(), 'Desktop');
          const outputPath = path.join(resumeDir, `Resume_${safeName}_${ts}.pdf`);
          const data = await runDesktopToolAsync('generate_resume_pdf', {
            profile: {
              name: profile.name,
              email: profile.email,
              phone: profile.phone,
              city: profile.city,
              linkedin: profile.linkedin,
              website: profile.website,
              title: profile.title,
            },
            output_path: outputPath,
            content: Object.keys(resumeContent).length ? resumeContent : undefined,
          });
          if (data.error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: data.error }));
            return;
          }
          lastResumePath = data.path;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, path: data.path, filename: path.basename(data.path) }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }
    if (req.method === 'GET' && pathname === '/api/resume/latest') {
      if (!lastResumePath || !fs.existsSync(lastResumePath)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No resume generated yet' }));
        return;
      }
      const filename = path.basename(lastResumePath);
      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      });
      fs.createReadStream(lastResumePath).pipe(res);
      return;
    }
    if (req.method === 'POST' && pathname === '/api/chat') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', async () => {
        try {
          const payload = JSON.parse(body || '{}');
          const model = payload.model || 'mud1';
          const auth = req.headers?.authorization;
          const headers = { 'Content-Type': 'application/json' };
          if (auth) headers['Authorization'] = auth;

          // Run local tool intents FIRST (no auth needed) — estimates, bids, proposals, schedules, desktop tools
          // Pass auth token so agentic loop can call the backend for Claude steps
          const authToken = auth ? auth.replace(/^Bearer\s+/i, '') : null;
          try {
            const result = await chatViaOllama(payload, authToken);
            const wasHandledLocally = result && result.tools_used && result.tools_used.length > 0;
            if (wasHandledLocally) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(result));
              return;
            }
            // mud1: Try local Ollama first, then fall back to cloud
            if (model === 'mud1' && result && result.needFallback && result.messages) {
              // 1) Try local Ollama
              try {
                const ollamaLocal = await chatViaOllamaOnly({ messages: result.messages });
                if (ollamaLocal && ollamaLocal.response) {
                  await recordDesktopUsage(authToken, {
                    model: 'mud1',
                    request_type: 'chat',
                    source: 'desktop',
                    input_tokens: ollamaLocal.usage?.prompt_tokens || 0,
                    output_tokens: ollamaLocal.usage?.completion_tokens || 0,
                  });
                  res.writeHead(200, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({
                    response: ollamaLocal.response,
                    tools_used: [],
                    model_used: ollamaLocal.model_used,
                    usage_tracked: true,
                    rag: ollamaLocal.rag || undefined,
                  }));
                  return;
                }
              } catch (_) { /* Ollama not running — fall through to cloud */ }

              // 2) Cloud fallback (mud1-fallback endpoint)
              const apiBase = 'https://openmud.ai';
              const fallbackHeaders = { 'Content-Type': 'application/json' };
              if (req.headers?.authorization) fallbackHeaders['Authorization'] = req.headers.authorization;
              fallbackHeaders['X-openmud-Source'] = 'desktop';
              try {
                const fallbackRes = await fetch(`${apiBase}/api/mud1-fallback`, {
                  method: 'POST',
                  headers: fallbackHeaders,
                  body: JSON.stringify({ messages: result.messages }),
                  signal: AbortSignal.timeout(20000),
                });
                const fallbackData = await fallbackRes.json().catch(() => ({}));
                if (fallbackRes.ok && fallbackData.response) {
                  res.writeHead(200, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({
                    response: fallbackData.response,
                    tools_used: [],
                    usage_tracked: true,
                    rag: fallbackData.rag || undefined,
                  }));
                  return;
                }
                // Cloud returned an error (429, 500, etc.) — never forward raw errors to the client.
                // Instead return a friendly message so the user always gets a useful response.
                const offlineMsg = fallbackRes.status === 429
                  ? "The cloud AI is over its usage limit. Switch to **mud1** (local) in the model picker — it's free and runs on your machine with no API key needed."
                  : "I couldn't reach the AI right now. Make sure Ollama is running for local responses, or check your connection. I can still help with estimates, proposals, schedules, and project tools — just ask.";
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ response: offlineMsg, tools_used: [] }));
                return;
              } catch (e) {
                // Network failure — always return a friendly 200, never a 5xx
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ response: "I'm offline right now. Make sure Ollama is running for local AI, or check your connection. I can still run estimates, proposals, and schedules — what do you need?", tools_used: [] }));
                return;
              }
            }
            // For mud1 model, return all other responses (bundled, RAG)
            if (model === 'mud1') {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(result));
              return;
            }
          } catch (e) {
            if (model === 'mud1') {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ response: "Something went wrong. Try asking again.", tools_used: [] }));
              return;
            }
          }

          // Cloud models (GPT, Claude) need auth — check usage status then proxy
          const cloudBase = 'https://openmud.ai';
          try {
            const usageRes = await fetch(`${cloudBase}/api/usage`, {
              method: 'GET',
              headers,
              signal: AbortSignal.timeout(5000),
            });
            if (usageRes.ok) {
              const data = await usageRes.json().catch(() => ({}));
              if (data && data.limit != null && data.used >= data.limit) {
                res.writeHead(429, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: `Daily limit reached (${data.used}/${data.limit}). Upgrade at openmud.ai/subscribe.html`, response: null, usage: data.used != null ? { used: data.used, limit: data.limit, date: data.date } : undefined }));
                return;
              }
            }
          } catch (e) { /* usage check failed, continue to cloud anyway */ }

          try {
            const cloudRes = await fetch(`${cloudBase}/api/chat`, {
              method: 'POST',
              headers: { ...headers, 'X-openmud-Source': 'desktop' },
              body: JSON.stringify(payload),
              signal: AbortSignal.timeout(60000),
            });
            if (cloudRes.ok) {
              const cloudData = await cloudRes.text();
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(cloudData);
            } else if (cloudRes.status === 429) {
              res.writeHead(429, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'rate_limited', response: null }));
            } else {
              // Any other cloud error — give a friendly offline message
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ response: "I couldn't reach the cloud AI right now. Try switching to **mud1** (local, no internet needed) in the model picker.", tools_used: [] }));
            }
          } catch (e) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ response: "I couldn't reach the cloud API. Check your connection or switch to **mud1** in the model picker for offline use.", tools_used: [] }));
          }
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message || 'Invalid request' }));
        }
      });
      return;
    }
    if (req.method === 'POST' && pathname === '/run-tool') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        const { tool, params } = JSON.parse(body || '{}');
        if (!tool) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'tool required' }));
          return;
        }
        runDesktopTool(tool, params || {}, (result) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(result);
        });
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
      return;
    }
    if (req.method === 'GET' && pathname.startsWith('/api/')) {
      const cloudBase = 'https://openmud.ai';
      const cloudUrl = cloudBase + (req.url || pathname);
      const headers = { 'Content-Type': 'application/json' };
      const auth = req.headers?.authorization;
      if (auth) headers['Authorization'] = auth;
      const source = req.headers?.['x-mudrag-source'];
      if (source) headers['X-openmud-Source'] = source;
      fetch(cloudUrl, { method: 'GET', headers }).then((r) => {
        res.writeHead(r.status, { 'Content-Type': r.headers.get('content-type') || 'application/json' });
        return r.text();
      }).then((t) => res.end(t)).catch(() => {
        res.writeHead(502);
        res.end(JSON.stringify({ error: 'Could not reach cloud API' }));
      });
      return;
    }
    if ((req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') && pathname.startsWith('/api/') && pathname !== '/api/chat') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const cloudBase = 'https://openmud.ai';
        const cloudUrl = cloudBase + (req.url || pathname);
        const headers = { 'Content-Type': 'application/json' };
        const auth = req.headers?.authorization;
        if (auth) headers['Authorization'] = auth;
        const source = req.headers?.['x-mudrag-source'];
        if (source) headers['X-openmud-Source'] = source;
        fetch(cloudUrl, { method: req.method, headers, body }).then((r) => {
          res.writeHead(r.status, { 'Content-Type': r.headers.get('content-type') || 'application/json' });
          return r.text();
        }).then((t) => res.end(t)).catch(() => {
          res.writeHead(502);
          res.end(JSON.stringify({ error: 'Could not reach cloud API' }));
        });
      });
      return;
    }
    // ── /bids — comprehensive bid scraper (desktop only) ──────────────────────
    if (req.method === 'GET' && (pathname === '/bids' || pathname === '/api/bids')) {
      const qs = new URLSearchParams((req.url || '').split('?')[1] || '');
      const trade    = qs.get('trade')    || null;
      const location = qs.get('location') || null;
      const samKey   = qs.get('samKey')   || process.env.SAM_GOV_API_KEY || null;
      try {
        const results = await bidFinder.findBids(trade, location, samKey);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(results));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message, bids: [], sources: {} }));
      }
      return;
    }
    if (req.method === 'GET') {
      let filePath = pathname === '/' || pathname === '/try' ? '/try.html' : pathname;
      if (!filePath.startsWith('/')) filePath = '/' + filePath;
      const safePath = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, '').replace(/^\//, '');
      const fullPath = path.join(getWebPath(), safePath);
      if (!fullPath.startsWith(getWebPath())) {
        res.writeHead(403);
        res.end();
        return;
      }
      fs.readFile(fullPath, (err, data) => {
        if (err) {
          if (err.code === 'ENOENT') {
            const idxPath = path.join(getWebPath(), 'index.html');
            fs.readFile(idxPath, (e2, d2) => {
              if (e2) { res.writeHead(404); res.end(); return; }
              res.writeHead(200, { 'Content-Type': 'text/html' });
              res.end(d2);
            });
          } else {
            res.writeHead(500);
            res.end();
          }
          return;
        }
        const ext = path.extname(fullPath);
        const mime = MIME[ext] || 'application/octet-stream';
        const headers = { 'Content-Type': mime };
        if (process.env.DEV === '1' && (ext === '.html' || ext === '.js' || ext === '.css')) {
          headers['Cache-Control'] = 'no-store, no-cache, must-revalidate';
        }
        res.writeHead(200, headers);
        res.end(data);
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  let port = TOOL_SERVER_PORT;
  server.once('listening', () => {
    const actualPort = server.address().port;
    console.log('openmud tool server on', actualPort);
    if (process.env.DEV === '1') {
      console.log('[dev] serving web from:', getWebPath());
      console.log('[dev] Edit web/ files and save – window should auto-reload. Title bar shows [DEV] when running from project.');
    }
    cb(actualPort);
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && port < TOOL_SERVER_PORT + 10) {
      port++;
      console.log('Port in use, retrying on', port);
      setTimeout(() => server.listen(port, '127.0.0.1'), 250);
    } else {
      throw err;
    }
  });
  server.listen(port, '127.0.0.1');
}

function createWindow(toolPort) {
  activeToolPort = toolPort;
  mainWindowRef = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: '',
    backgroundColor: '#000000',
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 10, y: 9 },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  const win = mainWindowRef;

  // Dev: load from tool server (serves web/ files directly) so local changes appear instantly.
  // Prod: load from openmud.ai — the tool server on 3847 intercepts API/chat calls.
  const appUrl = isDev
    ? `http://localhost:${toolPort}/try?toolPort=${toolPort}&useDesktopApi=1`
    : `https://openmud.ai/try?toolPort=${toolPort}&useDesktopApi=1`;
  const desktopUA = `mudrag-desktop/${app.getVersion()}`;
  win.webContents.setUserAgent(desktopUA);
  const loadOpts = { userAgent: desktopUA };
  if (isDev) loadOpts.reloadIgnoringCache = true;
  win.loadURL(appUrl, loadOpts).catch(() => {});
  win.webContents.on('page-title-updated', () => { win.setTitle(''); });
  win.webContents.once('did-finish-load', () => {
    win.setTitle('');
    emitUpdateState();
    flushPendingAuthCallback();
  });
  if (isDev) win.webContents.openDevTools();

  // The app window is the AI assistant (/try). Everything else — settings, billing,
  // account, docs — opens in the system browser so users can always get back to the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    const u = url.toLowerCase();
    const isTryPage = u.includes('/try') || u.includes(`localhost:${toolPort}`) || u.includes('localhost:3947') || u.includes('localhost:3948');
    if (!isTryPage) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  win.on('closed', () => {
    mainWindowRef = null;
    app.quit();
  });
}

let updateListenersConfigured = false;
let updateCheckPromise = null;
let updateDownloadPromise = null;
let lastUpdateCheckContext = { manual: false, source: 'auto' };
let updateState = {
  status: 'idle',
  message: '',
  error: '',
  progress: 0,
  availableVersion: '',
  downloadedVersion: '',
  checkedAt: null,
};

function isTranslocatedApp() {
  try {
    return String(app.getPath('exe') || '').includes('/AppTranslocation/');
  } catch (err) {
    return false;
  }
}

function canUseAutoUpdater() {
  return !isDev && app.isPackaged && !isTranslocatedApp();
}

function getUpdatePreferences() {
  const userData = storage.getUserData() || {};
  const prefs = userData.updatePreferences || {};
  return {
    autoCheckForUpdates: prefs.autoCheckForUpdates !== false,
    autoDownloadUpdates: prefs.autoDownloadUpdates !== false,
    installUpdatesOnQuit: prefs.installUpdatesOnQuit !== false,
  };
}

function applyUpdatePreferences() {
  const prefs = getUpdatePreferences();
  autoUpdater.autoDownload = !!prefs.autoDownloadUpdates;
  autoUpdater.autoInstallOnAppQuit = !!prefs.installUpdatesOnQuit;
  if ('autoRunAppAfterInstall' in autoUpdater) {
    autoUpdater.autoRunAppAfterInstall = true;
  }
  return prefs;
}

function getUpdateState() {
  return {
    currentVersion: app.getVersion(),
    canCheck: canUseAutoUpdater(),
    isPackaged: !!app.isPackaged,
    isTranslocated: isTranslocatedApp(),
    preferences: getUpdatePreferences(),
    ...updateState,
  };
}

function emitUpdateState() {
  const menu = Menu.getApplicationMenu && Menu.getApplicationMenu();
  const installItem = menu && menu.getMenuItemById ? menu.getMenuItemById('install-update-now') : null;
  const autoCheckItem = menu && menu.getMenuItemById ? menu.getMenuItemById('pref-auto-check-updates') : null;
  const autoDownloadItem = menu && menu.getMenuItemById ? menu.getMenuItemById('pref-auto-download-updates') : null;
  const installOnQuitItem = menu && menu.getMenuItemById ? menu.getMenuItemById('pref-install-updates-on-quit') : null;
  const prefs = getUpdatePreferences();
  if (installItem) installItem.enabled = updateState.status === 'downloaded';
  if (autoCheckItem) autoCheckItem.checked = !!prefs.autoCheckForUpdates;
  if (autoDownloadItem) autoDownloadItem.checked = !!prefs.autoDownloadUpdates;
  if (installOnQuitItem) installOnQuitItem.checked = !!prefs.installUpdatesOnQuit;
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send('mudrag:update-state', getUpdateState());
  }
}

function setUpdateState(patch) {
  updateState = {
    ...updateState,
    ...(patch || {}),
  };
  emitUpdateState();
  return getUpdateState();
}

function maybeShowManualUpdateDialog(type, message) {
  if (!lastUpdateCheckContext.manual || lastUpdateCheckContext.source !== 'menu') return;
  dialog.showMessageBox({
    type: type || 'info',
    message,
  }).catch(() => {});
}

function ensureAutoUpdaterConfigured() {
  if (updateListenersConfigured) {
    applyUpdatePreferences();
    return;
  }
  updateListenersConfigured = true;
  applyUpdatePreferences();

  autoUpdater.on('checking-for-update', () => {
    setUpdateState({
      status: 'checking',
      message: 'Checking for updates…',
      error: '',
      progress: 0,
      checkedAt: new Date().toISOString(),
    });
  });

  autoUpdater.on('update-available', (info) => {
    const version = String(info && info.version || '');
    const prefs = getUpdatePreferences();
    setUpdateState({
      status: prefs.autoDownloadUpdates ? 'downloading' : 'available',
      message: prefs.autoDownloadUpdates ? `Downloading openmud ${version}…` : `openmud ${version} is available.`,
      error: '',
      progress: 0,
      availableVersion: version,
      downloadedVersion: '',
      checkedAt: new Date().toISOString(),
    });
    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
      mainWindowRef.webContents.send('mudrag:update-available', getUpdateState());
    }
  });

  autoUpdater.on('update-not-available', () => {
    updateCheckPromise = null;
    updateDownloadPromise = null;
    setUpdateState({
      status: 'up-to-date',
      message: `You're up to date. openmud ${app.getVersion()}`,
      error: '',
      progress: 0,
      availableVersion: '',
      downloadedVersion: '',
      checkedAt: new Date().toISOString(),
    });
    maybeShowManualUpdateDialog('info', `You're up to date. openmud ${app.getVersion()}`);
  });

  autoUpdater.on('download-progress', (progress) => {
    const pct = Math.max(0, Math.min(100, Math.round(progress && progress.percent || 0)));
    const version = updateState.availableVersion || updateState.downloadedVersion || '';
    const label = version ? `Downloading openmud ${version}… ${pct}%` : `Downloading update… ${pct}%`;
    setUpdateState({
      status: 'downloading',
      message: label,
      error: '',
      progress: pct,
    });
    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
      mainWindowRef.webContents.send('mudrag:update-progress', { pct, label });
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    updateCheckPromise = null;
    updateDownloadPromise = null;
    const version = String(info && info.version || updateState.availableVersion || '');
    setUpdateState({
      status: 'downloaded',
      message: version ? `openmud ${version} is ready to install.` : 'Update is ready to install.',
      error: '',
      progress: 100,
      downloadedVersion: version,
      availableVersion: version || updateState.availableVersion,
      checkedAt: new Date().toISOString(),
    });
    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
      mainWindowRef.webContents.send('mudrag:update-available', getUpdateState());
      mainWindowRef.webContents.send('mudrag:update-progress', {
        pct: 100,
        label: version ? `openmud ${version} is ready to install.` : 'Update is ready to install.',
      });
    }
  });

  autoUpdater.on('error', (err) => {
    updateCheckPromise = null;
    updateDownloadPromise = null;
    const message = String(err && err.message || 'Could not check for updates.');
    setUpdateState({
      status: 'error',
      message,
      error: message,
    });
    maybeShowManualUpdateDialog('error', message);
  });
}

function setUpdatePreferences(nextPrefs) {
  const merged = {
    ...UPDATE_PREFS_DEFAULTS,
    ...getUpdatePreferences(),
    ...(nextPrefs || {}),
  };
  storage.setUserData({ updatePreferences: merged });
  applyUpdatePreferences();
  emitUpdateState();
  return getUpdateState();
}

async function checkForUpdates(manual, source) {
  lastUpdateCheckContext = { manual: !!manual, source: source || (manual ? 'renderer' : 'auto') };
  ensureAutoUpdaterConfigured();

  if (!canUseAutoUpdater()) {
    const message = isDev || !app.isPackaged
      ? 'Update checks are only available in packaged builds.'
      : 'Install openmud in Applications before using automatic updates.';
    setUpdateState({
      status: 'unsupported',
      message,
      error: '',
      progress: 0,
    });
    maybeShowManualUpdateDialog('info', message);
    return { ok: false, skipped: true, reason: 'unsupported', state: getUpdateState() };
  }

  if (updateCheckPromise) {
    return { ok: true, queued: true, state: getUpdateState() };
  }

  updateCheckPromise = autoUpdater.checkForUpdates()
    .then(() => ({ ok: true, state: getUpdateState() }))
    .catch((err) => {
      const message = String(err && err.message || 'Could not check for updates.');
      setUpdateState({
        status: 'error',
        message,
        error: message,
      });
      maybeShowManualUpdateDialog('error', message);
      return { ok: false, error: message, state: getUpdateState() };
    })
    .finally(() => {
      updateCheckPromise = null;
    });

  return updateCheckPromise;
}

async function downloadUpdate(manual) {
  ensureAutoUpdaterConfigured();
  if (!canUseAutoUpdater()) {
    return { ok: false, error: 'Automatic updates are only available in the installed desktop app.' };
  }
  if (updateState.status === 'downloaded') {
    return { ok: true, alreadyDownloaded: true, state: getUpdateState() };
  }
  if (!updateState.availableVersion) {
    return { ok: false, error: 'No update is available to download.', state: getUpdateState() };
  }
  if (updateDownloadPromise) {
    return { ok: true, queued: true, state: getUpdateState() };
  }
  lastUpdateCheckContext = { manual: !!manual, source: manual ? 'renderer' : 'auto' };
  setUpdateState({
    status: 'downloading',
    message: updateState.availableVersion
      ? `Downloading openmud ${updateState.availableVersion}…`
      : 'Downloading update…',
    error: '',
    progress: 0,
  });
  updateDownloadPromise = autoUpdater.downloadUpdate()
    .then(() => ({ ok: true, state: getUpdateState() }))
    .catch((err) => {
      const message = String(err && err.message || 'Could not download the update.');
      setUpdateState({
        status: 'error',
        message,
        error: message,
      });
      return { ok: false, error: message, state: getUpdateState() };
    })
    .finally(() => {
      updateDownloadPromise = null;
    });
  return updateDownloadPromise;
}

ipcMain.handle('mudrag:get-update-state', async () => {
  ensureAutoUpdaterConfigured();
  return getUpdateState();
});

ipcMain.handle('mudrag:get-update-preferences', async () => getUpdatePreferences());

ipcMain.handle('mudrag:set-update-preferences', async (_, prefs) => setUpdatePreferences(prefs));

ipcMain.handle('mudrag:download-update', async () => downloadUpdate(true));

ipcMain.handle('mudrag:install-update', async () => {
  ensureAutoUpdaterConfigured();
  if (updateState.status !== 'downloaded') {
    return { ok: false, error: 'No downloaded update is ready to install.', state: getUpdateState() };
  }
  setUpdateState({
    status: 'installing',
    message: 'Restarting to install update…',
    error: '',
  });
  setTimeout(() => {
    try {
      autoUpdater.quitAndInstall(false, true);
    } catch (err) {
      const message = String(err && err.message || 'Could not install the update.');
      setUpdateState({
        status: 'error',
        message,
        error: message,
      });
    }
  }, 120);
  return { ok: true, restarting: true, state: getUpdateState() };
});

ipcMain.handle('mudrag:check-update-manual', async () => checkForUpdates(true, 'renderer'));

// ── Document Template IPC ────────────────────────────────────────────────────

ipcMain.handle('mudrag:open-doc-source', async (_, htmlPath) => {
  if (htmlPath && fs.existsSync(htmlPath)) {
    shell.openPath(htmlPath);
    return { ok: true };
  }
  return { ok: false, error: 'File not found' };
});

ipcMain.handle('mudrag:open-doc-folder', async (_, folderPath) => {
  if (folderPath && fs.existsSync(folderPath)) {
    shell.openPath(folderPath);
    return { ok: true };
  }
  const mudragDocs = path.join(require('os').homedir(), 'Documents', 'openmud', 'Documents');
  shell.openPath(mudragDocs);
  return { ok: true };
});

ipcMain.handle('mudrag:read-template-source', async (_, docType) => {
  try {
    const data = await runDesktopToolAsync('read_template_source', { doc_type: docType });
    return data;
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('mudrag:edit-doc', async (_, { docType, instruction, htmlPath, authToken }) => {
  // Read current source (from saved instance or master template)
  let currentSource = null;
  if (htmlPath && fs.existsSync(htmlPath)) {
    currentSource = fs.readFileSync(htmlPath, 'utf8');
  } else {
    const data = await runDesktopToolAsync('read_template_source', { doc_type: docType }).catch(() => ({}));
    currentSource = data.source || null;
  }
  if (!currentSource) {
    return { error: 'No template source found to edit.' };
  }

  // Ask the backend to edit the source
  try {
    const cloudBase = 'https://openmud.ai';
    const editRes = await fetch(`${cloudBase}/api/agentic-step`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
        'X-openmud-Source': 'desktop',
      },
      body: JSON.stringify({
        messages: [{
          role: 'user',
          content: `You are editing an HTML document template for a construction company. Here is the current HTML source:\n\n\`\`\`html\n${currentSource.slice(0, 12000)}\n\`\`\`\n\nUser instruction: "${instruction}"\n\nReturn ONLY the complete updated HTML — no explanation, no markdown fences, just raw HTML starting with <!DOCTYPE html>.`,
        }],
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!editRes.ok) {
      const d = await editRes.json().catch(() => ({}));
      return { error: d.error || 'AI edit failed' };
    }

    const editData = await editRes.json();
    let newSource = editData.text || '';
    // Strip any markdown fences Claude might add
    newSource = newSource.replace(/^```html?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    if (!newSource.toLowerCase().startsWith('<!doctype') && !newSource.toLowerCase().startsWith('<html')) {
      return { error: 'AI did not return valid HTML. Try rephrasing your edit instruction.' };
    }

    // Save updated source
    if (htmlPath && fs.existsSync(htmlPath)) {
      fs.writeFileSync(htmlPath, newSource, 'utf8');
    } else if (docType) {
      await runDesktopToolAsync('update_template_source', { doc_type: docType, source: newSource });
    }

    // Open the updated file
    const targetPath = htmlPath || path.join(require('os').homedir(), 'Documents', 'openmud', 'Templates', docType, 'master.html');
    if (fs.existsSync(targetPath)) shell.openPath(targetPath);

    return { ok: true, message: 'Template updated and saved. Open it to see the changes.' };
  } catch (e) {
    return { error: e.message };
  }
});

// ── Bid Watcher IPC ─────────────────────────────────────────────────────────
ipcMain.handle('mudrag:bid-watch-add', async (_, criteria) => {
  return bidWatcher.addWatch(criteria || {});
});
ipcMain.handle('mudrag:bid-watch-remove', async (_, watchId) => {
  return bidWatcher.removeWatch(watchId);
});
ipcMain.handle('mudrag:bid-watch-list', async () => {
  return bidWatcher.listWatches();
});
ipcMain.handle('mudrag:bid-watch-check-now', async () => {
  return bidWatcher.runAllWatches();
});

ipcMain.handle('mudrag:open-external', async (_, url) => {
  if (url && /^https?:\/\//i.test(url)) {
    shell.openExternal(url);
    return { ok: true };
  }
  return { ok: false, error: 'Invalid URL' };
});

ipcMain.handle('mudrag:begin-auth-handoff', async (_, opts = {}) => {
  return createDesktopAuthHandoff({ nextPath: opts.nextPath || '/try' });
});

ipcMain.handle('mudrag:set-window-title', async (_, title) => {
  const w = BrowserWindow.getFocusedWindow() || mainWindowRef;
  if (w && !w.isDestroyed()) w.setTitle(title ?? '');
});

ipcMain.handle('mudrag:open-folder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
    title: 'Choose project folder',
    message: 'Select a folder for this project. Bids and proposals will be saved here.',
  });
  if (result.canceled || !result.filePaths || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('mudrag:open-chat-window', async (_, { projectId, chatId }) => {
  if (!projectId) return { ok: false, error: 'No projectId' };
  const port = activeToolPort;
  const base = isDev
    ? `http://localhost:${port}/try?toolPort=${port}&useDesktopApi=1`
    : `https://openmud.ai/try?toolPort=${port}&useDesktopApi=1`;
  const url = `${base}&chatWindow=1&projectId=${encodeURIComponent(projectId)}&chatId=${encodeURIComponent(chatId || '')}`;
  const win = new BrowserWindow({
    width: 900,
    height: 680,
    minWidth: 600,
    minHeight: 440,
    title: '',
    backgroundColor: '#000000',
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 10, y: 9 },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  const loadOpts = { userAgent: `mudrag-desktop/${app.getVersion()}` };
  win.loadURL(url, loadOpts).catch(() => {});
  win.webContents.on('page-title-updated', () => { win.setTitle(''); });
  win.webContents.once('did-finish-load', () => { win.setTitle(''); });
  return { ok: true };
});

ipcMain.handle('mudrag:open-mail', async (_, { sender, subject, index = 0 }) => {
  const { execSync } = require('child_process');
  const fs = require('fs');
  const os = require('os');
  const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const senderEsc = esc(sender || '');
  const subjectEsc = esc(subject || '');
  const idx = parseInt(index, 10) || 0;
  let condition;
  if (senderEsc && subjectEsc) {
    condition = `(sender of it contains "${senderEsc}") and (subject of it contains "${subjectEsc}")`;
  } else if (senderEsc) {
    condition = `sender of it contains "${senderEsc}"`;
  } else if (subjectEsc) {
    condition = `subject of it contains "${subjectEsc}"`;
  } else {
    return { ok: false, error: 'Need sender or subject' };
  }
  const script = `tell application "Mail" to activate
tell application "Mail"
  set msgCount to 0
  repeat with acct in accounts
    repeat with mb in mailboxes of acct
      try
        set msgs to (every message of mb whose ${condition})
        repeat with msg in msgs
          if msgCount = ${idx} then
            open msg
            return "ok"
          end if
          set msgCount to msgCount + 1
        end repeat
      end try
    end repeat
  end repeat
  return "not found"
end tell`;
  const tmpPath = path.join(os.tmpdir(), `mudrag-open-mail-${Date.now()}.scpt`);
  try {
    fs.writeFileSync(tmpPath, script, 'utf8');
    execSync(`osascript "${tmpPath}"`, { timeout: 10000 });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    try {
      fs.unlinkSync(tmpPath);
    } catch (_) {}
  }
});

ipcMain.handle('mudrag:import-mail-attachments', async (_, opts = {}) => {
  const sender = opts && opts.sender ? String(opts.sender).trim() : '';
  const subject = opts && opts.subject ? String(opts.subject).trim() : '';
  const index = Math.max(0, parseInt(opts && opts.index, 10) || 0);
  const messageId = opts && opts.message_id != null ? opts.message_id : null;
  const maxFiles = Math.max(1, parseInt(opts && opts.max_files, 10) || 12);
  const maxFileBytes = Math.max(256 * 1024, parseInt(opts && opts.max_file_bytes, 10) || (20 * 1024 * 1024));
  return extractMailAttachments({
    sender,
    subject,
    index,
    message_id: messageId,
    max_files: maxFiles,
    max_file_bytes: maxFileBytes,
  });
});

ipcMain.handle('mudrag:scan-local-files', async (_, opts = {}) => {
  try {
    const result = scanLocalFiles(opts);
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: err.message, files: [], keywords: [] };
  }
});

ipcMain.handle('mudrag:read-local-file', async (_, filePath) => {
  if (!filePath) return { ok: false, error: 'No file path provided.' };
  return readFileForImport(filePath);
});

ipcMain.handle('mudrag:desktop-sync-setup', async (_, opts = {}) => {
  const rootPath = opts.rootPath || getDesktopSyncConfig().rootPath || getDefaultDesktopSyncRoot();
  suspendDesktopSyncWatcher(4000);
  ensureDirSync(rootPath);
  const projectMap = {};
  const projects = Array.isArray(opts.projects) ? opts.projects : [];
  projects.forEach((project) => {
    if (!project || !project.id) return;
    const projectPath = path.join(rootPath, slugifyProjectName(project.name));
    ensureDirSync(projectPath);
    projectMap[project.id] = {
      path: projectPath,
      name: project.name || 'Project',
      lastSyncAt: null,
    };
  });
  const config = setDesktopSyncConfig({
    rootPath,
    enabled: true,
    replaceProjects: true,
    projects: projectMap,
  });
  startDesktopSyncWatcher(rootPath);
  return { ok: true, rootPath, config };
});

ipcMain.handle('mudrag:desktop-sync-project', async (_, opts = {}) => {
  return writeProjectSnapshotToDesktop(opts);
});

ipcMain.handle('mudrag:desktop-sync-status', async (_, opts = {}) => {
  const cfg = getDesktopSyncConfig();
  const projectId = opts.projectId || '';
  const projectMeta = projectId && cfg.projects ? cfg.projects[projectId] : null;
  const rootPath = cfg.rootPath || getDefaultDesktopSyncRoot();
  return {
    ok: true,
    enabled: !!(cfg.rootPath && cfg.enabled !== false),
    rootPath,
    projectPath: projectMeta && projectMeta.path ? projectMeta.path : '',
    projectName: projectMeta && projectMeta.name ? projectMeta.name : '',
    lastSyncAt: projectMeta && projectMeta.lastSyncAt ? projectMeta.lastSyncAt : cfg.lastSyncAt || null,
  };
});

ipcMain.handle('mudrag:desktop-sync-choose-root', async () => {
  const currentRoot = getDesktopSyncConfig().rootPath || getDefaultDesktopSyncRoot();
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: currentRoot,
    title: 'Choose Desktop sync folder',
    message: 'Select where openmud should store synced project files.',
  });
  if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
    return { ok: false, cancelled: true, rootPath: currentRoot };
  }
  const rootPath = result.filePaths[0];
  suspendDesktopSyncWatcher(4000);
  ensureDirSync(rootPath);
  const cfg = setDesktopSyncConfig({ rootPath, enabled: true });
  startDesktopSyncWatcher(rootPath);
  return { ok: true, rootPath, config: cfg };
});

ipcMain.handle('mudrag:desktop-sync-remove-project', async (_, projectId) => {
  if (!projectId) return { ok: false, error: 'projectId required' };
  const cfg = getDesktopSyncConfig();
  const projectMeta = cfg.projects && cfg.projects[projectId];
  if (projectMeta && projectMeta.path && fs.existsSync(projectMeta.path)) {
    try { fs.rmSync(projectMeta.path, { recursive: true, force: true }); } catch (err) {}
  }
  const nextProjects = { ...(cfg.projects || {}) };
  delete nextProjects[projectId];
  setDesktopSyncConfig({ replaceProjects: true, projects: nextProjects });
  return { ok: true };
});

ipcMain.handle('mudrag:desktop-sync-open-root', async () => {
  const rootPath = getDesktopSyncConfig().rootPath || getDefaultDesktopSyncRoot();
  ensureDirSync(rootPath);
  await shell.openPath(rootPath);
  return { ok: true, rootPath };
});

ipcMain.handle('mudrag:desktop-sync-list-files', async (_, opts = {}) => {
  const cfg = getDesktopSyncConfig();
  const projectId = opts.projectId || '';
  let projectPath = opts.projectPath || '';
  if (!projectPath && projectId && cfg.projects && cfg.projects[projectId]) {
    projectPath = cfg.projects[projectId].path || '';
  }
  if (!projectPath) return { ok: false, error: 'No project path configured.', files: [] };
  const files = [];
  listRelativeFilesRecursive(projectPath, projectPath, files);
  return { ok: true, files, projectPath, rootPath: cfg.rootPath || getDefaultDesktopSyncRoot() };
});

ipcMain.handle('mudrag:udot-scan', async (_, opts = {}) => {
  const sources = opts.sources || ['payments', 'advertising'];
  const progress = [];
  try {
    const results = await scrapeUDOT(sources, (msg) => {
      progress.push(msg);
      if (mainWindowRef) {
        mainWindowRef.webContents.send('mudrag:system', { type: 'agentic-progress', text: msg });
      }
    });
    const contractors = parseContractorPayments(results);
    const summary = aggregateByContractor(contractors);
    return { ok: true, contractors, summary, progress, sources };
  } catch (err) {
    return { ok: false, error: err.message, progress };
  }
});

ipcMain.handle('mudrag:install-ollama', async () => {
  shell.openExternal('https://ollama.com/download/mac');
  return { ok: true };
});

ipcMain.handle('mudrag:ollama-status', async () => {
  const status = await checkAndStartOllama().catch(() => 'unknown');
  return { status, model: OLLAMA_MODEL };
});

ipcMain.handle('mudrag:ollama-pull-model', async () => {
  try {
    const proc = spawn('ollama', ['pull', OLLAMA_MODEL], { stdio: ['ignore', 'pipe', 'pipe'] });

    function sendProgress(raw) {
      if (!mainWindowRef || mainWindowRef.isDestroyed()) return;
      // Ollama outputs JSON lines: {"status":"pulling...","completed":N,"total":N}
      const lines = raw.toString().trim().split('\n');
      for (const line of lines) {
        try {
          const j = JSON.parse(line);
          let text = j.status || '';
          if (j.total && j.completed) {
            const pct = Math.round((j.completed / j.total) * 100);
            const mb = (j.completed / 1024 / 1024).toFixed(0);
            const totalMb = (j.total / 1024 / 1024).toFixed(0);
            text = `${j.status} — ${mb} / ${totalMb} MB (${pct}%)`;
          }
          if (text) {
            mainWindowRef.webContents.send('mudrag:system', { type: 'ollama-pull-progress', text });
          }
        } catch (_) {
          // plain text line
          const t = line.trim();
          if (t) mainWindowRef.webContents.send('mudrag:system', { type: 'ollama-pull-progress', text: t });
        }
      }
    }

    proc.stdout.on('data', sendProgress);
    proc.stderr.on('data', sendProgress);

    proc.on('close', async (code) => {
      const pulled = await isModelPulled(OLLAMA_MODEL).catch(() => false);
      if (pulled) {
        // Reset model cache so ollama-client picks up the newly pulled model
        try {
          const ollamaClient = require(path.join(getMud1Path(), 'src', 'ollama-client.js'));
          if (ollamaClient.resetModelCache) ollamaClient.resetModelCache();
        } catch (_) {}
      }
      if (mainWindowRef && !mainWindowRef.isDestroyed()) {
        mainWindowRef.webContents.send('mudrag:system', {
          type: pulled ? 'ollama-ready' : 'ollama-pull-error',
          model: OLLAMA_MODEL,
        });
      }
    });

    // Fallback: poll every 8s in case progress events are lost (window reload, etc.)
    const pollInterval = setInterval(async () => {
      if (!mainWindowRef || mainWindowRef.isDestroyed()) { clearInterval(pollInterval); return; }
      const pulled = await isModelPulled(OLLAMA_MODEL).catch(() => false);
      if (pulled) {
        clearInterval(pollInterval);
        mainWindowRef.webContents.send('mudrag:system', { type: 'ollama-ready', model: OLLAMA_MODEL });
      }
    }, 8000);

    proc.on('close', () => clearInterval(pollInterval));

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

function forceReload() {
  const w = BrowserWindow.getFocusedWindow() || mainWindowRef;
  if (w && w.webContents && !w.webContents.isDestroyed()) {
    w.webContents.reloadIgnoringCache();
  }
}

app.whenReady().then(() => {
  hydrateSessionState();
  ensureAutoUpdaterConfigured();
  try {
    const cfg = getDesktopSyncConfig();
    if (cfg.rootPath) startDesktopSyncWatcher(cfg.rootPath);
  } catch (err) {}
  const isDev = process.env.DEV === '1' || process.env.NODE_ENV === 'development';
  const updatePrefs = getUpdatePreferences();
  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { label: 'Check for Updates', click: () => { checkForUpdates(true, 'menu'); } },
        { label: 'Download Update', click: () => { downloadUpdate(true); } },
        { label: 'Restart to Install Update', click: () => { autoUpdater.quitAndInstall(false, true); }, enabled: false, id: 'install-update-now' },
        { type: 'separator' },
        {
          label: 'App Updates',
          submenu: [
            {
              label: 'Automatically Check for Updates',
              id: 'pref-auto-check-updates',
              type: 'checkbox',
              checked: !!updatePrefs.autoCheckForUpdates,
              click: (item) => { setUpdatePreferences({ autoCheckForUpdates: !!item.checked }); },
            },
            {
              label: 'Download Updates Automatically',
              id: 'pref-auto-download-updates',
              type: 'checkbox',
              checked: !!updatePrefs.autoDownloadUpdates,
              click: (item) => { setUpdatePreferences({ autoDownloadUpdates: !!item.checked }); },
            },
            {
              label: 'Install Downloaded Updates on Quit',
              id: 'pref-install-updates-on-quit',
              type: 'checkbox',
              checked: !!updatePrefs.installUpdatesOnQuit,
              click: (item) => { setUpdatePreferences({ installUpdatesOnQuit: !!item.checked }); },
            },
          ],
        },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        { role: 'close' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+Shift+R', click: forceReload },
        ...(isDev ? [{ role: 'toggleDevTools' }] : []),
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  startToolServer((toolPort) => {
    createWindow(toolPort);
    if (getUpdatePreferences().autoCheckForUpdates) {
      setTimeout(() => { checkForUpdates(false, 'auto'); }, 5000);
    }
    // Check Ollama availability after window is loaded, notify user if missing
    setTimeout(async () => {
      const status = await checkAndStartOllama().catch(() => 'unknown');
      if (status !== 'running' && status !== 'unknown') {
        notifyOllamaStatus(mainWindowRef, status);
      }
    }, 4000);
    // Start bid watcher background agent
    bidWatcher.init(storage, bidFinder, (notification) => {
      const { Notification } = require('electron');
      if (Notification.isSupported()) {
        const n = new Notification({
          title: notification.title,
          body: notification.body,
          silent: false,
        });
        n.on('click', () => {
          if (mainWindowRef && !mainWindowRef.isDestroyed()) {
            mainWindowRef.focus();
            mainWindowRef.webContents.send('mudrag:system', {
              type: 'bid-watch-results',
              bids: notification.bids,
            });
          }
        });
        n.show();
      }
    });
    bidWatcher.start();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
