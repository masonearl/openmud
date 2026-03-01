const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const buildSchedule = require('./schedule').buildSchedule;
const buildProposal = require('./proposal').buildProposal;
const telemetry = require('./_lib/toolTelemetry');

const OUTPUT_RULES = `
Output format: Plain text only. No markdown (no **, ##, ###). No LaTeX or math blocks (no \\[, \\], $$). Be concise. Short sentences. Get to the point. Use simple bullets with - if needed.`;
const WORKFLOW_RULES = `
Workflow intake:
- If user asks to find project info in email/files or extract from a document, switch to workflow-intake behavior.
- Ask only for missing essentials: project name, source (email/files/document), and target output.
- If direct connectors are unavailable, state that clearly and ask for uploaded files or pasted email thread text.`;

/** Model-specific system prompts: purpose + when to use which tools */
const SYSTEM_PROMPTS = {
  mud1: `You are mud1, openmud's primary construction assistant. You are NOT a person-never introduce yourself as Mason or anyone else. You help with estimating, scheduling, and proposals for underground utility work (waterline, sewer, storm, gas, electrical).

Your purpose: Be the go-to AI for construction pros using openmud.ai. You understand trenching, pipe sizing, labor/equipment rates, and bid workflows.

When to use tools:
- "Estimate", "cost", "price", "bid", "how much" -> use estimate_project_cost, calculate_material_cost, calculate_labor_cost, or calculate_equipment_cost
- "Schedule", "timeline", "phases", "duration", "turn into PDF", "generate schedule" -> use build_schedule. ALWAYS end schedule responses with: [OPENMUD_SCHEDULE]{"project":"Project Name","duration":N,"start_date":"YYYY-MM-DD","phases":["Task1","Task2",...]}[/OPENMUD_SCHEDULE]. Never say you cannot create PDFs-openmud generates them.
- "Proposal", "scope", "quote", "generate proposal" -> use render_proposal_html. When generating a proposal from an estimate, ALWAYS end with: [OPENMUD_PROPOSAL]{"client":"Name","scope":"...","total":N,"duration":N,"bid_items":[{"description":"Material","amount":N},...]}[/OPENMUD_PROPOSAL]

Be concise and practical. When you don't have a tool result, give ballpark guidance and suggest using the Tools menu (Quick estimate, Schedule, Proposal) for full outputs.${OUTPUT_RULES}`,

  'gpt-4o-mini': `You are a construction assistant for openmud. Help with cost estimates, schedules, and proposals for underground utility work.

When to use tools:
- Cost/estimate questions -> estimate_project_cost, calculate_material_cost, calculate_labor_cost, calculate_equipment_cost
- Schedule/timeline questions -> build_schedule. ALWAYS end schedule responses with: [OPENMUD_SCHEDULE]{"project":"Name","duration":N,"start_date":"YYYY-MM-DD","phases":["Phase1",...]}[/OPENMUD_SCHEDULE]. Never say you cannot create PDFs-openmud generates them.
- Proposal/scope questions -> render_proposal_html. When generating a proposal from an estimate, ALWAYS end with: [OPENMUD_PROPOSAL]{"client":"Name","scope":"...","total":N,"duration":N,"bid_items":[{"description":"Material","amount":N},...]}[/OPENMUD_PROPOSAL]

Be concise and practical.${OUTPUT_RULES}`,

  'gpt-4o': `You are a construction assistant for openmud. Help with cost estimates, schedules, and proposals for underground utility work.

When to use tools:
- Cost/estimate questions -> estimate_project_cost, calculate_material_cost, calculate_labor_cost, calculate_equipment_cost
- Schedule/timeline questions -> build_schedule. ALWAYS end schedule responses with: [OPENMUD_SCHEDULE]{"project":"Name","duration":N,"start_date":"YYYY-MM-DD","phases":["Phase1",...]}[/OPENMUD_SCHEDULE]. Never say you cannot create PDFs-openmud generates them.
- Proposal/scope questions -> render_proposal_html. When generating a proposal from an estimate, ALWAYS end with: [OPENMUD_PROPOSAL]{"client":"Name","scope":"...","total":N,"duration":N,"bid_items":[{"description":"Material","amount":N},...]}[/OPENMUD_PROPOSAL]

Be concise and practical.${OUTPUT_RULES}`,

  'claude-haiku-4-5-20251001': `You are a construction assistant for openmud. Help with cost estimates, schedules, and proposals for underground utility work.

When to use tools:
- Cost/estimate questions -> estimate_project_cost, calculate_material_cost, calculate_labor_cost, calculate_equipment_cost
- Schedule/timeline questions -> build_schedule. ALWAYS end schedule responses with: [OPENMUD_SCHEDULE]{"project":"Name","duration":N,"start_date":"YYYY-MM-DD","phases":["Phase1",...]}[/OPENMUD_SCHEDULE]. Never say you cannot create PDFs-openmud generates them.
- Proposal/scope questions -> render_proposal_html. When generating a proposal from an estimate, ALWAYS end with: [OPENMUD_PROPOSAL]{"client":"Name","scope":"...","total":N,"duration":N,"bid_items":[{"description":"Material","amount":N},...]}[/OPENMUD_PROPOSAL]

Be concise and practical.${OUTPUT_RULES}`,

  'claude-sonnet-4-6': `You are a construction assistant for openmud. Help with cost estimates, schedules, and proposals for underground utility work.

When to use tools:
- Cost/estimate questions -> estimate_project_cost, calculate_material_cost, calculate_labor_cost, calculate_equipment_cost
- Schedule/timeline questions -> build_schedule. ALWAYS end schedule responses with: [OPENMUD_SCHEDULE]{"project":"Name","duration":N,"start_date":"YYYY-MM-DD","phases":["Phase1",...]}[/OPENMUD_SCHEDULE]. Never say you cannot create PDFs-openmud generates them.
- Proposal/scope questions -> render_proposal_html. When generating a proposal from an estimate, ALWAYS end with: [OPENMUD_PROPOSAL]{"client":"Name","scope":"...","total":N,"duration":N,"bid_items":[{"description":"Material","amount":N},...]}[/OPENMUD_PROPOSAL]

Be concise and practical.${OUTPUT_RULES}`,

  'claude-opus-4-6': `You are a construction assistant for openmud. Help with cost estimates, schedules, and proposals for underground utility work.

When to use tools:
- Cost/estimate questions -> estimate_project_cost, calculate_material_cost, calculate_labor_cost, calculate_equipment_cost
- Schedule/timeline questions -> build_schedule. ALWAYS end schedule responses with: [OPENMUD_SCHEDULE]{"project":"Name","duration":N,"start_date":"YYYY-MM-DD","phases":["Phase1",...]}[/OPENMUD_SCHEDULE]. Never say you cannot create PDFs-openmud generates them.
- Proposal/scope questions -> render_proposal_html. When generating a proposal from an estimate, ALWAYS end with: [OPENMUD_PROPOSAL]{"client":"Name","scope":"...","total":N,"duration":N,"bid_items":[{"description":"Material","amount":N},...]}[/OPENMUD_PROPOSAL]

Be concise and practical.${OUTPUT_RULES}`,
};

