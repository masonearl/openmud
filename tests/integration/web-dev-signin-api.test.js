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

function createReq(body) {
  return {
    method: 'POST',
    body: body || {},
    headers: {
      host: 'openmud.ai',
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'openmud.ai',
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

function createSupabaseAdminMock() {
  return {
    createClient() {
      return {
        auth: {
          admin: {
            async generateLink(input) {
              if (input && input.options && input.options.redirectTo) {
                return {
                  data: {
                    properties: {
                      action_link: 'https://openmud.ai/welcome.html?token_hash=test-hash&type=magiclink',
                    },
                  },
                  error: null,
                };
              }
              return {
                data: null,
                error: new Error('User not found'),
              };
            },
            async createUser() {
              return { data: { user: { id: 'dev-user' } }, error: null };
            },
          },
        },
      };
    },
  };
}

test('dev-signin API returns a guarded magic link when enabled', async () => {
  process.env.OPENMUD_DEV_SIGNIN_ENABLED = 'true';
  process.env.OPENMUD_DEV_SIGNIN_TOKEN = 'secret-dev-token';
  process.env.OPENMUD_DEV_SIGNIN_EMAIL = 'dev@openmud.ai';
  process.env.SUPABASE_URL = 'https://supabase.example.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';

  const repoRoot = path.resolve(__dirname, '..', '..');
  const handlerPath = path.join(repoRoot, 'web', 'api', 'dev-signin.js');
  const handler = loadWithMocks(handlerPath, {
    '@supabase/supabase-js': createSupabaseAdminMock(),
  });

  const req = createReq({
    token: 'secret-dev-token',
    next: '/try',
  });
  const res = createRes();

  await handler(req, res);

  const { statusCode, body } = res._getState();
  assert.equal(statusCode, 200);
  assert.equal(body.ok, true);
  assert.equal(body.email, 'dev@openmud.ai');
  assert.match(body.action_link, /magiclink/i);
});
