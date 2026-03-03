const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const buildSchedule = require('./schedule').buildSchedule;
const buildProposal = require('./proposal').buildProposal;
const { getUserFromRequest } = require('./lib/auth');
const { allocateUsage, logUsageEvent, detectSource } = require('./lib/usage');
const { getRAGContextForUser, getRAGPackageForUser, buildMud1RAGSystemPrompt } = require('./lib/mud1-rag');
const { getProjectRAGPackage } = require('./lib/project-rag-store');
const { maxConfidence, mergeRagSources } = require('./lib/rag-utils');

// Shared openmud capabilities – update mud1/docs/CAPABILITIES.md and mud1/prompts/capabilities.js when adding features
let MUDRAG_CAPABILITIES = '';
try {
  MUDRAG_CAPABILITIES = require(path.join(__dirname, '..', 'mud1', 'prompts', 'capabilities.js'));
} catch (e) { /* mud1 not in path */ }

const OUTPUT_RULES = `
Output format: Plain text only. No markdown (no **, ##, ###). No LaTeX or math blocks (no \\[, \\], $$). Be concise. Short sentences. Get to the point. Use simple bullets with - if needed.`;

/** Model-specific system prompts: purpose + when to use which tools */
const SYSTEM_PROMPTS = {
  mud1: `You are mud1, openmud's proprietary AI assistant built specifically for construction. You are NOT a person—never introduce yourself as Mason or anyone else.
${MUDRAG_CAPABILITIES ? '\n' + MUDRAG_CAPABILITIES + '\n' : ''}
When users ask "what can you do" or "how can you help": List estimate, proposal, schedule, construction Q&A, projects. Desktop: organize desktop/downloads. Point to Tools menu.
Your role: Be the primary AI assistant for construction pros using openmud. You understand all of construction—residential, commercial, civil, underground utility (waterline, sewer, storm, gas), trenching, pipe sizing, labor/equipment rates, and complete bid workflows. mud1 is openmud's custom model, optimized from the ground up for construction work.

## Platform Knowledge
You know openmud inside and out:
- openmud is a desktop-first construction AI platform for estimating, bidding, and scheduling
- openmud.ai is the web version; desktop app available for macOS via .dmg download
- Desktop app has local tools: estimate calculator, schedule builder, proposal generator
- Web-only features: browser-based chat, landing page, account management
- mud1 is openmud's core AI; other models available for specific use cases

## Subscription Tiers (when users ask "which tier", "what plan", "personal vs pro", etc.)
- Free: $0. 5 messages/day, web only, basic estimates. Try openmud.
- Personal: $10/mo. 100 messages/day, web + desktop app, proposals & schedules. Solo contractors.
- Pro: $25/mo. Unlimited messages, desktop app & tools, RAG over data, priority support. Serious daily use.
- Executive: $100/mo. Pro + team features, API access, advanced AI models, dedicated support. Teams and power users.
Always suggest: Free for trial → Personal for contractors → Pro for daily use → Executive for teams.
Include link: openmud.ai/#pricing-section

## Tool Triggers & Output Blocks
- "Estimate", "cost", "price", "bid", "how much", "material cost", "labor cost", "equipment cost" → use estimate_project_cost, calculate_material_cost, calculate_labor_cost, or calculate_equipment_cost. Always provide breakdown.
- "Schedule", "timeline", "phases", "duration", "PDF", "Gantt", "project schedule" → use build_schedule. ALWAYS end with: [MUDRAG_SCHEDULE]{"project":"Project Name","duration":N,"start_date":"YYYY-MM-DD","phases":["Task1","Task2",...]}[/MUDRAG_SCHEDULE]
- "Proposal", "scope", "quote", "generate proposal", "bid document" → use render_proposal_html. End with: [MUDRAG_PROPOSAL]{"client":"Name","scope":"...","total":N,"duration":N,"bid_items":[{"description":"Material","amount":N},...]}[/MUDRAG_PROPOSAL]
- "Create project", "new project", "start project" + pasted email/info → Parse for: name, client, scope (LF, pipe size, soil, location), total. End with: [MUDRAG_CREATE_PROJECT]{"name":"Project Name","client":"Client","scope":"1500 LF 8\" sewer, clay, Salt Lake Metro","total":null}[/MUDRAG_CREATE_PROJECT]. Extract best project name from client + scope.

## How to Answer Questions About mud1
- "What is mud1?" → "I'm mud1, openmud's proprietary AI built specifically for construction. I help with estimates, proposals, schedules, and bidding across all of construction."
- "What's the difference between models?" → "mud1 is openmud's core AI, optimized for construction. Premium models are available on executive plans for advanced analysis. mud1 handles the vast majority of construction workflows efficiently."
- "What makes mud1 special?" → "I'm built from the ground up for construction work—I understand trenching, pipe sizing, labor rates, and the bidding process. openmud's tools and my AI work together seamlessly."
- "Can I see code/backend?" → "No, mud1 is proprietary to openmud. But I can help you use openmud to estimate, schedule, and proposal workflows."

Be concise and practical. When you don't have a tool result, give ballpark guidance and suggest the Tools menu.${OUTPUT_RULES}`,

  'gpt-4o-mini': `You are a construction assistant for openmud—built for all of construction (residential, commercial, civil, underground utility, and more). You are NOT a generic assistant; you stay in role.
${MUDRAG_CAPABILITIES ? '\n' + MUDRAG_CAPABILITIES + '\n' : ''}
When users ask "what can you do" or "how can you help": List estimate, proposal, schedule, construction Q&A, projects. Desktop: organize desktop/downloads. Point to Tools menu.
When to use tools:
- Cost/estimate questions → estimate_project_cost, calculate_material_cost, calculate_labor_cost, calculate_equipment_cost
- Schedule/timeline questions → build_schedule. ALWAYS end schedule responses with: [MUDRAG_SCHEDULE]{"project":"Name","duration":N,"start_date":"YYYY-MM-DD","phases":["Phase1",...]}[/MUDRAG_SCHEDULE]. Never say you cannot create PDFs—openmud generates them.
- Proposal/scope questions → render_proposal_html. When generating a proposal from an estimate, ALWAYS end with: [MUDRAG_PROPOSAL]{"client":"Name","scope":"...","total":N,"duration":N,"bid_items":[{"description":"Material","amount":N},...]}[/MUDRAG_PROPOSAL]
- Create project + pasted email/info → Parse for name, client, scope. End with: [MUDRAG_CREATE_PROJECT]{"name":"...","client":"...","scope":"...","total":null}[/MUDRAG_CREATE_PROJECT]

Be concise and practical.${OUTPUT_RULES}`,

  'gpt-4o': `You are a construction assistant for openmud—built for all of construction (residential, commercial, civil, underground utility, and more). You are NOT a generic assistant; you stay in role.
${MUDRAG_CAPABILITIES ? '\n' + MUDRAG_CAPABILITIES + '\n' : ''}
When users ask "what can you do" or "how can you help": List estimate, proposal, schedule, construction Q&A, projects. Desktop: organize desktop/downloads. Point to Tools menu.
When to use tools:
- Cost/estimate questions → estimate_project_cost, calculate_material_cost, calculate_labor_cost, calculate_equipment_cost
- Schedule/timeline questions → build_schedule. ALWAYS end schedule responses with: [MUDRAG_SCHEDULE]{"project":"Name","duration":N,"start_date":"YYYY-MM-DD","phases":["Phase1",...]}[/MUDRAG_SCHEDULE]. Never say you cannot create PDFs—openmud generates them.
- Proposal/scope questions → render_proposal_html. When generating a proposal from an estimate, ALWAYS end with: [MUDRAG_PROPOSAL]{"client":"Name","scope":"...","total":N,"duration":N,"bid_items":[{"description":"Material","amount":N},...]}[/MUDRAG_PROPOSAL]
- Create project + pasted email/info → Parse for name, client, scope. End with: [MUDRAG_CREATE_PROJECT]{"name":"...","client":"...","scope":"...","total":null}[/MUDRAG_CREATE_PROJECT]

Be concise and practical.${OUTPUT_RULES}`,

  'claude-3-haiku-20240307': `You are Claude Haiku, a fast construction AI for openmud—built for all of construction (residential, commercial, civil, underground utility, and more). You are NOT a generic assistant; you stay in role.
${MUDRAG_CAPABILITIES ? '\n' + MUDRAG_CAPABILITIES + '\n' : ''}
When users ask "what can you do" or "how can you help": List estimate, proposal, schedule, construction Q&A, projects. Desktop: organize desktop/downloads. Point to Tools menu.
openmud platform: Desktop + web construction AI for bidding. Tools: estimate, schedule, proposal, project creation.

Tool triggers:
- "Estimate", "cost", "price", "bid" → use estimate_project_cost or component cost tools. Provide breakdown.
- "Schedule", "timeline", "phases", "duration", "PDF" → use build_schedule. End with: [MUDRAG_SCHEDULE]{"project":"Name","duration":N,"start_date":"YYYY-MM-DD","phases":["Phase1",...]}[/MUDRAG_SCHEDULE]
- "Proposal", "scope", "quote" → use render_proposal_html. End with: [MUDRAG_PROPOSAL]{"client":"Name","scope":"...","total":N,"duration":N,"bid_items":[...]}[/MUDRAG_PROPOSAL]
- "Create project" + email/info → Parse and end with: [MUDRAG_CREATE_PROJECT]{"name":"...","client":"...","scope":"...","total":null}[/MUDRAG_CREATE_PROJECT]

Be practical and concise.${OUTPUT_RULES}`,

  'claude-haiku-4-5-20251001': `You are Claude Haiku, a fast construction AI for openmud—built for all of construction (residential, commercial, civil, underground utility, and more). You are NOT a generic assistant; you stay in role.
${MUDRAG_CAPABILITIES ? '\n' + MUDRAG_CAPABILITIES + '\n' : ''}
When users ask "what can you do" or "how can you help": List estimate, proposal, schedule, construction Q&A, projects. Desktop: organize desktop/downloads. Point to Tools menu.
openmud platform: Desktop + web construction AI for bidding. Tools: estimate, schedule, proposal, project creation.

Tool triggers:
- "Estimate", "cost", "price", "bid" → use estimate_project_cost or component cost tools. Provide breakdown.
- "Schedule", "timeline", "phases", "duration", "PDF" → use build_schedule. End with: [MUDRAG_SCHEDULE]{"project":"Name","duration":N,"start_date":"YYYY-MM-DD","phases":["Phase1",...]}[/MUDRAG_SCHEDULE]
- "Proposal", "scope", "quote" → use render_proposal_html. End with: [MUDRAG_PROPOSAL]{"client":"Name","scope":"...","total":N,"duration":N,"bid_items":[...]}[/MUDRAG_PROPOSAL]
- "Create project" + email/info → Parse and end with: [MUDRAG_CREATE_PROJECT]{"name":"...","client":"...","scope":"...","total":null}[/MUDRAG_CREATE_PROJECT]

Be practical and concise.${OUTPUT_RULES}`,

  'claude-sonnet-4-6': `You are Claude Sonnet, openmud's premium construction AI—built for all of construction (residential, commercial, civil, underground utility, and more). You are NOT a generic assistant; you stay in role.
${MUDRAG_CAPABILITIES ? '\n' + MUDRAG_CAPABILITIES + '\n' : ''}
When users ask "what can you do" or "how can you help": List estimate, proposal, schedule, construction Q&A, projects. Desktop: organize desktop/downloads. Point to Tools menu.
Core role: Help construction pros with estimates, schedules, and proposals across all of construction.

openmud platform info:
- Desktop-first construction AI for bidding and project management
- Models: mud1 (construction-optimized Haiku), Haiku (fast/cheap), Sonnet (you, premium).
- Tools: estimate_project_cost, build_schedule, render_proposal_html, create projects from emails.

Tool usage:
- "Estimate", "cost", "price", "bid" → use estimate_project_cost or component tools. Provide full breakdown.
- "Schedule", "timeline", "phases", "duration", "PDF" → use build_schedule. End with: [MUDRAG_SCHEDULE]{"project":"Name","duration":N,"start_date":"YYYY-MM-DD","phases":["Phase1",...]}[/MUDRAG_SCHEDULE]
- "Proposal", "scope", "quote" → use render_proposal_html. End with: [MUDRAG_PROPOSAL]{"client":"Name","scope":"...","total":N,"duration":N,"bid_items":[...]}[/MUDRAG_PROPOSAL]
- "Create project" + email/info → Parse and end with: [MUDRAG_CREATE_PROJECT]{"name":"...","client":"...","scope":"...","total":null}[/MUDRAG_CREATE_PROJECT]

Be thorough, accurate, and practical.${OUTPUT_RULES}`,
};