/** Anthropic: map to model IDs. Old deprecated IDs redirect to current. */
const ANTHROPIC_MODELS = {
  'claude-haiku-4-5-20251001': ['claude-haiku-4-5-20251001'],
  'claude-sonnet-4-6': ['claude-sonnet-4-6'],
  'claude-opus-4-6': ['claude-opus-4-6'],
  'claude-3-5-haiku-20241022': ['claude-haiku-4-5-20251001'],
  'claude-3-5-sonnet-20241022': ['claude-sonnet-4-6'],
  'claude-3-opus-20240229': ['claude-opus-4-6'],
};

const OPENAI_MODELS = {
  'gpt-4o-mini': 'gpt-4o-mini',
  'gpt-4o': 'gpt-4o',
  'gpt-4-turbo': 'gpt-4-turbo',
  'gpt-3.5-turbo': 'gpt-3.5-turbo',
};

const SCHEDULE_INTENT = /generate\s+(a\s+)?schedule|create\s+(a\s+)?schedule|build\s+(a\s+)?schedule|help\s+me\s+generate\s+(a\s+)?schedule|make\s+(a\s+)?schedule|schedule\s+for|need\s+(a\s+)?schedule|want\s+(a\s+)?schedule|get\s+(a\s+)?schedule|turn\s+(it\s+)?into\s+(a\s+)?pdf|turn\s+this\s+into\s+(a\s+)?pdf|download\s+(the\s+)?pdf|make\s+(a\s+)?pdf|create\s+(a\s+)?pdf/i;

