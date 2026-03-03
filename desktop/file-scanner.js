/**
 * Local File Scanner — finds project-relevant documents on the user's Mac.
 *
 * Searches: Desktop, Downloads, Documents, iCloud Drive, and any custom paths.
 * Scores each file by keyword relevance, recency, and type.
 * Returns a ranked list the chat UI can display for the user to review.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();

// Common Mac search roots (ordered by priority)
const SEARCH_ROOTS = [
  { dir: path.join(HOME, 'Desktop'),   label: 'Desktop' },
  { dir: path.join(HOME, 'Downloads'), label: 'Downloads' },
  { dir: path.join(HOME, 'Documents'), label: 'Documents' },
  { dir: path.join(HOME, 'Library', 'Mobile Documents', 'com~apple~CloudDocs'), label: 'iCloud Drive' },
  { dir: path.join(HOME, 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'Desktop'), label: 'iCloud Desktop' },
  { dir: path.join(HOME, 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'Documents'), label: 'iCloud Documents' },
];

// File types we care about
const ALLOWED_EXTS = new Set([
  '.pdf', '.docx', '.doc', '.xlsx', '.xls', '.csv',
  '.txt', '.md', '.rtf', '.pptx', '.ppt',
  '.png', '.jpg', '.jpeg', '.heic', '.gif', '.webp',
  '.dwg', '.dxf', '.skp',
]);

// Max file size to import (50 MB)
const MAX_FILE_BYTES = 50 * 1024 * 1024;

// Max depth to recurse into subdirectories
const MAX_DEPTH = 3;

// Max files to return in results
const MAX_RESULTS = 30;

/** Extract search keywords from a project name or freeform query. */
function extractKeywords(text) {
  if (!text) return [];
  const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'at', 'with', 'is', 'are', 'was', 'my', 'our']);
  return text
    .replace(/[^a-zA-Z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((w) => w.toLowerCase().trim())
    .filter((w) => w.length >= 2 && !STOP.has(w));
}

/** Score a filename + path against keywords. Higher = more relevant. */
function scoreFile(filePath, keywords) {
  const name = path.basename(filePath).toLowerCase();
  const nameNoExt = name.replace(/\.[^.]+$/, '');
  const dir = path.dirname(filePath).toLowerCase();
  let score = 0;

  for (const kw of keywords) {
    if (nameNoExt.includes(kw)) score += 10;   // keyword in filename = strong signal
    else if (name.includes(kw)) score += 8;
    if (dir.includes(kw)) score += 3;           // keyword in directory path = weaker
  }

  // Bonus for useful file types
  const ext = path.extname(name);
  if (['.pdf', '.docx', '.xlsx'].includes(ext)) score += 3;
  if (['.csv', '.txt', '.md'].includes(ext)) score += 1;

  return score;
}

/** Recursively walk a directory up to maxDepth, collecting matching files. */
function walkDir(dir, keywords, results, depth) {
  if (depth > MAX_DEPTH) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return; // permission denied or missing
  }

  for (const entry of entries) {
    // Skip hidden files/dirs
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      walkDir(fullPath, keywords, results, depth + 1);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (!ALLOWED_EXTS.has(ext)) continue;

      let stat;
      try { stat = fs.statSync(fullPath); } catch (_) { continue; }
      if (stat.size > MAX_FILE_BYTES) continue;

      const score = keywords.length > 0 ? scoreFile(fullPath, keywords) : 2; // no-keyword scan still returns files
      if (keywords.length > 0 && score === 0) continue; // with keywords, skip irrelevant files

      results.push({
        path: fullPath,
        name: entry.name,
        ext: ext,
        size: stat.size,
        sizeFormatted: formatSize(stat.size),
        modified: stat.mtime.toISOString(),
        modifiedMs: stat.mtime.getTime(),
        score,
      });
    }
  }
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/**
 * Scan the user's Mac for files matching the given keywords.
 *
 * @param {object} opts
 * @param {string}   opts.query        - freeform search query (project name, description, etc.)
 * @param {string[]} [opts.extraPaths] - additional directories to search
 * @param {number}   [opts.maxResults] - cap on returned results (default 30)
 * @returns {{ files: FileResult[], keywords: string[], roots: string[] }}
 */
function scanLocalFiles(opts) {
  opts = opts || {};
  const keywords = extractKeywords(opts.query || '');
  const roots = [...SEARCH_ROOTS];
  const inaccessibleRoots = [];

  // Add any custom paths the user or project specifies
  if (Array.isArray(opts.extraPaths)) {
    for (const p of opts.extraPaths) {
      if (p && !roots.find((r) => r.dir === p)) roots.push({ dir: p, label: path.basename(p) });
    }
  }

  const raw = [];
  for (const root of roots) {
    if (!fs.existsSync(root.dir)) continue;
    try {
      fs.accessSync(root.dir, fs.constants.R_OK);
    } catch (err) {
      inaccessibleRoots.push({
        label: root.label,
        path: root.dir,
        error: (err && err.code) || 'EACCES',
      });
      continue;
    }
    walkDir(root.dir, keywords, raw, 0);
  }

  // De-duplicate by path
  const seen = new Set();
  const deduped = raw.filter((f) => {
    if (seen.has(f.path)) return false;
    seen.add(f.path);
    return true;
  });

  // Sort: score DESC, then recency DESC
  deduped.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.modifiedMs - a.modifiedMs;
  });

  const maxN = opts.maxResults || MAX_RESULTS;
  const files = deduped.slice(0, maxN).map((f) => {
    // Shorten path for display: show relative to HOME
    const displayPath = f.path.startsWith(HOME)
      ? '~' + f.path.slice(HOME.length)
      : f.path;
    return { ...f, displayPath };
  });

  return {
    files,
    keywords,
    roots: roots.map((r) => r.label),
    inaccessibleRoots,
  };
}

/**
 * Read a local file and return its base64-encoded content.
 * Used when the user confirms import of a specific file.
 */
function readFileForImport(filePath) {
  try {
    const data = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap = {
      '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.doc': 'application/msword', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.xls': 'application/vnd.ms-excel', '.csv': 'text/csv', '.txt': 'text/plain', '.md': 'text/markdown',
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
      '.webp': 'image/webp', '.heic': 'image/heic', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    };
    return {
      ok: true,
      name: path.basename(filePath),
      base64: data.toString('base64'),
      mime: mimeMap[ext] || 'application/octet-stream',
      size: data.length,
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { scanLocalFiles, readFileForImport, extractKeywords };
