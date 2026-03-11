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
    body,
    headers: {
      authorization: 'Bearer test-token',
      host: 'example.test',
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'example.test',
      'x-company-profile': JSON.stringify({ company_name: 'Tempest Enterprises' }),
      'x-ui-theme': 'dark',
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

function getCommonMocks(openAiResponses, projectRagContext = '') {
  return {
    openai: createOpenAIStub(openAiResponses),
    '@anthropic-ai/sdk': class FakeAnthropic {},
    '@supabase/supabase-js': {
      createClient() {
        return {};
      },
    },
    './lib/auth': {
      getUserFromRequest: async () => ({ id: 'user_123', email: 'builder@example.com' }),
    },
    './lib/usage': {
      allocateUsage: async () => ({ allowed: true, used: 0, limit: 100, date: '2026-03-10' }),
      logUsageEvent() {},
      detectSource: () => 'web',
    },
    './lib/model-policy': {
      isHostedModel: () => true,
      isHostedBetaModel: () => false,
      isDesktopAgentModel: () => false,
      getRequiredProviderKey: () => '',
      classifyUsageKind: () => 'hosted',
    },
    './lib/mud1-rag': {
      getRAGContextForUser: () => '',
      getRAGPackageForUser: () => ({ context: '', sources: [], confidence: 'low', fallback_used: true }),
      buildMud1RAGSystemPrompt: () => 'system prompt',
    },
    './lib/project-rag-store': {
      getProjectRAGPackage: async () => ({
        context: projectRagContext,
        sources: [],
        confidence: projectRagContext ? 'high' : 'low',
        fallback_used: !projectRagContext,
      }),
    },
    './lib/rag-utils': {
      maxConfidence: () => 'high',
      mergeRagSources: () => [],
    },
  };
}

test('web chat builds proposal from project context and documents', async () => {
  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.SUPABASE_URL = 'https://supabase.example.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
  const repoRoot = path.resolve(__dirname, '..', '..');
  const handlerPath = path.join(repoRoot, 'web', 'api', 'chat.js');
  const handler = loadWithMocks(handlerPath, getCommonMocks([
    {
      choices: [{
        message: {
          content: JSON.stringify({
            client: 'City of Provo',
            scope: 'Install 1,200 LF of 12-inch sewer main with manholes, service reconnects, traffic control, and surface restoration.',
            total: 486500,
            duration: 28,
            bid_items: [
              { description: 'Mobilization', amount: 22500 },
              { description: 'Sewer main install', amount: 334000 },
              { description: 'Manholes and tie-ins', amount: 92000 },
              { description: 'Restoration and closeout', amount: 38000 },
            ],
            assumptions: 'Open-cut install. Normal working hours.',
            exclusions: 'Rock excavation and utility conflicts not shown in bid documents.',
          }),
        },
      }],
    },
  ], '[Project Source 1] Bid package\n12-inch sewer main, 1,200 LF, 4 manholes, asphalt patch.'));

  const req = createReq({
    messages: [{ role: 'user', content: 'Build a proposal from the project documents for this sewer job.' }],
    model: 'gpt-4o-mini',
    use_tools: true,
    project_id: 'proj_123',
    project_name: 'Provo Sewer Improvements',
    project_data: {
      client_name: 'City of Provo',
      utility_type: 'sewer',
      location: 'Provo, Utah',
    },
  });
  const res = createRes();

  await handler(req, res);

  const { statusCode, body } = res._getState();
  assert.equal(statusCode, 200);
  assert.deepEqual(body.tools_used, ['generate_proposal']);
  assert.ok(body._proposal_html.includes('Proposal'));
  const payload = extractTaggedJson(body.response, 'MUDRAG_PROPOSAL');
  assert.equal(payload.client, 'City of Provo');
  assert.equal(payload.total, 486500);
  assert.equal(payload.duration, 28);
  assert.equal(payload.bid_items.length, 4);
});

test('web chat builds schedule from project context and documents', async () => {
  process.env.OPENAI_API_KEY = 'test-openai-key';
  process.env.SUPABASE_URL = 'https://supabase.example.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
  const repoRoot = path.resolve(__dirname, '..', '..');
  const handlerPath = path.join(repoRoot, 'web', 'api', 'chat.js');
  const handler = loadWithMocks(handlerPath, getCommonMocks([
    {
      choices: [{
        message: {
          content: JSON.stringify({
            project_name: 'Airport Waterline Replacement',
            start_date: '2026-04-01',
            duration_days: 35,
            phases: ['Mobilization', 'Traffic control and sawcut', 'Trenching and shoring', 'Waterline install', 'Testing and tie-ins', 'Restoration'],
          }),
        },
      }],
    },
  ], '[Project Source 1] Spec summary\nAirport waterline replacement with trenching, testing, tie-ins, and restoration.'));

  const req = createReq({
    messages: [{ role: 'user', content: 'Generate the schedule from the project documents for this waterline job.' }],
    model: 'gpt-4o-mini',
    use_tools: true,
    project_id: 'proj_456',
    project_name: 'Airport Waterline Replacement',
    project_data: {
      project_type: 'waterline',
      start_date: '2026-04-01',
    },
  });
  const res = createRes();

  await handler(req, res);

  const { statusCode, body } = res._getState();
  assert.equal(statusCode, 200);
  assert.deepEqual(body.tools_used, ['generate_schedule']);
  const payload = extractTaggedJson(body.response, 'MUDRAG_SCHEDULE');
  assert.equal(payload.project, 'Airport Waterline Replacement');
  assert.equal(payload.duration, 35);
  assert.equal(payload.start_date, '2026-04-01');
  assert.equal(payload.phases.length, 6);
});
