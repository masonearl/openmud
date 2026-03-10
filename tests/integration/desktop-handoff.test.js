const test = require('node:test');
const assert = require('node:assert/strict');
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

function createRes() {
  const state = { statusCode: 200, headers: {}, body: null };
  return {
    setHeader(name, value) {
      state.headers[name] = value;
    },
    status(code) {
      state.statusCode = code;
      return this;
    },
    json(payload) {
      state.body = payload;
      return this;
    },
    end() {
      return this;
    },
    _getState() {
      return state;
    },
  };
}

test('desktop handoff start stores encrypted tokens and returns opaque code', async () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const handlerPath = path.join(repoRoot, 'web', 'api', 'desktop-handoff', 'start.js');
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
  process.env.OPENMUD_SESSION_SECRET = 'test-secret';

  const insertedRows = [];
  let deleteUserId = null;

  const handler = loadWithMocks(handlerPath, {
    '../lib/auth': {
      getUserFromRequest: async () => ({
        id: 'user_123',
        email: 'builder@example.com',
        accessToken: 'access-token-abc',
      }),
    },
    '@supabase/supabase-js': {
      createClient() {
        return {
          from(table) {
            assert.equal(table, 'desktop_auth_handoffs');
            return {
              delete() {
                return {
                  eq(field, value) {
                    assert.equal(field, 'user_id');
                    deleteUserId = value;
                    return Promise.resolve({ error: null });
                  },
                };
              },
              insert(rows) {
                insertedRows.push(rows);
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      },
    },
  });

  const req = {
    method: 'POST',
    headers: { authorization: 'Bearer access-token-abc' },
    body: { refresh_token: 'refresh-token-xyz' },
  };
  const res = createRes();

  await handler(req, res);

  const { statusCode, body } = res._getState();
  assert.equal(statusCode, 200);
  assert.ok(body.handoff_code);
  assert.ok(body.expires_at);
  assert.equal(deleteUserId, 'user_123');
  assert.equal(insertedRows.length, 1);
  assert.equal(insertedRows[0].user_id, 'user_123');
  assert.notEqual(insertedRows[0].access_token_encrypted, 'access-token-abc');
  assert.notEqual(insertedRows[0].refresh_token_encrypted, 'refresh-token-xyz');
  assert.equal(insertedRows[0].code_hash.length, 64);
});

test('desktop handoff redeem returns decrypted tokens once', async () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const handlerPath = path.join(repoRoot, 'web', 'api', 'desktop-handoff', 'redeem.js');
  const secureTokens = require(path.join(repoRoot, 'web', 'api', 'lib', 'secure-tokens.js'));
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
  process.env.OPENMUD_SESSION_SECRET = 'test-secret';

  const handoffCode = 'opaque-code-123';
  const row = {
    id: 'handoff_row_1',
    user_id: 'user_123',
    access_token_encrypted: secureTokens.encryptText('access-token-abc'),
    refresh_token_encrypted: secureTokens.encryptText('refresh-token-xyz'),
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    consumed_at: null,
  };
  let updatedId = null;

  const handler = loadWithMocks(handlerPath, {
    '@supabase/supabase-js': {
      createClient() {
        return {
          from(table) {
            assert.equal(table, 'desktop_auth_handoffs');
            return {
              select() {
                return {
                  eq(field, value) {
                    assert.equal(field, 'code_hash');
                    assert.equal(value, secureTokens.hashOpaqueCode(handoffCode));
                    return {
                      maybeSingle: async () => ({ data: row, error: null }),
                    };
                  },
                };
              },
              update(payload) {
                assert.ok(payload.consumed_at);
                return {
                  eq(field, value) {
                    assert.equal(field, 'id');
                    updatedId = value;
                    return {
                      is: async (isField, isValue) => {
                        assert.equal(isField, 'consumed_at');
                        assert.equal(isValue, null);
                        return { error: null };
                      },
                    };
                  },
                };
              },
              delete() {
                return {
                  eq() {
                    return Promise.resolve({ error: null });
                  },
                };
              },
            };
          },
        };
      },
    },
  });

  const req = {
    method: 'POST',
    headers: {},
    body: { handoff_code: handoffCode },
  };
  const res = createRes();

  await handler(req, res);

  const { statusCode, body } = res._getState();
  assert.equal(statusCode, 200);
  assert.equal(body.access_token, 'access-token-abc');
  assert.equal(body.refresh_token, 'refresh-token-xyz');
  assert.equal(updatedId, 'handoff_row_1');
});
