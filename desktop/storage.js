/**
 * Persistent storage for openmud desktop app.
 * Stores rates and projects in app data dir (survives app restarts).
 */
const fs = require('fs');
const path = require('path');

const { app } = require('electron');

function getStorageDir() {
  if (app && app.getPath) {
    return path.join(app.getPath('userData'), 'storage');
  }
  // Fallback when not in Electron (e.g. tests)
  return path.join(process.env.HOME || process.env.USERPROFILE || '/tmp', '.mudrag', 'storage');
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

const DEFAULT_LABOR = {
  operator: 85,
  laborer: 35,
  foreman: 55,
  electrician: 65,
  ironworker: 55,
};

const DEFAULT_EQUIPMENT = {
  excavator: 400,
  auger: 450,
  compactor: 100,
};

function getRatesPath() {
  return path.join(getStorageDir(), 'rates.json');
}

function getProjectsPath() {
  return path.join(getStorageDir(), 'projects.json');
}

function getProfilePath() {
  return path.join(getStorageDir(), 'profile.json');
}

function getChatsPath() {
  return path.join(getStorageDir(), 'chats.json');
}

function readJSON(filePath, defaultValue) {
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    if (e.code === 'ENOENT') return defaultValue;
    throw e;
  }
}

function writeJSON(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function getRates() {
  const p = getRatesPath();
  const raw = readJSON(p, {});
  return {
    labor: { ...DEFAULT_LABOR, ...(raw.labor || {}) },
    equipment: { ...DEFAULT_EQUIPMENT, ...(raw.equipment || {}) },
    materialOverrides: raw.materialOverrides || {},
  };
}

function setRates(rates) {
  const current = getRates();
  const next = {
    labor: { ...current.labor, ...(rates.labor || {}) },
    equipment: { ...current.equipment, ...(rates.equipment || {}) },
    materialOverrides: { ...current.materialOverrides, ...(rates.materialOverrides || {}) },
  };
  writeJSON(getRatesPath(), next);
  return next;
}

function getProjects() {
  const p = getProjectsPath();
  return readJSON(p, []);
}

function addProject(project) {
  const projects = getProjects();
  const exists = projects.find((p) => p.path === project.path);
  if (exists) return exists;
  const id = project.id || 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
  const name = project.name || path.basename(project.path) || 'Project';
  const entry = { id, name, path: project.path };
  projects.push(entry);
  writeJSON(getProjectsPath(), projects);
  return entry;
}

function setProjects(projects) {
  writeJSON(getProjectsPath(), projects);
  return projects;
}

function deleteProject(projectId) {
  const projects = getProjects();
  const next = projects.filter((p) => p.id !== projectId);
  writeJSON(getProjectsPath(), next);
  // Also remove chats for this project
  const all = readJSON(getChatsPath(), {});
  delete all[projectId];
  writeJSON(getChatsPath(), all);
  return next;
}

function getProjectPath(projectId) {
  const projects = getProjects();
  const p = projects.find((x) => x.id === projectId);
  return p ? p.path : null;
}

function getProfile() {
  const p = getProfilePath();
  return readJSON(p, {});
}

function setProfile(profile) {
  const current = getProfile();
  const next = { ...current, ...profile };
  if (profile.resume_content !== undefined) {
    next.resume_content = { ...(current.resume_content || {}), ...profile.resume_content };
  }
  writeJSON(getProfilePath(), next);
  return next;
}

/** Resume content (summary, experience, skills, education) - stored with profile */
function getResumeContent() {
  const p = getProfile();
  return p.resume_content || {};
}

function setResumeContent(content) {
  const current = getProfile();
  const existing = current.resume_content || {};
  const next = { ...existing, ...content };
  return setProfile({ resume_content: next });
}

function getChats(projectId) {
  const all = readJSON(getChatsPath(), {});
  if (projectId) return all[projectId] || {};
  return all;
}

function setChats(projectId, chats) {
  const all = readJSON(getChatsPath(), {});
  all[projectId] = chats;
  writeJSON(getChatsPath(), all);
  return chats;
}

function getUserDataPath() {
  return path.join(getStorageDir(), 'user-data.json');
}

function getUserData() {
  return readJSON(getUserDataPath(), {});
}

function setUserData(data) {
  const current = getUserData();
  const next = { ...current, ...data };
  writeJSON(getUserDataPath(), next);
  return next;
}

module.exports = {
  getStorageDir,
  getRates,
  setRates,
  getProjects,
  addProject,
  setProjects,
  deleteProject,
  getProjectPath,
  getProfile,
  setProfile,
  getResumeContent,
  setResumeContent,
  getChats,
  setChats,
  getUserData,
  setUserData,
  DEFAULT_LABOR,
  DEFAULT_EQUIPMENT,
};
