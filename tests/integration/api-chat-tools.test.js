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

function createReq(body) {
  return {
    method: 'POST',
    body,
    headers: {
      host: 'example.test',
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'example.test',
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

function extractTaggedJson(text, tagName) {
  const match = String(text || '').match(new RegExp(`\\[${tagName}\\]([\\s\\S]*?)\\[\\/${tagName}\\]`));
  assert.ok(match, `Expected ${tagName} block in response`);
  return JSON.parse(match[1]);
}

test('schedule tool call returns a matching [OPENMUD_SCHEDULE]', async () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const apiChatPath = path.join(repoRoot, 'api', 'chat.js');
  const originalFetch = global.fetch;
  process.env.OPENAI_API_KEY = 'test-openai-key';
  global.fetch = async () => {
    throw new Error('registry unavailable');
  };

  const handler = loadWithMocks(apiChatPath, {
    openai: createOpenAIStub([
      {
        choices: [{
          message: {
            content: '',
            tool_calls: [{
              id: 'tool_1',
              function: {
                name: 'build_schedule',
                arguments: JSON.stringify({
                  project_name: 'Airport Utility Phase 2',
                  start_date: '2026-04-01',
                  duration_days: 10,
                  phases: ['Mobilization', 'Excavation', 'Pipe install'],
                }),
              },
            }],
          },
        }],
      },
      {
        choices: [{
          message: {
            content: 'Schedule ready.',
          },
        }],
      },
    ]),
    '@anthropic-ai/sdk': class FakeAnthropic {},
    './_lib/toolTelemetry': {
      recordToolInvocation() {},
      recordChatRun() {},
    },
  });

  const req = createReq({
    messages: [{ role: 'user', content: 'Build a 10 day schedule for Airport Utility Phase 2 starting 2026-04-01.' }],
    model: 'gpt-4o-mini',
    chat_mode: 'agent',
    use_tools: true,
    available_tools: ['build_schedule'],
  });
  const res = createRes();

  try {
    await handler(req, res);
  } finally {
    global.fetch = originalFetch;
  }

  const { statusCode, body } = res._getState();
  assert.equal(statusCode, 200);
  const payload = extractTaggedJson(body.response, 'OPENMUD_SCHEDULE');
  assert.deepEqual(payload, {
    project: 'Airport Utility Phase 2',
    duration: 10,
    start_date: '2026-04-01',
    phases: ['Mobilization', 'Excavation', 'Pipe install'],
  });
});

test('proposal tool call returns a matching [OPENMUD_PROPOSAL]', async () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const apiChatPath = path.join(repoRoot, 'api', 'chat.js');
  const originalFetch = global.fetch;
  process.env.OPENAI_API_KEY = 'test-openai-key';
  global.fetch = async () => {
    throw new Error('registry unavailable');
  };

  const handler = loadWithMocks(apiChatPath, {
    openai: createOpenAIStub([
      {
        choices: [{
          message: {
            content: '',
            tool_calls: [{
              id: 'tool_1',
              function: {
                name: 'render_proposal_html',
                arguments: JSON.stringify({
                  client: 'Salt Lake City',
                  scope: 'Install 800 LF of 12-inch sewer main.',
                  total: 182000,
                  duration: 14,
                  bid_items: [
                    { description: 'Material', amount: 82000 },
                    { description: 'Labor', amount: 54000 },
                  ],
                }),
              },
            }],
          },
        }],
      },
      {
        choices: [{
          message: {
            content: 'Proposal ready.',
          },
        }],
      },
    ]),
    '@anthropic-ai/sdk': class FakeAnthropic {},
    './_lib/toolTelemetry': {
      recordToolInvocation() {},
      recordChatRun() {},
    },
  });

  const req = createReq({
    messages: [{ role: 'user', content: 'Create a proposal for Salt Lake City for 800 LF of 12-inch sewer main.' }],
    model: 'gpt-4o-mini',
    chat_mode: 'agent',
    use_tools: true,
    available_tools: ['render_proposal_html'],
  });
  const res = createRes();

  try {
    await handler(req, res);
  } finally {
    global.fetch = originalFetch;
  }

  const { statusCode, body } = res._getState();
  assert.equal(statusCode, 200);
  const payload = extractTaggedJson(body.response, 'OPENMUD_PROPOSAL');
  assert.deepEqual(payload, {
    client: 'Salt Lake City',
    scope: 'Install 800 LF of 12-inch sewer main.',
    total: 182000,
    duration: 14,
    bid_items: [
      { description: 'Material', amount: 82000 },
      { description: 'Labor', amount: 54000 },
    ],
  });
});
