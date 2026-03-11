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
            project_name: 'Provo Sewer Improvements',
            client: 'City of Provo',
            utility_type: 'sewer',
            scope_summary: 'Install 1,200 LF of 12-inch sewer main with 4 manholes, service reconnects, traffic control, and surface restoration.',
            quantity_summary: '1,200 LF sewer main and 4 manholes.',
            quantities: ['1,200 LF of 12-inch sewer main', '4 manholes', 'Asphalt patch restoration'],
            major_milestones: [
              'Mobilization, traffic control setup, and utility locate confirmation.',
              'Mainline trenching and sewer pipe installation complete.',
              'Testing, punch list, and final surface restoration complete.',
            ],
            project_risks: [
              'Unknown utility conflicts at service crossings.',
              'Traffic-control restrictions along the collector road.',
            ],
            logistics_plan: 'Maintain one lane of traffic and stage pipe along the east shoulder.',
          }),
        },
      }],
    },
    {
      choices: [{
        message: {
          content: JSON.stringify({
            client: 'City of Provo',
            executive_summary: 'Install a new sewer main package with traffic control, manholes, and surface restoration while maintaining safe access and a clean closeout path.',
            scope: 'Install 1,200 LF of 12-inch sewer main with manholes, service reconnects, traffic control, and surface restoration.',
            technical_approach: 'Use open-cut trenching, maintain traffic control by work zone, install sewer main and structures in sequenced runs, test each segment before final restoration, and coordinate tie-ins to minimize service disruption.',
            major_milestones: [
              'Mobilization, traffic control setup, and utility locate confirmation.',
              'Mainline trenching and sewer pipe installation complete.',
              'Manholes, tie-ins, and service reconnects complete.',
              'Testing, punch list, and final surface restoration complete.',
            ],
            total: 486500,
            duration: 28,
            bid_items: [
              { description: 'Mobilization', amount: 22500 },
              { description: 'Sewer main install', amount: 334000 },
              { description: 'Manholes and tie-ins', amount: 92000 },
              { description: 'Restoration and closeout', amount: 38000 },
            ],
            logistics_plan: 'Maintain one lane of traffic, stage pipe along the east shoulder, coordinate utility locates before trench production, and restore asphalt patches at the end of each work block.',
            project_risks: [
              'Unknown utility conflicts at service crossings.',
              'Traffic-control restrictions along the collector road.',
              'Production impacts if groundwater control is required.',
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
  assert.deepEqual(body.tools_used, ['extract_project_facts', 'generate_proposal']);
  assert.ok(body._proposal_html.includes('Proposal'));
  assert.ok(body._proposal_html.includes('Executive Summary'));
  assert.ok(body._proposal_html.includes('Technical Approach / Means and Methods'));
  assert.ok(body._proposal_html.includes('Major Milestones'));
  assert.ok(body._proposal_html.includes('Project Logistics'));
  assert.ok(body._proposal_html.includes('Project Risks and Constraints'));
  assert.ok(body._proposal_html.includes('Mainline trenching and sewer pipe installation complete.'));
  assert.ok(body._proposal_html.includes('Unknown utility conflicts at service crossings.'));
  const projectFacts = extractTaggedJson(body.response, 'MUDRAG_PROJECT_FACTS');
  assert.equal(projectFacts.utility_type, 'sewer');
  assert.equal(projectFacts.quantities.length, 3);
  const payload = extractTaggedJson(body.response, 'MUDRAG_PROPOSAL');
  assert.equal(payload.client, 'City of Provo');
  assert.match(payload.executive_summary, /sewer main package/i);
  assert.match(payload.technical_approach, /open-cut trenching/i);
  assert.equal(payload.total, 486500);
  assert.equal(payload.duration, 28);
  assert.equal(payload.bid_items.length, 4);
  assert.equal(payload.major_milestones.length, 4);
  assert.match(payload.logistics_plan, /one lane of traffic/i);
  assert.equal(payload.project_risks.length, 3);
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
            client: 'Airport Authority',
            utility_type: 'waterline',
            scope_summary: 'Replace existing airport waterline with trenching, testing, tie-ins, and restoration.',
            major_milestones: ['Mobilization', 'Traffic control and sawcut', 'Waterline install', 'Testing and restoration'],
            start_date: '2026-04-01',
            duration_days: 35,
          }),
        },
      }],
    },
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
  assert.deepEqual(body.tools_used, ['extract_project_facts', 'generate_schedule']);
  const projectFacts = extractTaggedJson(body.response, 'MUDRAG_PROJECT_FACTS');
  assert.equal(projectFacts.utility_type, 'waterline');
  const payload = extractTaggedJson(body.response, 'MUDRAG_SCHEDULE');
  assert.equal(payload.project, 'Airport Waterline Replacement');
  assert.equal(payload.duration, 35);
  assert.equal(payload.start_date, '2026-04-01');
  assert.equal(payload.phases.length, 6);
});

