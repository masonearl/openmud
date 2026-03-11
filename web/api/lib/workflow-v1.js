const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const {
  pickProjectFacts,
  normalizeProjectFacts,
  extractProjectFacts,
} = require('./document-extraction');

const PROPOSAL_WORKFLOW_INTENT = /\b(generate|create|make|build|write|draft)\b.*\b(proposal|quote|scope of work|bid document|pricing)\b|\b(proposal|quote|scope of work|bid document)\b.*\b(generate|create|make|build|write|draft)\b/i;
const SCHEDULE_WORKFLOW_INTENT = /\b(generate|create|make|build|draft)\b.*\b(schedule|timeline|sequencing|phasing)\b|\b(schedule|timeline|sequencing|phasing)\b.*\b(generate|create|make|build|draft)\b/i;
const CHANGE_ORDER_WORKFLOW_INTENT = /\b(generate|create|make|build|write|draft)\b.*\b(change order|co\b|extra work|change directive)\b|\b(change order|co\b|extra work|change directive)\b.*\b(generate|create|make|build|write|draft)\b/i;
const PROJECT_FACTS_WORKFLOW_INTENT = /\b(extract|pull|summarize|capture|save|analyze|index)\b.*\b(project facts|job facts|project data|scope summary|project summary|document facts|bid facts)\b|\b(project facts|job facts|project data|scope summary|document facts|bid facts)\b.*\b(extract|pull|summarize|capture|save|analyze|index)\b/i;
const BUILDER_PLAN_WORKFLOW_INTENT = /\b(agentic builder|builder approach|builder plan|implementation plan|execution plan|ship plan|delivery plan|build plan|roadmap)\b|\b(plan|map|scope|break down|sequence)\b.*\b(builder|implementation|workflow|feature|project)\b/i;
const BUILDER_VALIDATE_WORKFLOW_INTENT = /\b(builder[_\s-]?validate|validation plan|validate|verify|test|smoke test|ship check|release check|qa plan|go[-\s]?live check)\b.*\b(builder|workflow|feature|release|ship|change|project)\b|\b(builder|workflow|feature|release|ship|change|project)\b.*\b(validate|verify|test|smoke test|qa|check)\b/i;
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

function readRepoGuidance(relativePath) {
  try {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8').trim();
  } catch (e) {
    return '';
  }
}

const BUILDER_GUIDANCE_CONTEXT = [
  readRepoGuidance('buildplan.md'),
  readRepoGuidance('docs/ROADMAP.md'),
].filter(Boolean).join('\n\n---\n\n');

function isProposalWorkflowIntent(text) {
  return PROPOSAL_WORKFLOW_INTENT.test(String(text || ''));
}

function isScheduleWorkflowIntent(text) {
  return SCHEDULE_WORKFLOW_INTENT.test(String(text || ''));
}

function isChangeOrderWorkflowIntent(text) {
  return CHANGE_ORDER_WORKFLOW_INTENT.test(String(text || ''));
}

function isProjectFactsWorkflowIntent(text) {
  return PROJECT_FACTS_WORKFLOW_INTENT.test(String(text || ''));
}

function isBuilderPlanWorkflowIntent(text) {
  return BUILDER_PLAN_WORKFLOW_INTENT.test(String(text || ''));
}

function isBuilderValidateWorkflowIntent(text) {
  return BUILDER_VALIDATE_WORKFLOW_INTENT.test(String(text || ''));
}

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
        return String(item.description || item.title || item.name || item.risk || item.task || '').trim();
      }
      return '';
    })
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeLooseStringList(items, maxItems = 8) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object') {
        return String(
          item.path
          || item.file
          || item.title
          || item.step
          || item.test
          || item.risk
          || item.description
          || item.name
          || ''
        ).trim();
      }
      return '';
    })
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeProposalParams(parsed, defaults = {}) {
  const facts = normalizeProjectFacts(parsed, defaults);
  const totalCandidate = Number(parsed?.total);
  const total = Number.isFinite(totalCandidate) && totalCandidate > 0
    ? totalCandidate
    : (Number(facts.estimated_total) || 0);
  const durationCandidate = Number(parsed?.duration);
  return {
    client: String(parsed?.client || facts.client || defaults.project_name || 'Project').trim() || 'Project',
    scope: String(parsed?.scope || facts.scope_summary || defaults.description || 'Scope of work to be finalized from project documents.').trim(),
    total,
    duration: Number.isFinite(durationCandidate) && durationCandidate > 0 ? Math.round(durationCandidate) : (facts.duration_days || null),
    bid_items: facts.bid_items,
    executive_summary: facts.executive_summary,
    technical_approach: facts.technical_approach,
    major_milestones: facts.major_milestones,
    logistics_plan: facts.logistics_plan,
    project_risks: facts.project_risks,
    assumptions: facts.assumptions,
    exclusions: facts.exclusions,
  };
}