function getSystemPrompt(model) {
  return SYSTEM_PROMPTS[model] || SYSTEM_PROMPTS['gpt-4o-mini'];
}

/** Anthropic: map to model IDs. Old deprecated IDs redirect to current. */
const ANTHROPIC_MODELS = {
  'mud1': ['claude-haiku-4-5-20251001'],
  'claude-3-haiku-20240307': ['claude-3-haiku-20240307'],
  'claude-haiku-4-5-20251001': ['claude-haiku-4-5-20251001'],
  'claude-sonnet-4-6': ['claude-sonnet-4-6'],
  'claude-3-5-haiku-20241022': ['claude-haiku-4-5-20251001'],
  'claude-3-5-sonnet-20241022': ['claude-sonnet-4-6'],
  'claude-3-opus-20240229': ['claude-sonnet-4-6'], // Fallback to Sonnet if Opus requested
};
const OPENAI_MODELS = {
  'gpt-4o-mini': 'gpt-4o-mini',
  'gpt-4o': 'gpt-4o',
  'gpt-4-turbo': 'gpt-4-turbo',
  'gpt-3.5-turbo': 'gpt-3.5-turbo',
  'o1-mini': 'o1-mini',
  'o1': 'o1',
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
  if (/\[MUDRAG_PROPOSAL\]/.test(responseText || '')) return responseText;
  const params = buildProposalFromEstimate(estimateContext);
  if (!params) return responseText;
  try {
    const result = buildProposal(params);
    const block = `[MUDRAG_PROPOSAL]${JSON.stringify({ client: params.client, scope: params.scope, total: params.total, duration: params.duration, bid_items: params.bid_items })}[/MUDRAG_PROPOSAL]`;
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
  if (/\[MUDRAG_SCHEDULE\]/.test(responseText || '')) return responseText;
  try {
    const { project, duration, startDate, phases } = extractScheduleParams(userMsg, messages);
    const result = buildSchedule(project, duration, startDate, phases);
    const block = `[MUDRAG_SCHEDULE]{"project":"${result.project_name}","duration":${result.duration},"start_date":"${startDate}","phases":${JSON.stringify(phases)}}[/MUDRAG_SCHEDULE]`;
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { messages, model = 'mud1', temperature = 0.7, max_tokens = 1024, use_tools = false, estimate_context = null, stream = false, email, project_id } = req.body || {};
    const reqSource = detectSource(req);

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array required', response: null });
    }

    // Require auth and allocate usage (check + increment)
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({
        error: 'Sign in to chat. Go to openmud.ai/settings to sign in.',
        response: null,
      });
    }
    const alloc = await allocateUsage(user.id, user.email);
    if (!alloc.allowed) {
      const limitLabel = alloc.limit == null ? 'unlimited' : alloc.limit;
      return res.status(429).json({
        error: `Daily limit reached (${alloc.used}/${limitLabel}). Upgrade at openmud.ai/subscribe.html for more messages.`,
        response: null,
        usage: { used: alloc.used, limit: alloc.limit, date: alloc.date },
      });
    }

    const isMud1 = model === 'mud1';
    const isAnthropic = model.startsWith('claude-');

    // mud1: True RAG — retrieve from knowledge base → GPT-4o generates grounded response
    if (isMud1) {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({
          error: 'OPENAI_API_KEY not configured',
          response: null,
        });
      }
      const lastUser = messages.filter((m) => m.role === 'user').pop();
      const userText = lastUser ? String(lastUser.content || '').trim() : '';
      const ragPkg = getRAGPackageForUser(userText, 5);
      const kbContext = (ragPkg && ragPkg.context) ? ragPkg.context : getRAGContextForUser(userText);
      let projectRag = null;
      if (project_id) {
        try {
          const url = process.env.SUPABASE_URL;
          const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
          if (url && key) {
            const supabase = createClient(url, key);
            projectRag = await getProjectRAGPackage({
              projectId: project_id,
              query: userText,
              userId: user.id,
              topK: 6,
              supabaseClient: supabase,
            });
          }
        } catch (e) {
          projectRag = null;
        }
      }
      const retrievedContext = (projectRag && projectRag.context)
        ? `## Project documents and imported email context (highest priority)\n${projectRag.context}\n\n## Construction knowledge base\n${kbContext}`
        : kbContext;
      const systemPrompt = buildMud1RAGSystemPrompt(retrievedContext);
      const chatMessages = messages.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: String(m.content || ''),
      }));
      const openai = new OpenAI({ apiKey });
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'system', content: systemPrompt }, ...chatMessages],
        max_tokens: Math.min(max_tokens, 512),
        temperature: 0.5,
      });
      const text = completion.choices?.[0]?.message?.content || 'What can I help with?';
      const usage = completion.usage || {};
      logUsageEvent(user.id, { model, inputTokens: usage.prompt_tokens || 0, outputTokens: usage.completion_tokens || 0, source: reqSource, requestType: use_tools ? 'estimate' : 'chat' });
      const mergedSources = mergeRagSources(
        (projectRag && projectRag.sources) || [],
        (ragPkg && Array.isArray(ragPkg.sources)) ? ragPkg.sources : []
      );
      const mergedConfidence = maxConfidence(
        (projectRag && projectRag.confidence) || 'low',
        (ragPkg && ragPkg.confidence) || 'low'
      );
      const fallbackUsed = ((projectRag && projectRag.fallback_used) !== false)
        && !!(ragPkg && ragPkg.fallback_used);
      return res.status(200).json({
        response: text.trim(),
        tools_used: [],
        rag: {
          confidence: mergedConfidence,
          fallback_used: fallbackUsed,
          sources: mergedSources,
        },
      });
    }

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
          const ausage = response.usage || {};
          logUsageEvent(user.id, { model, inputTokens: ausage.input_tokens || 0, outputTokens: ausage.output_tokens || 0, source: reqSource, requestType: use_tools ? 'estimate' : 'chat' });
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

    const isO1 = effectiveModel === 'o1' || effectiveModel === 'o1-mini';
    const createParams = {
      model: effectiveModel,
      messages: apiMessages,
      max_tokens: Math.min(max_tokens, 4096),
    };
    if (!isO1) createParams.temperature = temperature;

    // Streaming: only when use_tools is false (no post-processing needed)
    if (stream && !use_tools) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');

      const streamCompletion = await openai.chat.completions.create({
        ...createParams,
        stream: true,
      });

      let fullText = '';
      for await (const chunk of streamCompletion) {
        const content = chunk.choices?.[0]?.delta?.content;
        if (content) {
          fullText += content;
          res.write('data: ' + JSON.stringify({ content }) + '\n\n');
        }
      }
      res.write('data: [DONE]\n\n');
      return res.end();
    }

    const completion = await openai.chat.completions.create(createParams);

    const rawText = completion.choices?.[0]?.message?.content || 'No response.';
    const lastUser = messages.filter((m) => m.role === 'user').pop();
    let text = ensureScheduleBlock(rawText, lastUser?.content, use_tools, messages);
    text = ensureProposalBlock(text, lastUser?.content, use_tools, estimate_context);
    const ousage = completion.usage || {};
    logUsageEvent(user.id, { model, inputTokens: ousage.prompt_tokens || 0, outputTokens: ousage.completion_tokens || 0, source: reqSource, requestType: use_tools ? 'estimate' : 'chat' });
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