const PROPOSAL_INTENT = /generate\s+(a\s+)?proposal|create\s+(a\s+)?proposal|build\s+(a\s+)?proposal|draft\s+(a\s+)?proposal|make\s+(a\s+)?proposal|proposal\s+for|need\s+(a\s+)?proposal|want\s+(a\s+)?proposal|get\s+(a\s+)?proposal|turn\s+(it\s+)?into\s+(a\s+)?proposal|proposal\s+pdf/i;
const WORKFLOW_INTENT = /\b(find|search|pull|grab|locate|extract|read|parse)\b[\s\S]{0,80}\b(email|inbox|mail|file|files|folder|drive|document|pdf|attachment)\b|\bfrom\s+this\s+(document|pdf|file)\b/i;

const PROJECT_TYPE_LABELS = {
  waterline: 'waterline',
  sewer: 'sewer',
  storm_drain: 'storm drain',
  gas: 'gas',
  electrical: 'electrical',
};

const TOOL_SCHEMA_TTL_MS = 5 * 60 * 1000;
const toolSchemaCache = {
  expiresAt: 0,
  tools: [],
};

function getSystemPrompt(model) {
  const base = SYSTEM_PROMPTS[model] || SYSTEM_PROMPTS['gpt-4o-mini'];
  return `${base}\n\n${WORKFLOW_RULES}`;
}

function buildProposalFromEstimate(estimateContext) {
  if (!estimateContext || !estimateContext.payload || !estimateContext.result) return null;
  const p = estimateContext.payload;
  const r = estimateContext.result;
  const pt = PROJECT_TYPE_LABELS[p.project_type] || p.project_type || 'pipe';
  const scope = `${p.linear_feet || 0} LF of ${p.pipe_diameter || ''}" ${pt}, ${p.soil_type || ''} soil, ${p.trench_depth || ''} ft depth`;
  const total = r.predicted_cost || 0;
  const duration = r.duration_days || null;
  const breakdown = r.breakdown || {};
  const bidItems = [];
  if (breakdown.material) bidItems.push({ description: 'Material', amount: breakdown.material });
  if (breakdown.labor) bidItems.push({ description: 'Labor', amount: breakdown.labor });
  if (breakdown.equipment) bidItems.push({ description: 'Equipment', amount: breakdown.equipment });
  if (breakdown.misc) bidItems.push({ description: 'Miscellaneous', amount: breakdown.misc });
  if (breakdown.overhead) bidItems.push({ description: 'Overhead', amount: breakdown.overhead });
  if (breakdown.markup) bidItems.push({ description: 'Markup', amount: breakdown.markup });
  return { client: 'Project', scope, total, duration, bid_items: bidItems };
}

function ensureProposalBlock(responseText, userMsg, useTools, estimateContext) {
  if (!useTools || !PROPOSAL_INTENT.test(userMsg || '')) return responseText;
  if (/\[OPENMUD_PROPOSAL\]/.test(responseText || '')) return responseText;
  const params = buildProposalFromEstimate(estimateContext);
  if (!params) return responseText;

  try {
    buildProposal(params);
    const block = `[OPENMUD_PROPOSAL]${JSON.stringify({
      client: params.client,
      scope: params.scope,
      total: params.total,
      duration: params.duration,
      bid_items: params.bid_items,
    })}[/OPENMUD_PROPOSAL]`;
    const trimmed = (responseText || '').trim();
    return trimmed ? `${trimmed}\n\n${block}` : block;
  } catch (e) {
    console.error('Proposal injection error:', e);
    return responseText;
  }
}

