const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

function loadWithMocks(targetPath, mocks) {
  const resolved = require.resolve(targetPath);
  delete require.cache[resolved];
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (mocks && Object.prototype.hasOwnProperty.call(mocks, request)) {
      return mocks[request];
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(resolved);
  } finally {
    Module._load = originalLoad;
  }
}

function withTempHome(fn) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openmud-storage-test-'));
  const originalHome = process.env.HOME;
  process.env.HOME = tmpDir;
  try {
    return fn(tmpDir);
  } finally {
    process.env.HOME = originalHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

test('desktop storage scopes project data by active user', () => withTempHome(() => {
  const storage = loadWithMocks(path.join(__dirname, '..', 'storage.js'), {
    electron: { app: null },
  });

  storage.setActiveUser('user_a');
  storage.setProjects([{ id: 'p_a', name: 'Project A' }]);

  storage.setActiveUser('user_b');
  assert.deepEqual(storage.getProjects(), []);
  storage.setProjects([{ id: 'p_b', name: 'Project B' }]);

  storage.setActiveUser('user_a');
  assert.deepEqual(storage.getProjects(), [{ id: 'p_a', name: 'Project A' }]);

  storage.setActiveUser('user_b');
  assert.deepEqual(storage.getProjects(), [{ id: 'p_b', name: 'Project B' }]);
}));

test('desktop storage migrates legacy global files into a user scope', () => withTempHome((tmpDir) => {
  const legacyStorageDir = path.join(tmpDir, '.mudrag', 'storage');
  fs.mkdirSync(legacyStorageDir, { recursive: true });
  fs.writeFileSync(
    path.join(legacyStorageDir, 'projects.json'),
    JSON.stringify([{ id: 'legacy_project', name: 'Legacy Project' }], null, 2),
    'utf8'
  );

  const storage = loadWithMocks(path.join(__dirname, '..', 'storage.js'), {
    electron: { app: null },
  });

  storage.setActiveUser('migrated_user');
  assert.deepEqual(storage.getProjects(), [{ id: 'legacy_project', name: 'Legacy Project' }]);

  const scopedPath = path.join(legacyStorageDir, 'users', 'migrated_user', 'projects.json');
  assert.equal(fs.existsSync(scopedPath), true);
}));
