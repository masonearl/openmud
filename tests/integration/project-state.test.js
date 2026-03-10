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

test('project-state PUT upserts chats and project data for owned project', async () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const handlerPath = path.join(repoRoot, 'web', 'api', 'project-state.js');
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';

  const upsertPayloads = [];

  const handler = loadWithMocks(handlerPath, {
    './lib/auth': {
      getUserFromRequest: async () => ({ id: 'user_1', email: 'builder@example.com' }),
    },
    '@supabase/supabase-js': {
      createClient() {
        return {
          from(table) {
            if (table === 'projects') {
              return {
                select() {
                  return {
                    eq() {
                      return {
                        eq() {
                          return {
                            maybeSingle: async () => ({ data: { id: 'p_1' }, error: null }),
                          };
                        },
                      };
                    },
                  };
                },
              };
            }
            if (table === 'project_state') {
              return {
                upsert(payload) {
                  upsertPayloads.push(payload);
                  return {
                    select() {
                      return {
                        single: async () => ({
                          data: {
                            project_id: payload.project_id,
                            project_data_json: payload.project_data_json,
                            chats_json: payload.chats_json,
                            active_chat_id: payload.active_chat_id,
                            updated_at: payload.updated_at,
                          },
                          error: null,
                        }),
                      };
                    },
                  };
                },
              };
            }
            throw new Error('Unexpected table ' + table);
          },
        };
      },
    },
  });

  const req = {
    method: 'PUT',
    headers: { authorization: 'Bearer test-token' },
    body: {
      project_id: 'p_1',
      project_data: { tasks: [{ id: 't1', title: 'Call supplier' }] },
      chats: { c_1: { name: 'Chat 1', messages: [{ role: 'user', content: 'hi' }] } },
      active_chat_id: 'c_1',
    },
  };
  const res = createRes();

  await handler(req, res);

  const { statusCode, body } = res._getState();
  assert.equal(statusCode, 200);
  assert.equal(upsertPayloads.length, 1);
  assert.equal(upsertPayloads[0].project_id, 'p_1');
  assert.equal(upsertPayloads[0].user_id, 'user_1');
  assert.deepEqual(body.project_state.project_data.tasks, [{ id: 't1', title: 'Call supplier' }]);
  assert.equal(body.project_state.active_chat_id, 'c_1');
});

test('projects DELETE removes owned project', async () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const handlerPath = path.join(repoRoot, 'web', 'api', 'projects.js');
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';

  let deletedProjectId = null;

  const handler = loadWithMocks(handlerPath, {
    './lib/auth': {
      getUserFromRequest: async () => ({ id: 'user_1', email: 'builder@example.com' }),
    },
    '@supabase/supabase-js': {
      createClient() {
        return {
          from(table) {
            assert.equal(table, 'projects');
            return {
              select() {
                return {
                  eq() {
                    return {
                      eq() {
                        return {
                          maybeSingle: async () => ({ data: { id: 'p_1' }, error: null }),
                        };
                      },
                    };
                  },
                };
              },
              delete() {
                return {
                  eq(field, value) {
                    if (field === 'id') deletedProjectId = value;
                    return {
                      eq: async () => ({ error: null }),
                    };
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
    method: 'DELETE',
    headers: { authorization: 'Bearer test-token' },
    query: { id: 'p_1' },
  };
  const res = createRes();

  await handler(req, res);

  const { statusCode, body } = res._getState();
  assert.equal(statusCode, 200);
  assert.equal(body.ok, true);
  assert.equal(deletedProjectId, 'p_1');
});