function inferWorkflowSource(userMsg) {
  const msg = String(userMsg || '').toLowerCase();
  if (/\b(email|inbox|mail)\b/.test(msg)) return 'email';
  if (/\b(file|files|folder|drive)\b/.test(msg)) return 'files';
  if (/\b(document|pdf|attachment|extract|parse)\b/.test(msg)) return 'document';
  return 'unknown';
}

function extractProjectHint(userMsg, messages) {
  const text = String(userMsg || '');
  const patterns = [
    /\bproject\s*[:\-]\s*([a-z0-9][a-z0-9 &/_-]{2,80})/i,
    /\bfor\s+(?:the\s+)?project\s+([a-z0-9][a-z0-9 &/_-]{2,80})/i,
    /\bfor\s+([a-z0-9][a-z0-9 &/_-]{2,80})\s*(?:project)?$/i,
  ];
  for (const re of patterns) {
    const match = text.match(re);
    if (match && match[1]) return match[1].trim();
  }

  if (Array.isArray(messages)) {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (!m || m.role !== 'user') continue;
      const candidate = String(m.content || '');
      const pm = candidate.match(/\bproject\s*[:\-]\s*([a-z0-9][a-z0-9 &/_-]{2,80})/i);
      if (pm && pm[1]) return pm[1].trim();
    }
  }

  return 'Current project';
}

function buildWorkflowSteps(source, userMsg) {
  const wantsExtract = /\bextract|parse|read\b/i.test(String(userMsg || ''));
  if (source === 'email') {
    return [
      'Confirm the exact project name and date range.',
      'Collect matching email thread text or upload an exported email/PDF.',
      'Extract key fields (scope, quantities, dates, vendors, totals) and map to the project.',
      'Draft the next deliverable (proposal, schedule, or summary) from extracted data.',
    ];
  }
  if (source === 'files') {
    return [
      'Confirm project name and target folder/file names.',
      'Upload the source files in this chat workspace.',
      wantsExtract
        ? 'Extract line items, scope, and dates from uploaded files.'
        : 'Index file names and summarize relevant project docs.',
      'Generate the requested output from extracted project data.',
    ];
  }
  return [
    'Confirm project name and document type.',
    'Upload the document here for project-level processing.',
    wantsExtract
      ? 'Extract the requested fields from the document.'
      : 'Classify and summarize the document for the project record.',
    'Generate the next artifact (proposal, schedule, or response draft).',
  ];
}

function ensureWorkflowBlock(responseText, userMsg, useTools, messages) {
  if (!useTools || !WORKFLOW_INTENT.test(userMsg || '')) return responseText;
  if (/\[OPENMUD_WORKFLOW\]/.test(responseText || '')) return responseText;

  const source = inferWorkflowSource(userMsg);
  const project = extractProjectHint(userMsg, messages);
  const steps = buildWorkflowSteps(source, userMsg);
  const block = `[OPENMUD_WORKFLOW]${JSON.stringify({
    workflow: 'project_intake',
    source,
    project,
    steps,
    requires_upload: source !== 'email' || /\battachment|pdf|document|file\b/i.test(String(userMsg || '')),
    connectors_available: false,
  })}[/OPENMUD_WORKFLOW]`;

  const trimmed = (responseText || '').trim();
  return trimmed ? `${trimmed}\n\n${block}` : block;
}

