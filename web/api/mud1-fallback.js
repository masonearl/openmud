/**
 * mud1 RAG endpoint: True RAG — retrieve from knowledge base → LLM generates grounded response.
 * Every mud1 question flows through: retrieve relevant data → inject into LLM context → generate.
 */
const OpenAI = require('openai');
const { createClient } = require('@supabase/supabase-js');
const { getUserFromRequest } = require('./lib/auth');
const { logUsageEvent, detectSource } = require('./lib/usage');
const { classifyUsageKind } = require('./lib/model-policy');
const { getRAGContextForUser, getRAGPackageForUser, buildMud1RAGSystemPrompt } = require('./lib/mud1-rag');
const { getProjectRAGPackage } = require('./lib/project-rag-store');
const { maxConfidence, mergeRagSources } = require('./lib/rag-utils');

function parsePipeSizeInches(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (/^\d+\/\d+$/.test(s)) {
    const parts = s.split('/');
    const num = Number(parts[0]);
    const den = Number(parts[1]);
    if (den > 0) return num / den;
    return null;
  }
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseQuickEstimateIntent(userText) {
  const text = String(userText || '').trim();
  if (!/^estimate\b/i.test(text)) return null;
  const m = text.match(/estimate\s+(\d+(?:\.\d+)?)\s*(?:lf|feet|foot|ft)?(?:\s+of)?\s+(\d+(?:\/\d+)?(?:\.\d+)?)\s*(?:"|in(?:ch)?|in)?\s*([a-z]+)?\s*(?:pipe)?/i);
  if (!m) return null;
  const quantity = Number(m[1]);
  const sizeRaw = String(m[2] || '').trim();
  const pipeType = String(m[3] || 'sewer').toLowerCase();
  const sizeInches = parsePipeSizeInches(sizeRaw);
  if (!Number.isFinite(quantity) || quantity <= 0 || !sizeInches) return null;
  return { quantity, sizeRaw, sizeInches, pipeType };
}

function buildQuickEstimateResponse(intent) {
  const qty = intent.quantity;
  const sizeIn = intent.sizeInches;
  const pipeType = intent.pipeType;
  const sizeLabel = intent.sizeRaw;

  const knownPipe = { 4: 8.5, 6: 12, 8: 18 };
  let unitRate = knownPipe[4];
  if (pipeType === 'gas' && sizeIn <= 1.25) unitRate = 4.75;
  else if (knownPipe[Math.round(sizeIn)]) unitRate = knownPipe[Math.round(sizeIn)];
  else if (sizeIn < 4) unitRate = 7.25;
  else if (sizeIn < 6) unitRate = 10.25;
  else if (sizeIn < 8) unitRate = 14.5;
  else unitRate = 18 + ((sizeIn - 8) * 2.1);

  const productionByType = { sewer: 120, water: 160, storm: 140, gas: 220, electrical: 200 };
  const lfPerDay = productionByType[pipeType] || 140;
  const laborDayCost = 3200;
  const equipmentDayCost = 900;
  const days = Math.max(1, Math.ceil(qty / lfPerDay));
  const material = qty * unitRate * 1.1;
  const labor = days * laborDayCost;
  const equipment = days * equipmentDayCost;
  const subtotal = material + labor + equipment;
  const markup = subtotal * 0.15;
  const total = subtotal + markup;
  const toMoney = (v) => '$' + Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return [
    `Estimate for ${qty.toLocaleString()} LF of ${sizeLabel}" ${pipeType} pipe:`,
    `- Materials (pipe + fittings + 10% waste): ${toMoney(material)}`,
    `- Labor (${days} day${days === 1 ? '' : 's'} crew): ${toMoney(labor)}`,
    `- Equipment (${days} day${days === 1 ? '' : 's'}): ${toMoney(equipment)}`,
    `- Subtotal: ${toMoney(subtotal)}`,
    `- Markup (15%): ${toMoney(markup)}`,
    `- Total budget: ${toMoney(total)}`,
    '',
    'Assumptions: open-cut install, normal access, no dewatering, no rock, no traffic control, no permit/surface restoration adders. Share trench depth and site constraints for a tighter estimate.'
  ].join('\n');
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed', response: null });
  }

  try {
    const { messages, project_id } = req.body || {};
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array required', response: null });
    }

    const user = await getUserFromRequest(req);
    // No auth: allow desktop/app use without sign-in (usage not tracked)

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: 'OPENAI_API_KEY not configured',
        response: null,
      });
    }

    const openai = new OpenAI({ apiKey });
    const chatMessages = messages.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content || ''),
    }));

    const lastUserMsg = [...chatMessages].reverse().find((m) => m && m.role === 'user');
    const quickEstimate = parseQuickEstimateIntent(lastUserMsg && lastUserMsg.content);
    if (quickEstimate) {
      return res.status(200).json({
        response: buildQuickEstimateResponse(quickEstimate),
        tools_used: ['estimate_project_cost'],
      });
    }

    // True RAG: retrieve relevant context → inject into LLM
    const lastUser = chatMessages.filter((m) => m.role === 'user').pop();
    const userText = lastUser ? String(lastUser.content || '').trim() : '';
    const ragPkg = getRAGPackageForUser(userText, 5);
    const kbContext = (ragPkg && ragPkg.context) ? ragPkg.context : getRAGContextForUser(userText);
    let projectRag = null;
    if (user && project_id) {
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

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'system', content: systemPrompt }, ...chatMessages],
      max_tokens: 512,
      temperature: 0.5,
    });

    const text = completion.choices?.[0]?.message?.content || 'What can I help with?';
    if (user) {
      const usage = completion.usage || {};
      const usageKind = classifyUsageKind({ model: 'mud1', usingOwnKey: false, source: detectSource(req), requestType: 'chat' });
      await logUsageEvent(user.id, {
        model: 'mud1',
        inputTokens: usage.prompt_tokens || 0,
        outputTokens: usage.completion_tokens || 0,
        source: detectSource(req),
        requestType: 'chat',
        usageKind,
      });
    }
    return res.status(200).json({
      response: text.trim(),
      tools_used: [],
      rag: {
        confidence: maxConfidence(
          (projectRag && projectRag.confidence) || 'low',
          (ragPkg && ragPkg.confidence) || 'low'
        ),
        fallback_used: ((projectRag && projectRag.fallback_used) !== false) && !!(ragPkg && ragPkg.fallback_used),
        sources: mergeRagSources(
          (projectRag && projectRag.sources) || [],
          (ragPkg && Array.isArray(ragPkg.sources)) ? ragPkg.sources : []
        ),
      },
    });
  } catch (err) {
    console.error('mud1-fallback error:', err);
    const msg = err?.message || String(err);
    return res.status(500).json({
      error: msg,
      response: "Something went wrong. Try again or ask something construction-specific.",
    });
  }
};
