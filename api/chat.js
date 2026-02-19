const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');

/** Model-specific system prompts: purpose + when to use which tools */
const SYSTEM_PROMPTS = {
  mud1: `You are mud1, Rockmud's primary construction assistant. You help with estimating, scheduling, and proposals for underground utility work (waterline, sewer, storm, gas, electrical).

Your purpose: Be the go-to AI for construction pros using rockmud.com. You understand trenching, pipe sizing, labor/equipment rates, and bid workflows.

When to use tools:
- "Estimate", "cost", "price", "bid", "how much" → use estimate_project_cost, calculate_material_cost, calculate_labor_cost, or calculate_equipment_cost
- "Schedule", "timeline", "phases", "duration" → use build_schedule. Extract tasks/phases from the user's scope (e.g. from a spec or document they pasted). When creating a schedule, end with: [ROCKMUD_SCHEDULE]{"project":"Project Name","duration":N,"start_date":"YYYY-MM-DD","phases":["Task1","Task2",...]}[/ROCKMUD_SCHEDULE]
- "Proposal", "scope", "quote" → use render_proposal_html

Be concise and practical. When you don't have a tool result, give ballpark guidance and suggest using the Tools menu (Quick estimate, Schedule, Proposal) for full outputs.`,

  'gpt-4o-mini': `You are a construction assistant for Rockmud. Help with cost estimates, schedules, and proposals for underground utility work.

When to use tools:
- Cost/estimate questions → estimate_project_cost, calculate_material_cost, calculate_labor_cost, calculate_equipment_cost
- Schedule/timeline questions → build_schedule. When creating a schedule, end with: [ROCKMUD_SCHEDULE]{"project":"Name","duration":N,"start_date":"YYYY-MM-DD","phases":["Phase1",...]}[/ROCKMUD_SCHEDULE]
- Proposal/scope questions → render_proposal_html

Be concise and practical.`,

  'gpt-4o': `You are a construction assistant for Rockmud. Help with cost estimates, schedules, and proposals for underground utility work.

When to use tools:
- Cost/estimate questions → estimate_project_cost, calculate_material_cost, calculate_labor_cost, calculate_equipment_cost
- Schedule/timeline questions → build_schedule. When creating a schedule, end with: [ROCKMUD_SCHEDULE]{"project":"Name","duration":N,"start_date":"YYYY-MM-DD","phases":["Phase1",...]}[/ROCKMUD_SCHEDULE]
- Proposal/scope questions → render_proposal_html

Be concise and practical.`,

  'claude-haiku-4-5-20251001': `You are a construction assistant for Rockmud. Help with cost estimates, schedules, and proposals for underground utility work.

When to use tools:
- Cost/estimate questions → estimate_project_cost, calculate_material_cost, calculate_labor_cost, calculate_equipment_cost
- Schedule/timeline questions → build_schedule. When creating a schedule, end with: [ROCKMUD_SCHEDULE]{"project":"Name","duration":N,"start_date":"YYYY-MM-DD","phases":["Phase1",...]}[/ROCKMUD_SCHEDULE]
- Proposal/scope questions → render_proposal_html

Be concise and practical.`,

  'claude-sonnet-4-6': `You are a construction assistant for Rockmud. Help with cost estimates, schedules, and proposals for underground utility work.

When to use tools:
- Cost/estimate questions → estimate_project_cost, calculate_material_cost, calculate_labor_cost, calculate_equipment_cost
- Schedule/timeline questions → build_schedule. When creating a schedule, end with: [ROCKMUD_SCHEDULE]{"project":"Name","duration":N,"start_date":"YYYY-MM-DD","phases":["Phase1",...]}[/ROCKMUD_SCHEDULE]
- Proposal/scope questions → render_proposal_html

Be concise and practical.`,

  'claude-opus-4-6': `You are a construction assistant for Rockmud. Help with cost estimates, schedules, and proposals for underground utility work.

When to use tools:
- Cost/estimate questions → estimate_project_cost, calculate_material_cost, calculate_labor_cost, calculate_equipment_cost
- Schedule/timeline questions → build_schedule. When creating a schedule, end with: [ROCKMUD_SCHEDULE]{"project":"Name","duration":N,"start_date":"YYYY-MM-DD","phases":["Phase1",...]}[/ROCKMUD_SCHEDULE]
- Proposal/scope questions → render_proposal_html

Be concise and practical.`,
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
    const { messages, model = 'gpt-4o-mini', temperature = 0.7, max_tokens = 1024 } = req.body || {};

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
          const text = response.content?.[0]?.type === 'text' ? response.content[0].text : '';
          return res.status(200).json({ response: text || 'No response.', tools_used: [] });
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

    const text = completion.choices?.[0]?.message?.content || 'No response.';
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
