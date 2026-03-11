const OpenAI = require('openai');

const PROJECT_FACTS_SCHEMA = '{"project_name":"string","client":"string","owner":"string","address":"string","location":"string","scope_summary":"string","project_type":"string","utility_type":"string","start_date":"YYYY-MM-DD","duration_days":30,"quantity_summary":"string","quantities":["string"],"executive_summary":"string","technical_approach":"string","logistics_plan":"string","major_milestones":["string"],"project_risks":["string"],"bid_items":[{"description":"string","quantity":1,"unit":"LF","unit_price":0,"amount":0}],"estimated_total":0,"assumptions":"string","exclusions":"string","notes":"string","confidence":"high|medium|low","missing_fields":["string"],"evidence":["string"]}';

function clampText(value, maxLen = 4000) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;
}

function normalizeIsoDate(value, fallback = '') {
  const text = String(value || '').trim();
  if (!text) return fallback;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toISOString().slice(0, 10);
}

function buildConversationSummary(messages) {
  if (!Array.isArray(messages)) return '';
  return messages
    .slice(-8)
    .map((m) => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${clampText(m.content, 800)}`)
    .join('\n');
}

function extractJsonObject(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch (innerErr) {
      return null;
    }
  }
}

function normalizeBidItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      const description = String(item?.description || item?.name || '').trim();
      const quantity = item?.quantity == null ? (item?.qty == null ? null : Number(item.qty)) : Number(item.quantity);
      const unit = String(item?.unit || '').trim() || 'LS';
      const unitPrice = item?.unit_price == null ? (item?.unitPrice == null ? null : Number(item.unitPrice)) : Number(item.unit_price);
      let amount = item?.amount == null ? (item?.total == null ? null : Number(item.total)) : Number(item.amount);
      if ((!Number.isFinite(amount) || amount == null) && Number.isFinite(quantity) && Number.isFinite(unitPrice)) {
        amount = quantity * unitPrice;
      }
      return {
        description: description || 'Bid item',
        quantity: Number.isFinite(quantity) ? quantity : null,
        unit,
        unit_price: Number.isFinite(unitPrice) ? unitPrice : null,
        amount: Number.isFinite(amount) ? amount : null,
      };
    })
    .filter((item) => item.description);
}

function normalizeStringList(items, maxItems = 8) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object') {
        return String(item.description || item.title || item.name || item.risk || item.task || item.field || '').trim();
      }
      return '';
    })
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeEvidenceList(items, maxItems = 10) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      if (typeof item === 'string') return clampText(item, 240);
      if (item && typeof item === 'object') {
        return clampText(item.snippet || item.quote || item.text || item.description || item.title || '', 240);
      }
      return '';
    })
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeMissingFields(items, maxItems = 10) {
  return normalizeStringList(items, maxItems)
    .map((item) => item.toLowerCase())
    .filter(Boolean);
}

function normalizeConfidence(value, fallback = 'medium') {
  const text = String(value || '').trim().toLowerCase();
  return ['high', 'medium', 'low'].includes(text) ? text : fallback;
}

function pickProjectFacts(projectData) {
  const data = projectData && typeof projectData === 'object' ? projectData : {};
  const picked = {};
  [
    'client',
    'client_name',
    'owner',
    'project_name',
    'address',
    'location',
    'scope',
    'scope_summary',
    'description',
    'project_type',
    'utility_type',
    'start_date',
    'duration_days',
    'crew_size',
    'notes',
    'quantity_summary',
    'executive_summary',
    'technical_approach',
    'means_methods',
    'project_approach',
    'site_logistics',
    'logistics_plan',
    'site_constraints',
    'major_milestones',
    'milestones',
    'phases',
    'known_risks',
    'project_risks',
    'risks',
    'change_reason',
    'co_number',
    'schedule_impact',
    'assumptions',
    'exclusions',
    'budget',
    'estimated_total',
    'estimate_total',
    'project_facts_meta',
  ].forEach((key) => {
    const value = data[key];
    if (value == null) return;
    if (typeof value === 'string' && !value.trim()) return;
    picked[key] = value;
  });

  if (Array.isArray(data.quantities)) picked.quantities = data.quantities.slice(0, 12);
  if (Array.isArray(data.project_facts_evidence)) picked.project_facts_evidence = data.project_facts_evidence.slice(0, 10);

  if (Array.isArray(data.bid_items)) {
    picked.bid_items = data.bid_items.slice(0, 24).map((item) => ({
      description: String(item?.description || item?.name || '').trim(),
      quantity: item?.quantity ?? item?.qty ?? null,
      unit: item?.unit ?? null,
      unit_price: item?.unit_price ?? item?.unitPrice ?? null,
      amount: item?.amount ?? item?.total ?? null,
    }));
  }

  if (Array.isArray(data.line_items)) {
    picked.line_items = data.line_items.slice(0, 24).map((item) => ({
      description: String(item?.description || item?.name || '').trim(),
      quantity: item?.quantity ?? item?.qty ?? null,
      unit: item?.unit ?? null,
      unit_price: item?.unit_price ?? item?.unitPrice ?? null,
      amount: item?.amount ?? item?.total ?? null,
    }));
  }

  return picked;
}

function normalizeProjectFacts(parsed, defaults = {}) {
  const priorMeta = defaults.project_facts_meta && typeof defaults.project_facts_meta === 'object'
    ? defaults.project_facts_meta
    : {};
  const bidItems = normalizeBidItems(parsed?.bid_items || defaults.bid_items);
  const totalFromItems = bidItems.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const milestones = normalizeStringList(
    parsed?.major_milestones || parsed?.milestones || defaults.major_milestones || defaults.milestones || defaults.phases || defaults.tasks,
    10
  );
  const risks = normalizeStringList(
    parsed?.project_risks || parsed?.risks || defaults.project_risks || defaults.risks || defaults.known_risks,
    10
  );
  const quantities = normalizeStringList(parsed?.quantities || defaults.quantities, 12);
  const evidence = normalizeEvidenceList(parsed?.evidence || parsed?.source_spans || defaults.project_facts_evidence, 10);
  const missingFields = normalizeMissingFields(parsed?.missing_fields || priorMeta.missing_fields, 10);
  const totalCandidate = Number(parsed?.estimated_total ?? parsed?.estimate_total ?? parsed?.total);
  const estimatedTotal = Number.isFinite(totalCandidate) && totalCandidate > 0
    ? totalCandidate
    : (totalFromItems > 0 ? totalFromItems : (Number(defaults.estimated_total ?? defaults.estimate_total) || 0));
  const durationCandidate = Number(parsed?.duration_days ?? parsed?.duration);
  const confidenceFallback = evidence.length >= 3 ? 'high' : (evidence.length >= 1 ? 'medium' : 'low');
  const confidence = normalizeConfidence(parsed?.confidence || priorMeta.confidence, confidenceFallback);

  return {
    project_name: String(parsed?.project_name || defaults.project_name || '').trim(),
    client: String(parsed?.client || defaults.client || defaults.client_name || '').trim(),
    owner: String(parsed?.owner || defaults.owner || '').trim(),
    address: String(parsed?.address || defaults.address || '').trim(),
    location: String(parsed?.location || defaults.location || '').trim(),
    scope_summary: String(parsed?.scope_summary || parsed?.scope || defaults.scope_summary || defaults.scope || defaults.description || '').trim(),
    description: String(parsed?.description || defaults.description || '').trim(),
    project_type: String(parsed?.project_type || defaults.project_type || '').trim(),
    utility_type: String(parsed?.utility_type || defaults.utility_type || '').trim(),
    start_date: normalizeIsoDate(parsed?.start_date || defaults.start_date || '', ''),
    duration_days: Number.isFinite(durationCandidate) && durationCandidate > 0 ? Math.round(durationCandidate) : (Number(defaults.duration_days) || null),
    quantity_summary: String(parsed?.quantity_summary || defaults.quantity_summary || '').trim(),
    quantities,
    executive_summary: String(parsed?.executive_summary || defaults.executive_summary || '').trim(),
    technical_approach: String(parsed?.technical_approach || parsed?.means_methods || defaults.technical_approach || defaults.means_methods || defaults.project_approach || '').trim(),
    logistics_plan: String(parsed?.logistics_plan || parsed?.site_logistics || defaults.logistics_plan || defaults.site_logistics || defaults.site_constraints || '').trim(),
    major_milestones: milestones,
    project_risks: risks,
    bid_items: bidItems,
    estimated_total: estimatedTotal > 0 ? estimatedTotal : 0,
    assumptions: String(parsed?.assumptions || defaults.assumptions || '').trim(),
    exclusions: String(parsed?.exclusions || defaults.exclusions || '').trim(),
    notes: String(parsed?.notes || defaults.notes || '').trim(),
    project_facts_evidence: evidence,
    project_facts_meta: {
      confidence,
      missing_fields: missingFields,
      evidence_count: evidence.length,
    },
  };
}

function buildProjectFactsPrompt({ userRequest, projectName, projectFacts, projectRagContext }) {
  return [
    'Extract reusable project facts from project context and uploaded project documents.',
    'You are extracting structured project facts for openmud.',
    'Prefer exact facts from project documents and saved project data.',
    'Do not invent pricing, quantities, dates, or milestones that are not supported by context.',
    'Capture only facts directly supported by project documents or saved project data. Use empty strings, empty arrays, or 0 when a fact is not supported.',
    'Also return extraction quality metadata:',
    '- confidence: high, medium, or low',
    '- missing_fields: important facts that are still missing for downstream workflows',
    '- evidence: short quoted snippets or source-backed evidence lines from the document context',
    'Return ONLY valid JSON matching this schema:',
    PROJECT_FACTS_SCHEMA,
    '',
    `User request: ${clampText(userRequest, 1200)}`,
    `Project name: ${clampText(projectName, 200) || 'Unknown'}`,
    '',
    'Saved project data:',
    JSON.stringify(projectFacts || {}, null, 2),
    '',
    'Relevant project document context:',
    projectRagContext ? clampText(projectRagContext, 7000) : 'No indexed project document context available.',
  ].join('\n');
}

async function extractProjectFacts({ apiKey, userRequest, projectName, projectData, projectRagContext }) {
  const projectFacts = pickProjectFacts(projectData);
  const client = new OpenAI({ apiKey });
  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 1200,
    temperature: 0.1,
    messages: [
      {
        role: 'system',
        content: buildProjectFactsPrompt({
          userRequest,
          projectName,
          projectFacts,
          projectRagContext,
        }),
      },
      {
        role: 'user',
        content: buildConversationSummary([{ role: 'user', content: userRequest }]),
      },
    ],
  });

  const parsed = extractJsonObject(completion.choices?.[0]?.message?.content || '');
  if (!parsed) throw new Error('Could not parse project_facts workflow extraction output.');

  return normalizeProjectFacts(parsed, {
    ...projectFacts,
    project_name: projectName,
  });
}

module.exports = {
  PROJECT_FACTS_SCHEMA,
  pickProjectFacts,
  normalizeProjectFacts,
  extractProjectFacts,
};
