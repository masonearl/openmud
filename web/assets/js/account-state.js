(function () {
  'use strict';

  var SESSION_SCOPE_KEY = 'openmud_active_user_id_session';
  var SESSION_EMAIL_KEY = 'openmud_active_user_email_session';
  var SCOPED_PREFIX = 'openmud:user:';
  var MIGRATION_PREFIX = 'openmud:migrated:';
  var currentUserId = 'anon';
  var currentUserEmail = '';
  var dbMigrationPromises = {};

  var SCOPED_KEYS = {
    mudrag_projects: true,
    mudrag_activeProject: true,
    mudrag_messages: true,
    mudrag_project_data: true,
    mudrag_activeChat: true,
    mudrag_subscriber_email: true,
    mudrag_subscription_active: true,
    mudrag_subscription_tier: true,
    mudrag_provider_keys_v1: true,
    openmud_oc_relay_token: true,
    mudrag_usage: true,
    mudrag_company_profile: true,
    mudrag_company_logo: true,
    mudrag_desktop_sync_enabled: true,
    proposalFromBid: true
  };

  var SCOPED_PREFIXES = [
    'mudrag_folder_expanded_'
  ];

  var rawGetItem = window.localStorage && window.localStorage.getItem
    ? window.localStorage.getItem.bind(window.localStorage)
    : function () { return null; };
  var rawSetItem = window.localStorage && window.localStorage.setItem
    ? window.localStorage.setItem.bind(window.localStorage)
    : function () {};
  var rawRemoveItem = window.localStorage && window.localStorage.removeItem
    ? window.localStorage.removeItem.bind(window.localStorage)
    : function () {};

  function sanitizeUserId(value) {
    var text = String(value == null ? '' : value).trim();
    if (!text) return 'anon';
    return text.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'anon';
  }

  function readSessionScope() {
    try {
      var stored = window.sessionStorage.getItem(SESSION_SCOPE_KEY) || '';
      if (stored) currentUserId = sanitizeUserId(stored);
      var storedEmail = window.sessionStorage.getItem(SESSION_EMAIL_KEY) || '';
      if (storedEmail) currentUserEmail = String(storedEmail || '').trim();
    } catch (e) {
      currentUserId = currentUserId || 'anon';
    }
  }

  function rememberSessionScope(userId, email) {
    currentUserId = sanitizeUserId(userId);
    currentUserEmail = String(email || '').trim();
    try {
      if (currentUserId === 'anon') {
        window.sessionStorage.removeItem(SESSION_SCOPE_KEY);
        window.sessionStorage.removeItem(SESSION_EMAIL_KEY);
        return;
      }
      window.sessionStorage.setItem(SESSION_SCOPE_KEY, currentUserId);
      if (currentUserEmail) window.sessionStorage.setItem(SESSION_EMAIL_KEY, currentUserEmail);
      else window.sessionStorage.removeItem(SESSION_EMAIL_KEY);
    } catch (e) {
      // ignore storage failures
    }
  }

  function getUserFromInput(input) {
    if (!input) return null;
    if (input.user && input.user.id) {
      return {
        id: input.user.id,
        email: input.user.email || ''
      };
    }
    if (input.id) {
      return {
        id: input.id,
        email: input.email || ''
      };
    }
    return null;
  }

  function setActiveUser(input) {
    var user = getUserFromInput(input);
    if (!user || !user.id) {
      rememberSessionScope('anon', '');
      return { userId: 'anon', email: '' };
    }
    rememberSessionScope(user.id, user.email || '');
    return {
      userId: currentUserId,
      email: currentUserEmail
    };
  }

  function getCurrentUserId() {
    return sanitizeUserId(currentUserId || 'anon');
  }

  function getCurrentUserEmail() {
    return String(currentUserEmail || '').trim();
  }

  function shouldScopeKey(key) {
    var text = String(key || '');
    if (!text) return false;
    if (SCOPED_KEYS[text]) return true;
    for (var i = 0; i < SCOPED_PREFIXES.length; i++) {
      if (text.indexOf(SCOPED_PREFIXES[i]) === 0) return true;
    }
    return false;
  }

  function getScopedKey(key, userId) {
    var text = String(key || '');
    if (!shouldScopeKey(text)) return text;
    return SCOPED_PREFIX + sanitizeUserId(userId || currentUserId) + ':' + text;
  }

  function maybeMigrateLegacyKey(key, scopedKey) {
    if (scopedKey === key) return;
    try {
      if (rawGetItem(scopedKey) != null) return;
      var legacy = rawGetItem(key);
      if (legacy == null) return;
      rawSetItem(scopedKey, legacy);
      rawRemoveItem(key);
    } catch (e) {
      // ignore storage failures
    }
  }

  function patchLocalStorage() {
    if (!window.localStorage || window.localStorage.__openmudScopedPatched) return;

    window.localStorage.getItem = function (key) {
      var scopedKey = getScopedKey(key, currentUserId);
      if (scopedKey !== key) maybeMigrateLegacyKey(key, scopedKey);
      return rawGetItem(scopedKey);
    };

    window.localStorage.setItem = function (key, value) {
      var scopedKey = getScopedKey(key, currentUserId);
      if (scopedKey !== key) rawRemoveItem(key);
      return rawSetItem(scopedKey, value);
    };

    window.localStorage.removeItem = function (key) {
      var scopedKey = getScopedKey(key, currentUserId);
      rawRemoveItem(scopedKey);
      if (scopedKey !== key) rawRemoveItem(key);
    };

    window.localStorage.__openmudScopedPatched = true;
  }

  function getDocumentDbName(baseName, userId) {
    return String(baseName || 'mudrag_docs') + '__' + sanitizeUserId(userId || currentUserId || 'anon');
  }

  function openDatabase(name, version, upgrade) {
    return new Promise(function (resolve, reject) {
      var req = version ? window.indexedDB.open(name, version) : window.indexedDB.open(name);
      req.onerror = function () { reject(req.error); };
      req.onsuccess = function () { resolve(req.result); };
      req.onupgradeneeded = function (event) {
        if (typeof upgrade === 'function') upgrade(event.target.result, event);
      };
    });
  }

  function listDatabases() {
    if (!window.indexedDB || typeof window.indexedDB.databases !== 'function') {
      return Promise.resolve([]);
    }
    return window.indexedDB.databases().catch(function () { return []; });
  }

  function databaseExists(name) {
    return listDatabases().then(function (list) {
      return (list || []).some(function (entry) {
        return entry && entry.name === name;
      });
    });
  }

  function hasAnyRecords(db) {
    var storeNames = Array.prototype.slice.call(db.objectStoreNames || []);
    if (!storeNames.length) return Promise.resolve(false);

    return new Promise(function (resolve) {
      var index = 0;

      function checkNext() {
        if (index >= storeNames.length) {
          resolve(false);
          return;
        }
        var storeName = storeNames[index++];
        var tx = null;
        try {
          tx = db.transaction(storeName, 'readonly');
        } catch (err) {
          checkNext();
          return;
        }
        var countReq = tx.objectStore(storeName).count();
        countReq.onsuccess = function () {
          if (Number(countReq.result || 0) > 0) {
            resolve(true);
            return;
          }
          checkNext();
        };
        countReq.onerror = function () {
          checkNext();
        };
      }

      checkNext();
    });
  }

  function readAllFromStore(db, storeName) {
    return new Promise(function (resolve) {
      var tx = null;
      try {
        tx = db.transaction(storeName, 'readonly');
      } catch (err) {
        resolve([]);
        return;
      }
      var req = tx.objectStore(storeName).getAll();
      req.onsuccess = function () { resolve(req.result || []); };
      req.onerror = function () { resolve([]); };
    });
  }

  function copyStoresIntoTarget(sourceDb, targetDb) {
    var sourceNames = Array.prototype.slice.call(sourceDb.objectStoreNames || []);
    var targetNames = Array.prototype.slice.call(targetDb.objectStoreNames || []);
    var storeNames = targetNames.filter(function (name) {
      return sourceNames.indexOf(name) >= 0;
    });
    if (!storeNames.length) return Promise.resolve(false);

    return Promise.all(storeNames.map(function (storeName) {
      return readAllFromStore(sourceDb, storeName).then(function (records) {
        if (!records || !records.length) return false;
        return new Promise(function (resolve, reject) {
          var tx = targetDb.transaction(storeName, 'readwrite');
          var store = tx.objectStore(storeName);
          records.forEach(function (record) {
            try { store.put(record); } catch (err) { /* ignore individual failures */ }
          });
          tx.oncomplete = function () { resolve(true); };
          tx.onerror = function () { reject(tx.error); };
        });
      }).catch(function () {
        return false;
      });
    })).then(function (results) {
      return results.some(Boolean);
    });
  }

  function migrateLegacyDatabaseIfNeeded(baseName, targetDb, migrationKey) {
    if (!window.indexedDB) return Promise.resolve(false);
    try {
      if (rawGetItem(migrationKey) === 'done') return Promise.resolve(false);
    } catch (e) {
      // continue
    }

    return hasAnyRecords(targetDb).then(function (targetHasData) {
      if (targetHasData) {
        try { rawSetItem(migrationKey, 'done'); } catch (e) {}
        return false;
      }
      return databaseExists(baseName).then(function (exists) {
        if (!exists) {
          try { rawSetItem(migrationKey, 'done'); } catch (e) {}
          return false;
        }
        return openDatabase(baseName).then(function (legacyDb) {
          return copyStoresIntoTarget(legacyDb, targetDb).then(function (copied) {
            try { legacyDb.close(); } catch (e) {}
            try { rawSetItem(migrationKey, 'done'); } catch (e) {}
            return copied;
          });
        }).catch(function () {
          return false;
        });
      });
    });
  }

  function openScopedDatabase(options) {
    options = options || {};
    var baseName = String(options.baseName || 'mudrag_docs');
    var version = Number(options.version || 1) || 1;
    var upgrade = options.upgrade;
    var scopedName = getDocumentDbName(baseName);
    var migrationKey = MIGRATION_PREFIX + scopedName;

    return openDatabase(scopedName, version, upgrade).then(function (db) {
      if (scopedName === baseName) return db;
      if (!dbMigrationPromises[scopedName]) {
        dbMigrationPromises[scopedName] = migrateLegacyDatabaseIfNeeded(baseName, db, migrationKey)
          .catch(function () { return false; })
          .then(function () { return true; });
      }
      return dbMigrationPromises[scopedName].then(function () {
        return db;
      });
    });
  }

  readSessionScope();
  patchLocalStorage();

  window.openmudAccountState = {
    setActiveUser: setActiveUser,
    getCurrentUserId: getCurrentUserId,
    getCurrentUserEmail: getCurrentUserEmail,
    getScopedKey: getScopedKey,
    shouldScopeKey: shouldScopeKey,
    getDocumentDbName: getDocumentDbName,
    openScopedDatabase: openScopedDatabase
  };
}());
