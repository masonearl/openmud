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

function createReq(body, headers = {}) {
  return {
    method: 'POST',
    body,
    headers: Object.assign({
      host: 'example.test',
      authorization: 'Bearer test-session',
      'x-openmud-relay-token': 'relay-token-123',
    }, headers),
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

function createOpenAIStub(responses) {
  return class FakeOpenAI {
    constructor() {
      this.chat = {
        completions: {
          create: async () => {
            assert.ok(responses.length > 0, 'Unexpected OpenAI call');
            return responses.shift();
          },
        },
      };
    }
  };
}

function buildCommonMocks(openaiStub) {
  return {
    openai: openaiStub,
    '@anthropic-ai/sdk': class FakeAnthropic {},
    './lib/auth': {
      getUserFromRequest: async () => ({ id: 'user_1', email: 'builder@example.com' }),
    },
    './lib/usage': {
      allocateUsage: async () => ({ allowed: true, used: 1, limit: 100 }),
      logUsageEvent() {},
      detectSource() { return 'web'; },
    },
    '@supabase/supabase-js': {
      createClient() {
        return {};
      },
    },
    './lib/mud1-rag': {
      getRAGContextForUser() { return ''; },
      getRAGPackageForUser() { return { context: '', sources: [], confidence: 'low', fallback_used: false }; },
      buildMud1RAGSystemPrompt() { return 'system'; },
    },
    './lib/project-rag-store': {
      getProjectRAGPackage: async () => null,
    },
    './lib/rag-utils': {
      maxConfidence() { return 'low'; },
      mergeRagSources(a, b) { return [].concat(a || [], b || []); },
    },
  };
}

test('relay disconnected returns a clear actionable error', async () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const chatPath = path.join(repoRoot, 'web', 'api', 'chat.js');
  process.env.OPENAI_API_KEY = 'test-openai-key';

  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes('/relay/send')) {
      return {
        ok: true,
        async json() {
          return { ok: false };
        },
      };
    }
    throw new Error('Unexpected fetch call: ' + url);
  };

  const handler = loadWithMocks(chatPath, buildCommonMocks(createOpenAIStub([
    {
      choices: [{
        message: {
          content: '{"to":"Mason Earl","message":"hi"}',
        },
      }],
    },
  ])));

  const req = createReq({
    messages: [{ role: 'user', content: 'text mason earl hi' }],
    model: 'mud1',
  });
  const res = createRes();

  try {
    await handler(req, res);
  } finally {
    global.fetch = originalFetch;
  }

  const { statusCode, body } = res._getState();
  assert.equal(statusCode, 200);
  assert.match(body.response, /Error from your Mac:/);
  assert.match(body.response, /Open Settings and make sure openmud-agent is running/i);
});

test('ambiguous contact reply resolves and sends through the relay path', async () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const chatPath = path.join(repoRoot, 'web', 'api', 'chat.js');
  process.env.OPENAI_API_KEY = 'test-openai-key';

  const sendBodies = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    if (String(url).includes('/relay/send')) {
      const parsed = JSON.parse(options.body);
      sendBodies.push(parsed);
      return {
        ok: true,
        async json() {
          return { ok: true };
        },
      };
    }
    if (String(url).includes('/relay/status/')) {
      return {
        ok: true,
        async json() {
          return { ready: true, response: 'iMessage sent.' };
        },
      };
    }
    throw new Error('Unexpected fetch call: ' + url);
  };

  const handler = loadWithMocks(chatPath, buildCommonMocks(createOpenAIStub([
    {
      choices: [{
        message: {
          content: '{"to":"Emma","message":"I love you so much."}',
        },
      }],
    },
  ])));

  const req = createReq({
    messages: [
      { role: 'user', content: 'text emma saying that I love you so much.' },
      { role: 'assistant', content: 'Found 2 contacts matching "Emma". Which one?\n\n• Emma Bear\n• Emma Gillett\n\nJust reply with the name and I\'ll send it.' },
      { role: 'user', content: 'Emma Bear' },
    ],
    model: 'mud1',
  });
  const res = createRes();

  try {
    await handler(req, res);
  } finally {
    global.fetch = originalFetch;
  }

  const { statusCode, body } = res._getState();
  assert.equal(statusCode, 200);
  assert.equal(body.response, 'iMessage sent.');
  assert.equal(sendBodies.length, 1);
  assert.equal(sendBodies[0].type, 'imessage_send');
  assert.equal(sendBodies[0].to, 'Emma Bear');
  assert.equal(sendBodies[0].message, 'I love you so much.');
});
