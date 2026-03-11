const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');

function loadWithMocks(targetPath, mocks) {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const resolved = require.resolve(targetPath);
  Object.keys(require.cache).forEach((key) => {
    if (key.startsWith(path.join(repoRoot, 'web', 'api'))) delete require.cache[key];
  });
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

function createReq(method, body, query) {
  return {
    method,
    body: body || {},
    query: query || {},
    headers: {
      authorization: 'Bearer test-token',
    },
  };
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

function createSupabaseMock() {
  const state = {
    projectStateRow: null,
  };

  function makeResponse(data, error) {
    return Promise.resolve({ data, error: error || null });
  }

  function createTableQuery(table) {
    const query = {
      _table: table,
      _action: 'select',
      _mutationAction: '',
      _filters: {},
      _payload: null,
      select() { if (this._mutationAction) return this; this._action = 'select'; return this; },
      insert(payload) { this._action = 'insert'; this._mutationAction = 'insert'; this._payload = payload; return this; },
      update(payload) { this._action = 'update'; this._mutationAction = 'update'; this._payload = payload; return this; },
      delete() { this._action = 'delete'; return this; },
      eq(field, value) { this._filters[field] = value; return this; },
      single() { return this._resolve(true); },
      maybeSingle() { return this._resolve(false); },
      _resolve(requireSingle) {
        if (this._table === 'projects') {
          const matches = this._filters.id === 'proj_123' && this._filters.user_id === 'user_123';
          return makeResponse(matches ? { id: 'proj_123' } : null, null);
        }
        if (this._table === 'project_state') {
          if (this._action === 'select') {
            const matches = state.projectStateRow
              && state.projectStateRow.project_id === this._filters.project_id
              && state.projectStateRow.user_id === this._filters.user_id;
            return makeResponse(matches ? {
              data: state.projectStateRow.data,
              updated_at: state.projectStateRow.updated_at,
              project_id: state.projectStateRow.project_id,
            } : null, null);
          }
          if (this._action === 'insert' || this._mutationAction === 'insert') {
            const payload = Array.isArray(this._payload) ? this._payload[0] : this._payload;
            state.projectStateRow = {
              project_id: payload.project_id,
              user_id: payload.user_id,
              data: payload.data,
              updated_at: payload.updated_at,
            };
            return makeResponse({
              data: state.projectStateRow.data,
              updated_at: state.projectStateRow.updated_at,
            }, null);
          }
          if (this._action === 'update' || this._mutationAction === 'update') {
            if (!state.projectStateRow) {
              if (requireSingle) return makeResponse(null, new Error('Missing row'));
              return makeResponse(null, null);
            }
            state.projectStateRow = Object.assign({}, state.projectStateRow, {
              data: this._payload.data,
              updated_at: this._payload.updated_at,
            });
            return makeResponse({
              data: state.projectStateRow.data,
              updated_at: state.projectStateRow.updated_at,
            }, null);
          }
          if (this._action === 'delete') {
            state.projectStateRow = null;
            return makeResponse(null, null);
          }
        }
        return makeResponse(null, null);
      },
    };
    return query;
  }

  return {
    createClient() {
      return {
        from(table) {
          return createTableQuery(table);
        },
      };
    },
  };
}

test('project-data API saves and loads durable project state', async () => {
  process.env.SUPABASE_URL = 'https://supabase.example.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
  const repoRoot = path.resolve(__dirname, '..', '..');
  const handlerPath = path.join(repoRoot, 'web', 'api', 'project-data.js');
  const handler = loadWithMocks(handlerPath, {
    '@supabase/supabase-js': createSupabaseMock(),
    './lib/auth': {
      getUserFromRequest: async () => ({ id: 'user_123', email: 'builder@example.com' }),
    },
  });

  const putReq = createReq('PUT', {
    project_id: 'proj_123',
    project_data: {
      scope_summary: 'Install 1,200 LF of sewer main.',
      utility_type: 'sewer',
      project_risks: ['Traffic control'],
    },
  });
  const putRes = createRes();
  await handler(putReq, putRes);
  assert.equal(putRes._getState().statusCode, 200);
  assert.equal(putRes._getState().body.project_data.utility_type, 'sewer');

  const getReq = createReq('GET', {}, { project_id: 'proj_123' });
  const getRes = createRes();
  await handler(getReq, getRes);
  assert.equal(getRes._getState().statusCode, 200);
  assert.equal(getRes._getState().body.project_data.scope_summary, 'Install 1,200 LF of sewer main.');
  assert.deepEqual(getRes._getState().body.project_data.project_risks, ['Traffic control']);
});