function extractPhasesFromText(text) {
  if (!text || typeof text !== 'string') return null;
  const phases = [];
  const lines = text.split(/\n/);
  for (const line of lines) {
    const m = line.match(/^\d+\.\s*\*?\*?([^*\n|]+?)\*?\*?\s*(?:\||$)/)
      || line.match(/^\s*[-•]\s+([^\n]+)/)
      || line.match(/^Day\s+\d+[-–:]\d*:\s*([^\n]+)/)
      || line.match(/^\*\*([^*]+)\*\*\s*$/);
    if (m) {
      const name = (m[1] || '').trim().replace(/\s*[-–—].*$/, '').slice(0, 60);
      if (name && name.length > 1 && !/^\d+$/.test(name) && !/\d+\s*(day|week)s?$/i.test(name)) {
        phases.push(name);
      }
    }
  }
  return phases.length >= 2 ? phases : null;
}

function extractScheduleParams(userMsg, messages) {
  const msg = (userMsg || '').trim();
  let project = 'Project';
  let duration = 14;
  const durationMatch = msg.match(/(\d+)\s*(day|week)s?/i);
  if (durationMatch) duration = Math.max(1, Math.min(365, parseInt(durationMatch[1], 10)));
  const forMatch = msg.match(/schedule\s+for\s+([^.?!]+)/i)
    || msg.match(/for\s+([^.?!]+?)(?:\s+schedule|\s+\d|$)/i);
  if (forMatch) project = forMatch[1].trim().slice(0, 80) || project;

  const startDate = new Date().toISOString().slice(0, 10);
  let phases = ['Mobilization', 'Trenching', 'Pipe install', 'Backfill', 'Restoration'];
  if (messages && Array.isArray(messages)) {
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
    const extracted = extractPhasesFromText(lastAssistant?.content || '');
    if (extracted) phases = extracted;
  }
  return {
    project,
    duration,
    startDate,
    phases,
  };
}

function ensureScheduleBlock(responseText, userMsg, useTools, messages) {
  if (!useTools || !SCHEDULE_INTENT.test(userMsg || '')) return responseText;
  if (/\[OPENMUD_SCHEDULE\]/.test(responseText || '')) return responseText;
  try {
    const { project, duration, startDate, phases } = extractScheduleParams(userMsg, messages);
    const result = buildSchedule(project, duration, startDate, phases);
    const block = `[OPENMUD_SCHEDULE]{"project":"${result.project_name}","duration":${result.duration},"start_date":"${startDate}","phases":${JSON.stringify(phases)}}[/OPENMUD_SCHEDULE]`;
    const trimmed = (responseText || '').trim();
    return trimmed ? `${trimmed}\n\n${block}` : block;
  } catch (e) {
    console.error('Schedule injection error:', e);
    return responseText;
  }
}

function normalizeToolName(name) {
  if (!name) return name;
  if (name === 'generate_proposal') return 'render_proposal_html';
  return name;
}

function parseToolArgs(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (!host) return 'http://localhost:3000';
  return `${proto}://${host}`;
}

function buildInternalHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.OPENMUD_API_KEY) {
    headers['x-api-key'] = process.env.OPENMUD_API_KEY;
  }
  return headers;
}

async function callPythonTool(req, toolName, args) {
  const baseUrl = getBaseUrl(req);
  const response = await fetch(`${baseUrl}/api/python/tools`, {
    method: 'POST',
    headers: buildInternalHeaders(),
    body: JSON.stringify({ tool_name: toolName, arguments: args || {} }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error || `Python tool call failed for ${toolName}`);
  }
  return data?.result ?? data;
}

async function loadToolSchemas(req) {
  if (Date.now() < toolSchemaCache.expiresAt && toolSchemaCache.tools.length > 0) {
    return toolSchemaCache.tools;
  }

  const baseUrl = getBaseUrl(req);
  const response = await fetch(`${baseUrl}/api/python/registry`, {
    method: 'GET',
    headers: buildInternalHeaders(),
  });

  const data = await response.json();
  if (!response.ok || !Array.isArray(data?.tools)) {
    throw new Error(data?.error || 'Failed loading tool schemas from Python registry');
  }

  toolSchemaCache.tools = data.tools
    .filter((t) => t && t.type === 'function' && t.function && t.function.name)
    .map((t) => ({
      type: 'function',
      function: {
        name: normalizeToolName(t.function.name),
        description: t.function.description || '',
        parameters: t.function.parameters || { type: 'object', properties: {} },
      },
    }));
  toolSchemaCache.expiresAt = Date.now() + TOOL_SCHEMA_TTL_MS;
  return toolSchemaCache.tools;
}

function filterToolsByAvailability(allTools, useTools, availableTools) {
  if (!useTools) return [];
  if (!Array.isArray(availableTools) || availableTools.length === 0) {
    return allTools;
  }
  const allowed = new Set(availableTools.map(normalizeToolName));
  return allTools.filter((t) => allowed.has(t.function.name));
}

function toAnthropicTools(openAiTools) {
  return openAiTools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));
}

