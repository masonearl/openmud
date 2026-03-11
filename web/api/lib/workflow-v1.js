const OpenAI = require('openai');

const PROPOSAL_WORKFLOW_INTENT = /\b(generate|create|make|build|write|draft)\b.*\b(proposal|quote|scope of work|bid document|pricing)\b|\b(proposal|quote|scope of work|bid document)\b.*\b(generate|create|make|build|write|draft)\b/i;
const SCHEDULE_WORKFLOW_INTENT = /\b(generate|create|make|build|draft)\b.*\b(schedule|timeline|sequencing|phasing)\b|\b(schedule|timeline|sequencing|phasing)\b.*\b(generate|create|make|build|draft)\b/i;

function isProposalWorkflowIntent(text) {
  return PROPOSAL_WORKFLOW_INTENT.test(String(text || ''));
}

function isScheduleWorkflowIntent(text) {
  return SCHEDULE_WORKFLOW_INTENT.test(String(text || ''));
}

function clampText(value, maxLen = 4000) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;
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
    'assumptions',
    'exclusions',
    'budget',
    'estimated_total',
    'estimate_total',
  ].forEach((key) => {
    const value = data[key];
    if (value == null) return;
    if (typeof value === 'string' && !value.trim()) return;
    picked[key] = value;
  });

  if (Array.isArray(data.bid_items)) {
    picked.bid_items = data.bid_items.slice(0, 24).map((item) => ({
      description: String(item?.description || item?.name || '').trim(),
      quantity: item?.quantity ?? null,
      unit: item?.unit ?? null,
      unit_price: item?.unit_price ?? item?.unitPrice ?? null,
      amount: item?.amount ?? item?.total ?? null,
    }));
  }

  if (Array.isArray(data.tasks)) {
    picked.tasks = data.tasks.slice(0, 12).map((task) => ({
      title: String(task?.title || '').trim(),
      notes: clampText(task?.notes || '', 240),
      status: task?.status || '',
      due_at: task?.due_at || null,
    }));
  }

  return picked;
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
      const quantity = item?.quantity == null ? null : Number(item.quantity);
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

function normalizeProposalParams(parsed, defaults = {}) {
  const bidItems = normalizeBidItems(parsed?.bid_items || defaults.bid_items);
  const totalFromItems = bidItems.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const totalCandidate = Number(parsed?.total);
  const total = Number.isFinite(totalCandidate) && totalCandidate > 0
    ? totalCandidate
    : (totalFromItems > 0 ? totalFromItems : Number(defaults.total) || 0);
  const durationCandidate = Number(parsed?.duration);
  return {
    client: String(parsed?.client || defaults.client || defaults.project_name || 'Project').trim() || 'Project',
    scope: String(parsed?.scope || defaults.scope || defaults.scope_summary || defaults.description || 'Scope of work to be finalized from project documents.').trim(),
    total,
    duration: Number.isFinite(durationCandidate) && durationCandidate > 0 ? Math.round(durationCandidate) : (Number(defaults.duration_days) || null),
    bid_items: bidItems,
    assumptions: String(parsed?.assumptions || defaults.assumptions || '').trim(),
    exclusions: String(parsed?.exclusions || defaults.exclusions || '').trim(),
  };
}

function normalizeScheduleParams(parsed, defaults = {}) {
  const phases = Array.isArray(parsed?.phases) && parsed.phases.length > 0
    ? parsed.phases.map((phase) => String(phase || '').trim()).filter(Boolean).slice(0, 12)
    : ['Mobilization', 'Layout and utility locate', 'Excavation and trenching', 'Pipe install', 'Backfill and compaction', 'Testing and restoration'];
  const durationCandidate = Number(parsed?.duration_days ?? parsed?.duration);
  const today = new Date().toISOString().slice(0, 10);
  return {
    project_name: String(parsed?.project_name || defaults.project_name || 'Project').trim() || 'Project',
    start_date: String(parsed?.start_date || defaults.start_date || today).slice(0, 10),
    duration_days: Math.max(1, Math.min(365, Number.isFinite(durationCandidate) && durationCandidate > 0 ? Math.round(durationCandidate) : (Number(defaults.duration_days) || 14))),
    phases,
  };
}

function buildWorkflowPrompt({ workflow, userRequest, projectName, projectFacts, projectRagContext }) {
  const workflowLine = workflow === 'proposal'
    ? 'Generate a professional construction proposal draft from project context.'
    : 'Generate a professional construction schedule draft from project context.';

  const schema = workflow === 'proposal'
    ? '{"client":"string","scope":"string","total":0,"duration":14,"bid_items":[{"description":"string","quantity":1,"unit":"LS","unit_price":0,"amount":0}],"assumptions":"string","exclusions":"string"}'
    : '{"project_name":"string","start_date":"YYYY-MM-DD","duration_days":14,"phases":["Phase 1","Phase 2","Phase 3"]}';

  return [
    workflowLine,
    'You are extracting structured inputs for an openmud workflow.',
    'Prefer exact facts from project documents and project data.',
    'Do not invent pricing that is not supported by context.',
    'If pricing is missing for a proposal, keep total at 0 and still produce a clean scope-based draft.',
    'Return ONLY valid JSON matching this schema:',
    schema,
    '',
    `User request: ${clampText(userRequest, 1200)}`,
    `Project name: ${clampText(projectName, 200) || 'Unknown'}`,
    '',
    'Saved project data:',
    JSON.stringify(projectFacts || {}, null, 2),
    '',
    'Relevant project document context:',
    projectRagContext ? clampText(projectRagContext, 6000) : 'No indexed project document context available.',
  ].join('\n');
}

async function extractWorkflowDraft({ apiKey, workflow, userRequest, projectName, projectData, projectRagContext }) {
  const projectFacts = pickProjectFacts(projectData);
  const client = new OpenAI({ apiKey });
  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 900,
    temperature: 0.1,
    messages: [
      {
        role: 'system',
        content: buildWorkflowPrompt({
          workflow,
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
  if (!parsed) throw new Error(`Could not parse ${workflow} workflow extraction output.`);

  if (workflow === 'proposal') {
    return normalizeProposalParams(parsed, {
      ...projectFacts,
      project_name: projectName,
    });
  }
  return normalizeScheduleParams(parsed, {
    ...projectFacts,
    project_name: projectName,
  });
}

module.exports = {
  extractWorkflowDraft,
  isProposalWorkflowIntent,
  isScheduleWorkflowIntent,
  normalizeProposalParams,
  normalizeScheduleParams,
  pickProjectFacts,
};