test('web chat extracts and returns reusable project facts', async () => {
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
            project_name: 'North County Force Main',
            client: 'North County Water',
            utility_type: 'force main',
            scope_summary: 'Install new force main, tie-ins, and restoration.',
            quantities: ['2,400 LF of 16-inch force main', '2 tie-ins', '2 valve assemblies'],
            major_milestones: ['Mobilization', 'Force main installation', 'Testing and restoration'],
            project_risks: ['Railroad permit timing', 'Unknown utility crossings'],
          }),
        },
      }],
    },
  ], '[Project Source 1] Bid package\n2,400 LF of 16-inch force main, 2 tie-ins, valve assemblies, and restoration.'));

  const req = createReq({
    messages: [{ role: 'user', content: 'Extract the project facts from these bid documents and save the project summary.' }],
    model: 'gpt-4o-mini',
    use_tools: true,
    project_id: 'proj_789',
    project_name: 'North County Force Main',
    project_data: {},
  });
  const res = createRes();

  await handler(req, res);

  const { statusCode, body } = res._getState();
  assert.equal(statusCode, 200);
  assert.deepEqual(body.tools_used, ['extract_project_facts']);
  const facts = extractTaggedJson(body.response, 'MUDRAG_PROJECT_FACTS');
  assert.equal(facts.project_name, 'North County Force Main');
  assert.equal(facts.client, 'North County Water');
  assert.equal(facts.quantities.length, 3);
  assert.equal(facts.project_risks.length, 2);
});

test('web chat builds change order from project context and documents', async () => {
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
            project_name: 'Provo Sewer Improvements',
            client: 'City of Provo',
            utility_type: 'sewer',
            scope_summary: 'Install sewer main, manholes, tie-ins, and restoration.',
            project_risks: ['Utility conflicts', 'Traffic-control restrictions'],
          }),
        },
      }],
    },
    {
      choices: [{
        message: {
          content: JSON.stringify({
            project_name: 'Provo Sewer Improvements',
            client: 'City of Provo',
            co_number: 'CO-003',
            title: 'Additional rock excavation at manhole tie-in',
            change_reason: 'Field conditions revealed unclassified rock at the north tie-in that was not shown in the bid documents.',
            scope: 'Excavate and remove rock, extend trench support, and install additional bedding to complete the tie-in safely.',
            line_items: [
              { description: 'Rock excavation', quantity: 42, unit: 'CY', unit_price: 185, amount: 7770 },
              { description: 'Additional shoring and trench support', quantity: 1, unit: 'LS', unit_price: 3200, amount: 3200 },
            ],
            amount: 10970,
            duration_days: 2,
            schedule_impact: 'Adds 2 working days to complete the tie-in and final restoration.',
            assumptions: 'Pricing assumes work can proceed during normal working hours.',
          }),
        },
      }],
    },
  ], '[Project Source 1] Daily note\nRock encountered at north tie-in. Additional excavation and trench support required.'));

  const req = createReq({
    messages: [{ role: 'user', content: 'Create a change order from the project documents for the extra rock excavation and schedule impact.' }],
    model: 'gpt-4o-mini',
    use_tools: true,
    project_id: 'proj_123',
    project_name: 'Provo Sewer Improvements',
    project_data: {
      client_name: 'City of Provo',
      utility_type: 'sewer',
    },
  });
  const res = createRes();

  await handler(req, res);

  const { statusCode, body } = res._getState();
  assert.equal(statusCode, 200);
  assert.deepEqual(body.tools_used, ['extract_project_facts', 'generate_change_order']);
  assert.ok(body._document_html.includes('Change Order'));
  assert.ok(body._document_html.includes('Reason for Change'));
  assert.ok(body._document_html.includes('Pricing Breakdown'));
  const facts = extractTaggedJson(body.response, 'MUDRAG_PROJECT_FACTS');
  assert.equal(facts.project_name, 'Provo Sewer Improvements');
  const payload = extractTaggedJson(body.response, 'MUDRAG_CHANGE_ORDER');
  assert.equal(payload.co_number, 'CO-003');
  assert.equal(payload.amount, 10970);
  assert.equal(payload.line_items.length, 2);
  assert.match(payload.schedule_impact, /2 working days/i);
});

test('web chat builds a repo-guided builder plan', async () => {
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
            goal: 'Ship the first agentic builder loop for openmud.',
            summary: 'Start with a repo-guided builder planning workflow in chat so feature requests turn into scoped implementation plans before we add heavier automation.',
            touched_files: [
              'web/api/lib/workflow-v1.js',
              'web/api/chat.js',
              'tests/integration/web-chat-workflow-v1.test.js',
            ],
            implementation_steps: [
              'Detect builder-plan intent in chat requests.',
              'Extract strict JSON for files, implementation steps, tests, and risks.',
              'Return a readable plan plus a hidden builder-plan payload for the client.',
            ],
            tests: [
              'Add an integration test for builder-plan generation.',
              'Verify proposal, schedule, and change-order workflows still pass.',
            ],
            risks: [
              'Builder intent could overlap with generic planning requests if the matcher is too broad.',
              'The workflow layer could grow too large if every builder feature lives directly in chat.js.',
            ],
            next_action: 'Use the builder plan to implement the next shipping workflow: document extraction quality improvements.',
          }),
        },
      }],
    },
  ]));

  const req = createReq({
    messages: [{ role: 'user', content: 'Build an agentic builder plan for openmud so we can ship faster and keep the workflow architecture clean.' }],
    model: 'gpt-4o-mini',
    use_tools: true,
    project_name: 'openmud',
    project_data: {},
  });
  const res = createRes();

  await handler(req, res);

  const { statusCode, body } = res._getState();
  assert.equal(statusCode, 200);
  assert.deepEqual(body.tools_used, ['generate_builder_plan']);
  assert.match(body.response, /Builder plan ready:/);
  const payload = extractTaggedJson(body.response, 'MUDRAG_BUILDER_PLAN');
  assert.equal(payload.goal, 'Ship the first agentic builder loop for openmud.');
  assert.equal(payload.touched_files.length, 3);
  assert.equal(payload.implementation_steps.length, 3);
  assert.equal(payload.tests.length, 2);
  assert.equal(payload.risks.length, 2);
  assert.match(payload.next_action, /document extraction quality improvements/i);
});
