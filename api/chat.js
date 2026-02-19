const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const buildSchedule = require('./schedule').buildSchedule;
const buildProposal = require('./proposal').buildProposal;

const OUTPUT_RULES = `
Output format: Plain text only. No markdown (no **, ##, ###). No LaTeX or math blocks (no \\[, \\], $$). Be concise. Short sentences. Get to the point. Use simple bullets with - if needed.`;

/** Model-specific system prompts: purpose + when to use which tools */
const SYSTEM_PROMPTS = {
  mud1: `You are mud1, Rockmud's primary construction assistant. You are NOT a person—never introduce yourself as Mason or anyone else. You help with estimating, scheduling, and proposals for underground utility work (waterline, sewer, storm, gas, electrical).

Your purpose: Be the go-to AI for construction pros using rockmud.com. You understand trenching, pipe sizing, labor/equipment rates, and bid workflows.

When to use tools:
- "Estimate", "cost", "price", "bid", "how much" → use estimate_project_cost, calculate_material_cost, calculate_labor_cost, or calculate_equipment_cost
- "Schedule", "timeline", "phases", "duration", "turn into PDF", "generate schedule" → use build_schedule. ALWAYS end schedule responses with: [ROCKMUD_SCHEDULE]{"project":"Project Name","duration":N,"start_date":"YYYY-MM-DD","phases":["Task1","Task2",...]}[/ROCKMUD_SCHEDULE]. Never say you cannot create PDFs—Rockmud generates them.
- "Proposal", "scope", "quote", "generate proposal" → use render_proposal_html. When generating a proposal from an estimate, ALWAYS end with: [ROCKMUD_PROPOSAL]{"client":"Name","scope":"...","total":N,"duration":N,"bid_items":[{"description":"Material","amount":N},...]}[/ROCKMUD_PROPOSAL]

Be concise and practical. When you don't have a tool result, give ballpark guidance and suggest using the Tools menu (Quick estimate, Schedule, Proposal) for full outputs.${OUTPUT_RULES}`,

  'gpt-4o-mini': `You are a construction assistant for Rockmud. Help with cost estimates, schedules, and proposals for underground utility work.

When to use tools:
- Cost/estimate questions → estimate_project_cost, calculate_material_cost, calculate_labor_cost, calculate_equipment_cost
- Schedule/timeline questions → build_schedule. ALWAYS end schedule responses with: [ROCKMUD_SCHEDULE]{"project":"Name","duration":N,"start_date":"YYYY-MM-DD","phases":["Phase1",...]}[/ROCKMUD_SCHEDULE]. Never say you cannot create PDFs—Rockmud generates them.
- Proposal/scope questions → render_proposal_html. When generating a proposal from an estimate, ALWAYS end with: [ROCKMUD_PROPOSAL]{"client":"Name","scope":"...","total":N,"duration":N,"bid_items":[{"description":"Material","amount":N},...]}[/ROCKMUD_PROPOSAL]

Be concise and practical.${OUTPUT_RULES}`,

  'gpt-4o': `You are a construction assistant for Rockmud. Help with cost estimates, schedules, and proposals for underground utility work.

When to use tools:
- Cost/estimate questions → estimate_project_cost, calculate_material_cost, calculate_labor_cost, calculate_equipment_cost
- Schedule/timeline questions → build_schedule. ALWAYS end schedule responses with: [ROCKMUD_SCHEDULE]{"project":"Name","duration":N,"start_date":"YYYY-MM-DD","phases":["Phase1",...]}[/ROCKMUD_SCHEDULE]. Never say you cannot create PDFs—Rockmud generates them.
- Proposal/scope questions → render_proposal_html. When generating a proposal from an estimate, ALWAYS end with: [ROCKMUD_PROPOSAL]{"client":"Name","scope":"...","total":N,"duration":N,"bid_items":[{"description":"Material","amount":N},...]}[/ROCKMUD_PROPOSAL]

Be concise and practical.${OUTPUT_RULES}`,

  'claude-haiku-4-5-20251001': `You are a construction assistant for Rockmud. Help with cost estimates, schedules, and proposals for underground utility work.

When to use tools:
- Cost/estimate questions → estimate_project_cost, calculate_material_cost, calculate_labor_cost, calculate_equipment_cost
- Schedule/timeline questions → build_schedule. ALWAYS end schedule responses with: [ROCKMUD_SCHEDULE]{"project":"Name","duration":N,"start_date":"YYYY-MM-DD","phases":["Phase1",...]}[/ROCKMUD_SCHEDULE]. Never say you cannot create PDFs—Rockmud generates them.
- Proposal/scope questions → render_proposal_html. When generating a proposal from an estimate, ALWAYS end with: [ROCKMUD_PROPOSAL]{"client":"Name","scope":"...","total":N,"duration":N,"bid_items":[{"description":"Material","amount":N},...]}[/ROCKMUD_PROPOSAL]

Be concise and practical.${OUTPUT_RULES}`,

  'claude-sonnet-4-6': `You are a construction assistant for Rockmud. Help with cost estimates, schedules, and proposals for underground utility work.

When to use tools:
- Cost/estimate questions → estimate_project_cost, calculate_material_cost, calculate_labor_cost, calculate_equipment_cost
- Schedule/timeline questions → build_schedule. ALWAYS end schedule responses with: [ROCKMUD_SCHEDULE]{"project":"Name","duration":N,"start_date":"YYYY-MM-DD","phases":["Phase1",...]}[/ROCKMUD_SCHEDULE]. Never say you cannot create PDFs—Rockmud generates them.
- Proposal/scope questions → render_proposal_html. When generating a proposal from an estimate, ALWAYS end with: [ROCKMUD_PROPOSAL]{"client":"Name","scope":"...","total":N,"duration":N,"bid_items":[{"description":"Material","amount":N},...]}[/ROCKMUD_PROPOSAL]

Be concise and practical.${OUTPUT_RULES}`,

  'claude-opus-4-6': `You are a construction assistant for Rockmud. Help with cost estimates, schedules, and proposals for underground utility work.

When to use tools:
- Cost/estimate questions → estimate_project_cost, calculate_material_cost, calculate_labor_cost, calculate_equipment_cost
- Schedule/timeline questions → build_schedule. ALWAYS end schedule responses with: [ROCKMUD_SCHEDULE]{"project":"Name","duration":N,"start_date":"YYYY-MM-DD","phases":["Phase1",...]}[/ROCKMUD_SCHEDULE]. Never say you cannot create PDFs—Rockmud generates them.
- Proposal/scope questions → render_proposal_html. When generating a proposal from an estimate, ALWAYS end with: [ROCKMUD_PROPOSAL]{"client":"Name","scope":"...","total":N,"duration":N,"bid_items":[{"description":"Material","amount":N},...]}[/ROCKMUD_PROPOSAL]

Be concise and practical.${OUTPUT_RULES}`,
};