async function executeTool(req, toolName, args) {
  const normalized = normalizeToolName(toolName);
  switch (normalized) {
    case 'build_schedule': {
      const projectName = String(args.project_name || 'Project');
      const startDate = args.start_date || null;
      const durationDays = Math.max(1, toNum(args.duration_days, 14));
      const phases = Array.isArray(args.phases) ? args.phases.map((p) => String(p)) : null;
      const result = buildSchedule(projectName, durationDays, startDate, phases);
      return {
        project: result.project_name,
        duration: result.duration,
        start_date: startDate || new Date().toISOString().slice(0, 10),
        phases: (phases && phases.length > 0) ? phases : result.phases.map((r) => r.phase),
        table_html: result.table_html,
      };
    }
    case 'render_proposal_html': {
      const result = buildProposal({
        client: args.client || 'Project',
        scope: args.scope || '',
        total: toNum(args.total, 0),
        duration: args.duration == null ? null : toNum(args.duration, null),
        assumptions: args.assumptions || '',
        exclusions: args.exclusions || '',
        bid_items: Array.isArray(args.bid_items) ? args.bid_items : [],
      });
      return {
        client: result.client,
        scope: result.scope,
        total: result.total,
        duration: result.duration,
        bid_items: result.bid_items || [],
      };
    }
    case 'estimate_project_cost':
    case 'calculate_material_cost':
    case 'calculate_labor_cost':
    case 'calculate_equipment_cost':
      return callPythonTool(req, normalized, args);
    default:
      throw new Error(`Tool '${toolName}' is not supported`);
  }
}

async function executeToolWithTelemetry(req, context, toolName, args) {
  const started = Date.now();
  try {
    const result = await executeTool(req, toolName, args);
    telemetry.recordToolInvocation({
      provider: context.provider,
      model: context.model,
      tool_name: normalizeToolName(toolName),
      success: true,
      latency_ms: Date.now() - started,
    });
    return { ok: true, result };
  } catch (err) {
    telemetry.recordToolInvocation({
      provider: context.provider,
      model: context.model,
      tool_name: normalizeToolName(toolName),
      success: false,
      latency_ms: Date.now() - started,
      error: err?.message || String(err),
    });
    return { ok: false, error: err?.message || String(err) };
  }
}

async function runOpenAIWithTools(openai, req, options) {
  const {
    model,
    apiMessages,
    temperature,
    maxTokens,
    tools,
  } = options;

  const toolsUsed = [];
  let hadToolError = false;
  let messageBuffer = [...apiMessages];

  for (let step = 0; step < 6; step += 1) {
    const completion = await openai.chat.completions.create({
      model,
      messages: messageBuffer,
      temperature,
      max_tokens: maxTokens,
      tools: tools.length > 0 ? tools : undefined,
      tool_choice: tools.length > 0 ? 'auto' : undefined,
    });

    const assistantMessage = completion.choices?.[0]?.message;
    if (!assistantMessage) {
      return { text: 'No response.', toolsUsed, hadToolError };
    }

    const toolCalls = Array.isArray(assistantMessage.tool_calls) ? assistantMessage.tool_calls : [];
    if (toolCalls.length === 0) {
      return { text: assistantMessage.content || 'No response.', toolsUsed, hadToolError };
    }

    messageBuffer.push({
      role: 'assistant',
      content: assistantMessage.content || '',
      tool_calls: toolCalls,
    });

    for (const call of toolCalls) {
      const name = call?.function?.name;
      const args = parseToolArgs(call?.function?.arguments);
      const executed = await executeToolWithTelemetry(req, { provider: 'openai', model }, name, args);

      if (executed.ok) {
        toolsUsed.push(normalizeToolName(name));
      } else {
        hadToolError = true;
      }

      messageBuffer.push({
        role: 'tool',
        tool_call_id: call.id,
        name,
        content: JSON.stringify(executed.ok ? executed.result : { error: executed.error }),
      });
    }
  }

  const fallback = await openai.chat.completions.create({
    model,
    messages: messageBuffer,
    temperature,
    max_tokens: maxTokens,
  });
  return {
    text: fallback.choices?.[0]?.message?.content || 'No response.',
    toolsUsed,
    hadToolError,
  };
}

