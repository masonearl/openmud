const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createStorage() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(String(key)) ? store.get(String(key)) : null;
    },
    setItem(key, value) {
      store.set(String(key), String(value));
    },
    removeItem(key) {
      store.delete(String(key));
    },
    __rawSetItem(key, value) {
      store.set(String(key), String(value));
    },
  };
}

function loadAccountState() {
  const scriptPath = path.join(__dirname, '..', '..', 'web', 'assets', 'js', 'account-state.js');
  const source = fs.readFileSync(scriptPath, 'utf8');
  const localStorage = createStorage();
  const sessionStorage = createStorage();
  const context = {
    window: {
      localStorage,
      sessionStorage,
      indexedDB: {
        open() {
          throw new Error('indexedDB not needed in this test');
        },
      },
    },
    console,
    setTimeout,
    clearTimeout,
  };
  context.window.window = context.window;
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.window;
}

test('account-state scopes account keys by user id', () => {
  const window = loadAccountState();
  const state = window.openmudAccountState;

  state.setActiveUser({ id: 'user_a', email: 'a@example.com' });
  window.localStorage.setItem('mudrag_projects', JSON.stringify([{ id: 'p_a' }]));

  state.setActiveUser({ id: 'user_b', email: 'b@example.com' });
  assert.equal(window.localStorage.getItem('mudrag_projects'), null);

  window.localStorage.setItem('mudrag_projects', JSON.stringify([{ id: 'p_b' }]));
  state.setActiveUser({ id: 'user_a', email: 'a@example.com' });
  assert.equal(window.localStorage.getItem('mudrag_projects'), JSON.stringify([{ id: 'p_a' }]));
});

test('account-state migrates legacy account-bound keys into the active scope', () => {
  const window = loadAccountState();
  const state = window.openmudAccountState;
  window.localStorage.__rawSetItem('mudrag_projects', JSON.stringify([{ id: 'legacy' }]));

  state.setActiveUser({ id: 'user_legacy', email: 'legacy@example.com' });
  window.localStorage.getItem('mudrag_projects');
  assert.equal(window.localStorage.getItem('mudrag_projects'), JSON.stringify([{ id: 'legacy' }]));
});

test('account-state resets scoped view on sign-out', () => {
  const window = loadAccountState();
  const state = window.openmudAccountState;

  state.setActiveUser({ id: 'user_a', email: 'a@example.com' });
  window.localStorage.setItem('mudrag_provider_keys_v1', JSON.stringify({ openai: 'sk-user-a' }));

  state.setActiveUser(null);
  assert.equal(window.localStorage.getItem('mudrag_provider_keys_v1'), null);
  assert.equal(state.getCurrentUserId(), 'anon');
});