function normalizeScheduleParams(parsed, defaults = {}) {
  const facts = normalizeProjectFacts(parsed, defaults);
  const phases = Array.isArray(parsed?.phases) && parsed.phases.length > 0
    ? parsed.phases.map((phase) => String(phase || '').trim()).filter(Boolean).slice(0, 12)
    : (facts.major_milestones.length > 0
      ? facts.major_milestones
      : ['Mobilization', 'Layout and utility locate', 'Excavation and trenching', 'Pipe install', 'Backfill and compaction', 'Testing and restoration']);
  const durationCandidate = Number(parsed?.duration_days ?? parsed?.duration);
  const today = new Date().toISOString().slice(0, 10);
  return {
    project_name: String(parsed?.project_name || facts.project_name || defaults.project_name || 'Project').trim() || 'Project',
    start_date: normalizeIsoDate(parsed?.start_date || facts.start_date || defaults.start_date || today, today),
    duration_days: Math.max(1, Math.min(365, Number.isFinite(durationCandidate) && durationCandidate > 0 ? Math.round(durationCandidate) : (facts.duration_days || Number(defaults.duration_days) || 14))),
    phases,
  };
}

function normalizeChangeOrderParams(parsed, defaults = {}) {
  const facts = normalizeProjectFacts(parsed, defaults);
  const lineItems = normalizeBidItems(parsed?.line_items || parsed?.bid_items || defaults.line_items || defaults.bid_items);
  const totalFromItems = lineItems.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const amountCandidate = Number(parsed?.amount ?? parsed?.total);
  const amount = Number.isFinite(amountCandidate) && amountCandidate > 0
    ? amountCandidate
    : (totalFromItems > 0 ? totalFromItems : 0);
  const durationCandidate = Number(parsed?.duration_days ?? parsed?.schedule_impact_days ?? parsed?.duration);
  return {
    project_name: String(parsed?.project_name || facts.project_name || defaults.project_name || 'Project').trim() || 'Project',
    client: String(parsed?.client || facts.client || defaults.client || 'Project').trim() || 'Project',
    co_number: String(parsed?.co_number || parsed?.change_order_number || defaults.co_number || '').trim(),
    title: String(parsed?.title || parsed?.change_title || defaults.title || 'Change Order').trim() || 'Change Order',
    change_reason: String(parsed?.change_reason || parsed?.reason || defaults.change_reason || '').trim(),
    scope: String(parsed?.scope || parsed?.scope_of_change || facts.scope_summary || defaults.scope || 'Scope of change to be confirmed from project documents.').trim(),
    line_items: lineItems,
    amount,
    duration_days: Number.isFinite(durationCandidate) && durationCandidate > 0 ? Math.round(durationCandidate) : null,
    schedule_impact: String(parsed?.schedule_impact || defaults.schedule_impact || '').trim(),
    assumptions: String(parsed?.assumptions || facts.assumptions || defaults.assumptions || '').trim(),
    exclusions: String(parsed?.exclusions || facts.exclusions || defaults.exclusions || '').trim(),
  };
}

function normalizeBuilderPlan(parsed, defaults = {}) {
  const goal = String(parsed?.goal || defaults.goal || '').trim() || 'Ship the next high-value openmud workflow.';
  const summary = String(parsed?.summary || parsed?.why || defaults.summary || '').trim();
  const touchedFiles = normalizeLooseStringList(parsed?.touched_files || parsed?.files || defaults.touched_files, 12);
  const implementationSteps = normalizeLooseStringList(parsed?.implementation_steps || parsed?.steps || defaults.implementation_steps, 10);
  const tests = normalizeLooseStringList(parsed?.tests || parsed?.validation_steps || defaults.tests, 8);
  const risks = normalizeLooseStringList(parsed?.risks || defaults.risks, 8);
  const nextAction = String(parsed?.next_action || parsed?.first_action || defaults.next_action || '').trim();

  return {
    goal,
    summary,
    touched_files: touchedFiles,
    implementation_steps: implementationSteps,
    tests,
    risks,
    next_action: nextAction,
  };
}

function normalizeBuilderValidate(parsed, defaults = {}) {
  const goal = String(parsed?.goal || defaults.goal || '').trim() || 'Validate the current openmud shipping slice.';
  const summary = String(parsed?.summary || parsed?.why || defaults.summary || '').trim();
  const commands = normalizeLooseStringList(parsed?.commands || parsed?.validation_commands || defaults.commands, 10);
  const checks = normalizeLooseStringList(parsed?.checks || parsed?.manual_checks || defaults.checks, 10);
  const blockers = normalizeLooseStringList(parsed?.blockers || parsed?.risks || defaults.blockers, 8);
  const decisionRaw = String(parsed?.ship_decision || parsed?.decision || defaults.ship_decision || '').trim().toLowerCase();
  const shipDecision = ['ready', 'needs_work', 'blocked'].includes(decisionRaw) ? decisionRaw : 'needs_work';
  const nextAction = String(parsed?.next_action || parsed?.first_action || defaults.next_action || '').trim();

  return {
    goal,
    summary,
    commands,
    checks,
    blockers,
    ship_decision: shipDecision,
    next_action: nextAction,
  };
}