async function runAnthropicWithTools(anthropic, req, options) {
  const {
    model,
    system,
    chatMessages,
    temperature,
    maxTokens,
    tools,
  } = options;

  const toolsUsed = [];
  let hadToolError = false;
  let messageBuffer = [...chatMessages];

  for (let step = 0; step < 6; step += 1) {
    const response = await anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      temperature,
      messages: messageBuffer,
      tools: tools.length > 0 ? tools : undefined,
    });

    const blocks = Array.isArray(response.content) ? response.content : [];
    const toolUses = blocks.filter((b) => b && b.type === 'tool_use');
    const textParts = blocks.filter((b) => b && b.type === 'text').map((b) => b.text || '');
    const text = textParts.join('\n').trim();

    if (toolUses.length === 0) {
      return { text: text || 'No response.', toolsUsed, hadToolError };
    }

    messageBuffer.push({ role: 'assistant', content: blocks });

    const toolResults = [];
    for (const call of toolUses) {
      const name = call.name;
      const args = call.input || {};
      const executed = await executeToolWithTelemetry(req, { provider: 'anthropic', model }, name, args);

      if (executed.ok) {
        toolsUsed.push(normalizeToolName(name));
      } else {
        hadToolError = true;
      }

      toolResults.push({
        type: 'tool_result',
        tool_use_id: call.id,
        content: JSON.stringify(executed.ok ? executed.result : { error: executed.error }),
        is_error: !executed.ok,
      });
    }

    messageBuffer.push({ role: 'user', content: toolResults });
  }

  const fallback = await anthropic.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    temperature,
    messages: messageBuffer,
  });

  const fallbackText = (fallback.content || [])
    .filter((b) => b && b.type === 'text')
    .map((b) => b.text || '')
    .join('\n')
    .trim();

  return {
    text: fallbackText || 'No response.',
    toolsUsed,
    hadToolError,
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const {
      messages,
      model = 'gpt-4o-mini',
      temperature = 0.7,
      max_tokens = 1024,
      use_tools = false,
      available_tools = [],
      estimate_context = null,
    } = req.body || {};

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array required', response: null });
    }

    const registryTools = use_tools ? await loadToolSchemas(req) : [];
    const selectedOpenAITools = filterToolsByAvailability(registryTools, use_tools, available_tools);
    const selectedAnthropicTools = toAnthropicTools(selectedOpenAITools);

    const isAnthropic = model.startsWith('claude-');
    const isMud1 = model === 'mud1';

    if (isAnthropic) {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        return res.status(500).json({
          error: 'ANTHROPIC_API_KEY not configured',
          response: 'Add ANTHROPIC_API_KEY to Vercel -> Project -> Settings -> Environment Variables.',
        });
      }

      const anthropic = new Anthropic({ apiKey });
      const systemContent = messages[0]?.role === 'system' ? messages[0].content : null;
      const chatMessages = (systemContent ? messages.slice(1) : messages).map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: String(m.content || ''),
      }));

      if (chatMessages.length === 0 || chatMessages[chatMessages.length - 1].role !== 'user') {
        return res.status(400).json({ error: 'Last message must be from user', response: null });
      }

      const systemPrompt = getSystemPrompt(model);
      const system = systemContent ? `${systemPrompt}\n\n${systemContent}` : systemPrompt;
      const modelIds = ANTHROPIC_MODELS[model] || [model];
      let lastErr;

      for (const tryModel of modelIds) {
        try {
          const generated = await runAnthropicWithTools(anthropic, req, {
            model: tryModel,
            system,
            chatMessages,
            temperature,
            maxTokens: Math.min(max_tokens, 4096),
            tools: selectedAnthropicTools,
          });

          const lastUser = chatMessages.filter((m) => m.role === 'user').pop();
          let text = ensureScheduleBlock(generated.text, lastUser?.content, use_tools, messages);
          text = ensureProposalBlock(text, lastUser?.content, use_tools, estimate_context);
          text = ensureWorkflowBlock(text, lastUser?.content, use_tools, messages);

          const uniqueTools = [...new Set(generated.toolsUsed.filter(Boolean))];
          telemetry.recordChatRun({
            provider: 'anthropic',
            model: tryModel,
            tools_enabled: use_tools,
            tool_calls: uniqueTools.length,
            tool_errors: generated.hadToolError ? 1 : 0,
            fallback_without_tools: use_tools && uniqueTools.length === 0,
          });

          return res.status(200).json({ response: text, tools_used: uniqueTools });
        } catch (e) {
          lastErr = e;
          const msg = (e.message || '').toLowerCase();
          if (msg.includes('model') && msg.includes('not found') && modelIds.indexOf(tryModel) < modelIds.length - 1) {
            continue;
          }
          throw e;
        }
      }
      throw lastErr;
    }

    const effectiveModel = isMud1 ? 'gpt-4o-mini' : (OPENAI_MODELS[model] || model);
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: 'OPENAI_API_KEY not configured',
        response: 'Add OPENAI_API_KEY to Vercel -> Project -> Settings -> Environment Variables.',
      });
    }

    const openai = new OpenAI({ apiKey });
    const systemPrompt = getSystemPrompt(model);
    const hasSystem = messages[0]?.role === 'system';
    const apiMessages = hasSystem
      ? [{ role: 'system', content: `${systemPrompt}\n\n${messages[0].content}` }, ...messages.slice(1)]
      : [{ role: 'system', content: systemPrompt }, ...messages];

    const generated = await runOpenAIWithTools(openai, req, {
      model: effectiveModel,
      apiMessages,
      temperature,
      maxTokens: Math.min(max_tokens, 4096),
      tools: selectedOpenAITools,
    });

    const lastUser = messages.filter((m) => m.role === 'user').pop();
    let text = ensureScheduleBlock(generated.text, lastUser?.content, use_tools, messages);
    text = ensureProposalBlock(text, lastUser?.content, use_tools, estimate_context);
    text = ensureWorkflowBlock(text, lastUser?.content, use_tools, messages);

    const uniqueTools = [...new Set(generated.toolsUsed.filter(Boolean))];
    telemetry.recordChatRun({
      provider: 'openai',
      model: effectiveModel,
      tools_enabled: use_tools,
      tool_calls: uniqueTools.length,
      tool_errors: generated.hadToolError ? 1 : 0,
      fallback_without_tools: use_tools && uniqueTools.length === 0,
    });

    return res.status(200).json({ response: text, tools_used: uniqueTools });
  } catch (err) {
    console.error('Chat error:', err);
    let msg = err?.message || String(err);
    const status = err?.status ?? err?.statusCode;
    if (status === 401) msg = 'Invalid API key. Check your key in Vercel.';
    else if (status === 429) msg = 'Rate limit exceeded. Try again in a moment.';
    else if (msg.toLowerCase().includes('model') && (msg.toLowerCase().includes('not found') || msg.toLowerCase().includes('does not exist'))) {
      msg = 'Model not available. Try a different model.';
    }
    return res.status(500).json({
      error: msg,
      response: msg,
    });
  }
};