function getSystemPrompt(model) {
  return SYSTEM_PROMPTS[model] || SYSTEM_PROMPTS['gpt-4o-mini'];
}

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

const PROJECT_TYPE_LABELS = { waterline: 'waterline', sewer: 'sewer', storm_drain: 'storm drain', gas: 'gas', electrical: 'electrical' };

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
  if (/\[ROCKMUD_PROPOSAL\]/.test(responseText || '')) return responseText;
  const params = buildProposalFromEstimate(estimateContext);
  if (!params) return responseText;
  try {
    const result = buildProposal(params);
    const block = `[ROCKMUD_PROPOSAL]${JSON.stringify({ client: params.client, scope: params.scope, total: params.total, duration: params.duration, bid_items: params.bid_items })}[/ROCKMUD_PROPOSAL]`;
    const trimmed = (responseText || '').trim();
    return trimmed ? trimmed + '\n\n' + block : block;
  } catch (e) {
    console.error('Proposal injection error:', e);
    return responseText;
  }
}

function extractPhasesFromText(text) {
  if (!text || typeof text !== 'string') return null;
  const phases = [];
  const lines = text.split(/\n/);
  for (const line of lines) {
    const m = line.match(/^\d+\.\s*\*?\*?([^*\n|]+?)\*?\*?\s*(?:\||$)/) ||
      line.match(/^\s*[-•]\s+([^\n]+)/) ||
      line.match(/^Day\s+\d+[-–:]\d*:\s*([^\n]+)/) ||
      line.match(/^\*\*([^*]+)\*\*\s*$/);
    if (m) {
      const name = (m[1] || '').trim().replace(/\s*[-–—].*$/, '').slice(0, 60);
      if (name && name.length > 1 && !/^\d+$/.test(name) && !/\d+\s*(day|week)s?$/i.test(name)) phases.push(name);
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
  const forMatch = msg.match(/schedule\s+for\s+([^.?!]+)/i) || msg.match(/for\s+([^.?!]+?)(?:\s+schedule|\s+\d|$)/i);
  if (forMatch) project = forMatch[1].trim().slice(0, 80) || project;
  const startDate = new Date().toISOString().slice(0, 10);
  let phases = ['Mobilization', 'Trenching', 'Pipe install', 'Backfill', 'Restoration'];
  if (messages && Array.isArray(messages)) {
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
    const extracted = extractPhasesFromText(lastAssistant?.content || '');
    if (extracted) phases = extracted;
  }
  return { project, duration, startDate, phases };
}

function ensureScheduleBlock(responseText, userMsg, useTools, messages) {
  if (!useTools || !SCHEDULE_INTENT.test(userMsg || '')) return responseText;
  if (/\[ROCKMUD_SCHEDULE\]/.test(responseText || '')) return responseText;
  try {
    const { project, duration, startDate, phases } = extractScheduleParams(userMsg, messages);
    const result = buildSchedule(project, duration, startDate, phases);
    const block = `[ROCKMUD_SCHEDULE]{"project":"${result.project_name}","duration":${result.duration},"start_date":"${startDate}","phases":${JSON.stringify(phases)}}[/ROCKMUD_SCHEDULE]`;
    const trimmed = (responseText || '').trim();
    return trimmed ? trimmed + '\n\n' + block : block;
  } catch (e) {
    console.error('Schedule injection error:', e);
    return responseText;
  }
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
    const { messages, model = 'gpt-4o-mini', temperature = 0.7, max_tokens = 1024, use_tools = false, estimate_context = null } = req.body || {};

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array required', response: null });
    }

    const isAnthropic = model.startsWith('claude-');
    const isMud1 = model === 'mud1';

    if (isAnthropic) {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        return res.status(500).json({
          error: 'ANTHROPIC_API_KEY not configured',
          response: 'Add ANTHROPIC_API_KEY to Vercel → Project → Settings → Environment Variables.',
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
          const response = await anthropic.messages.create({
            model: tryModel,
            max_tokens: Math.min(max_tokens, 4096),
            system,
            messages: chatMessages,
          });
          const rawText = response.content?.[0]?.type === 'text' ? response.content[0].text : '';
          const lastUser = chatMessages.filter((m) => m.role === 'user').pop();
          let text = ensureScheduleBlock(rawText || 'No response.', lastUser?.content, use_tools, messages);
          text = ensureProposalBlock(text, lastUser?.content, use_tools, estimate_context);
          return res.status(200).json({ response: text, tools_used: [] });
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
        response: 'Add OPENAI_API_KEY to Vercel → Project → Settings → Environment Variables.',
      });
    }

    const openai = new OpenAI({ apiKey });
    const systemPrompt = getSystemPrompt(model);
    const hasSystem = messages[0]?.role === 'system';
    const apiMessages = hasSystem
      ? [{ role: 'system', content: `${systemPrompt}\n\n${messages[0].content}` }, ...messages.slice(1)]
      : [{ role: 'system', content: systemPrompt }, ...messages];

    const completion = await openai.chat.completions.create({
      model: effectiveModel,
      messages: apiMessages,
      temperature,
      max_tokens: Math.min(max_tokens, 4096),
    });

    const rawText = completion.choices?.[0]?.message?.content || 'No response.';
    const lastUser = messages.filter((m) => m.role === 'user').pop();
    let text = ensureScheduleBlock(rawText, lastUser?.content, use_tools, messages);
    text = ensureProposalBlock(text, lastUser?.content, use_tools, estimate_context);
    return res.status(200).json({ response: text, tools_used: [] });
  } catch (err) {
    console.error('Chat error:', err);
    let msg = err?.message || String(err);
    const status = err?.status ?? err?.statusCode;
    if (status === 401) msg = 'Invalid API key. Check your key in Vercel.';
    else if (status === 429) msg = 'Rate limit exceeded. Try again in a moment.';
    else if ((msg.toLowerCase().includes('model') && (msg.toLowerCase().includes('not found') || msg.toLowerCase().includes('does not exist')))) msg = 'Model not available. Try a different model.';
    return res.status(500).json({
      error: msg,
      response: msg,
    });
  }
};