function getWorkflowPromptConfig(workflow) {
  if (workflow === 'proposal') {
    return {
      workflowLine: 'Generate a professional construction proposal draft from project context.',
      schema: '{"client":"string","executive_summary":"string","scope":"string","technical_approach":"string","major_milestones":["string"],"total":0,"duration":14,"bid_items":[{"description":"string","quantity":1,"unit":"LS","unit_price":0,"amount":0}],"logistics_plan":"string","project_risks":["string"],"assumptions":"string","exclusions":"string"}',
      guidance: 'Only include executive_summary, technical_approach, major_milestones, logistics_plan, and project_risks when they are clearly supported by the project documents or saved project data. If pricing is missing, keep total at 0 and still produce a clean scope-based draft.',
    };
  }
  if (workflow === 'change_order') {
    return {
      workflowLine: 'Generate a professional construction change order draft from project context.',
      schema: '{"project_name":"string","client":"string","co_number":"string","title":"string","change_reason":"string","scope":"string","line_items":[{"description":"string","quantity":1,"unit":"EA","unit_price":0,"amount":0}],"amount":0,"duration_days":0,"schedule_impact":"string","assumptions":"string","exclusions":"string"}',
      guidance: 'Focus on changed scope, why it changed, pricing, and schedule impact. Do not invent amounts unsupported by context. Use 0 when pricing is not available.',
    };
  }
  if (workflow === 'builder_plan') {
    return {
      workflowLine: 'Generate a focused internal builder plan for shipping the next openmud capability.',
      schema: '{"goal":"string","summary":"string","touched_files":["path/to/file"],"implementation_steps":["string"],"tests":["string"],"risks":["string"],"next_action":"string"}',
      guidance: 'Keep the plan incremental and repo-specific. Favor workflow completion, shared structured data, deterministic builders, and tests over generic refactors.',
    };
  }
  if (workflow === 'builder_validate') {
    return {
      workflowLine: 'Generate a focused internal validation plan for deciding whether an openmud change is ready to ship.',
      schema: '{"goal":"string","summary":"string","commands":["string"],"checks":["string"],"blockers":["string"],"ship_decision":"ready|needs_work|blocked","next_action":"string"}',
      guidance: 'Recommend concrete automated commands first, then targeted manual checks. Call out blockers clearly and keep the ship decision conservative.',
    };
  }
  return {
    workflowLine: 'Generate a professional construction schedule draft from project context.',
    schema: '{"project_name":"string","start_date":"YYYY-MM-DD","duration_days":14,"phases":["Phase 1","Phase 2","Phase 3"]}',
    guidance: 'Keep the schedule baseline realistic and concise.',
  };
}

function buildWorkflowPrompt({ workflow, userRequest, projectName, projectFacts, projectRagContext }) {
  const config = getWorkflowPromptConfig(workflow);
  if (workflow === 'builder_plan' || workflow === 'builder_validate') {
    return [
      config.workflowLine,
      'You are planning product implementation work for the openmud codebase.',
      'Use the repository guidance below to keep the plan aligned with product direction.',
      'Prefer small vertical slices that ship real workflow value.',
      config.guidance,
      'Return ONLY valid JSON matching this schema:',
      config.schema,
      '',
      'Repository guidance:',
      clampText(BUILDER_GUIDANCE_CONTEXT, 9000) || 'No repository guidance available.',
      '',
      `User request: ${clampText(userRequest, 1600)}`,
    ].join('\n');
  }
  return [
    config.workflowLine,
    'You are extracting structured inputs for an openmud workflow.',
    'Prefer exact facts from project documents and project data.',
    'Do not invent pricing, quantities, or dates that are not supported by context.',
    config.guidance,
    'Return ONLY valid JSON matching this schema:',
    config.schema,
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
  if (workflow === 'project_facts') {
    return extractProjectFacts({ apiKey, userRequest, projectName, projectData, projectRagContext });
  }
  const projectFacts = pickProjectFacts(projectData);
  const client = new OpenAI({ apiKey });
  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: workflow === 'project_facts' ? 1200 : ((workflow === 'builder_plan' || workflow === 'builder_validate') ? 1100 : 900),
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

  const defaults = {
    ...projectFacts,
    project_name: projectName,
  };
  if (workflow === 'project_facts') return normalizeProjectFacts(parsed, defaults);
  if (workflow === 'proposal') return normalizeProposalParams(parsed, defaults);
  if (workflow === 'change_order') return normalizeChangeOrderParams(parsed, defaults);
  if (workflow === 'builder_plan') return normalizeBuilderPlan(parsed, defaults);
  if (workflow === 'builder_validate') return normalizeBuilderValidate(parsed, defaults);
  return normalizeScheduleParams(parsed, defaults);
}

module.exports = {
  extractWorkflowDraft,
  isProposalWorkflowIntent,
  isScheduleWorkflowIntent,
  isChangeOrderWorkflowIntent,
  isProjectFactsWorkflowIntent,
  isBuilderPlanWorkflowIntent,
  isBuilderValidateWorkflowIntent,
  normalizeProjectFacts,
  normalizeProposalParams,
  normalizeScheduleParams,
  normalizeChangeOrderParams,
  normalizeBuilderPlan,
  normalizeBuilderValidate,
  pickProjectFacts,
};
