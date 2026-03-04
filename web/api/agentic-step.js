/**
 * POST /api/agentic-step
 *
 * One step of the agentic tool loop. The Electron desktop app sends the
 * current conversation state (messages + any tool results), this endpoint
 * calls Claude on the server side (key never leaves the server), checks
 * usage limits, and returns Claude's response.
 *
 * Request body:
 *   { messages: [...], tool_results: [...] }
 *   messages — array of { role, content } in Claude format
 *
 * Response:
 *   { stop_reason, text, tool_calls: [{ id, name, input }] }
 *   or { error, code } on failure
 */
const Anthropic = require('@anthropic-ai/sdk');
const { getUserFromRequest } = require('./lib/auth');
const { allocateUsage, logUsageEvent, detectSource } = require('./lib/usage');

const MODEL = 'claude-haiku-4-5';

const SYSTEM_PROMPT = `You are mud1, openmud's AI assistant for the construction industry.

You have tools available. Use them to complete the user's request. Call multiple tools in sequence when needed.

When the user asks to build a bid package: run estimate_project_cost, then build_schedule, then export_estimate_pdf or export_bid_pdf.
When asked to generate PM documents: use generate_pm_doc with the correct doc_type and fields.
When PM work needs tracking (RFI/submittal/daily reports/change orders/pay apps), use the workflow tools to create or update status.
When asked about emails: use search_mail.
When asked to export CSV/PDF: use export_estimate_csv / export_estimate_pdf / export_bid_pdf.
When asked to find work/bids: use find_work.
For desktop productivity requests: use add_to_calendar, add_reminder, quick_note, weather.
Do not use unavailable tools. Do not use destructive tools. If required info is missing, ask a concise follow-up question.

Be concise and actionable. Format currency with commas and 2 decimal places.`;

const AGENTIC_TOOLS = [
  {
    name: 'estimate_project_cost',
    description: 'Full project cost estimate with materials, labor, equipment, and markup. Returns detailed cost breakdown.',
    input_schema: {
      type: 'object',
      properties: {
        materials: {
          type: 'array',
          items: { type: 'object', properties: { type: { type: 'string' }, quantity: { type: 'number' }, size: { type: 'string' } } },
          description: 'List of {type, quantity, size}',
        },
        labor: {
          type: 'array',
          items: { type: 'object', properties: { type: { type: 'string' }, hours: { type: 'number' } } },
          description: 'List of {type, hours}',
        },
        equipment: {
          type: 'array',
          items: { type: 'object', properties: { type: { type: 'string' }, days: { type: 'number' } } },
          description: 'Optional list of {type, days}',
        },
        markup: { type: 'number', description: 'Markup as decimal, e.g. 0.15 for 15%' },
      },
      required: ['materials', 'labor'],
    },
  },
  {
    name: 'build_schedule',
    description: 'Build a construction schedule with phases and dates.',
    input_schema: {
      type: 'object',
      properties: {
        project_name: { type: 'string' },
        start_date: { type: 'string', description: 'ISO date YYYY-MM-DD' },
        duration_days: { type: 'number' },
        phases: { type: 'array', items: { type: 'string' }, description: 'Phase names' },
      },
      required: ['project_name', 'duration_days'],
    },
  },
  {
    name: 'search_mail',
    description: 'Search Mac Mail.app for emails. Returns sender, subject, date, read/flagged status.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'General keyword search' },
        sender: { type: 'string', description: 'Filter by sender name or email' },
        subject: { type: 'string', description: 'Filter by subject keywords' },
        since: { type: 'string', description: 'Relative date: today, week, month, or YYYY-MM-DD' },
        limit: { type: 'number', description: 'Max results (default 15)' },
        unread_only: { type: 'boolean', description: 'Only unread emails' },
      },
    },
  },
  {
    name: 'generate_pm_doc',
    description: 'Generate a construction PM document PDF (change order, daily report, RFI, pay application, submittal, punch list, lien waiver).',
    input_schema: {
      type: 'object',
      properties: {
        doc_type: {
          type: 'string',
          enum: ['change_order', 'daily_report', 'rfi', 'pay_application', 'submittal', 'punch_list', 'lien_waiver'],
          description: 'Type of PM document',
        },
        fields: { type: 'object', description: 'Document fields (project_name, date, items, scope, etc.)' },
      },
      required: ['doc_type', 'fields'],
    },
  },
  {
    name: 'manage_rfi_workflow',
    description: 'Create/update/list/get RFI workflow records with status and due dates.',
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['create', 'update', 'list', 'get', 'due'] },
        workflow_id: { type: 'string' },
        title: { type: 'string' },
        project_name: { type: 'string' },
        due_date: { type: 'string', description: 'ISO date YYYY-MM-DD' },
        status: { type: 'string', description: 'open, submitted, under_review, approved, closed, overdue' },
        fields: { type: 'object', description: 'RFI fields (question, spec_section, drawing_ref, response_date, etc.)' },
        limit: { type: 'number' },
      },
      required: ['action'],
    },
  },
  {
    name: 'manage_submittal_workflow',
    description: 'Create/update/list/get submittal workflow records with status and due dates.',
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['create', 'update', 'list', 'get', 'due'] },
        workflow_id: { type: 'string' },
        title: { type: 'string' },
        project_name: { type: 'string' },
        due_date: { type: 'string', description: 'ISO date YYYY-MM-DD' },
        status: { type: 'string', description: 'open, submitted, under_review, approved, rejected, closed' },
        fields: { type: 'object', description: 'Submittal fields (spec_section, manufacturer, documents, action_required, etc.)' },
        limit: { type: 'number' },
      },
      required: ['action'],
    },
  },
  {
    name: 'autofill_daily_report',
    description: 'Autofill and optionally persist a daily report workflow entry using weather and prior context.',
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['autofill', 'create', 'update', 'list', 'get', 'due'] },
        workflow_id: { type: 'string' },
        project_name: { type: 'string' },
        due_date: { type: 'string', description: 'ISO date YYYY-MM-DD' },
        status: { type: 'string' },
        save_workflow: { type: 'boolean', description: 'Persist as workflow item (default true)' },
        fields: { type: 'object', description: 'Daily report fields (date, weather, crew_size, work_performed, equipment, location, notes)' },
        limit: { type: 'number' },
      },
      required: ['action'],
    },
  },
  {
    name: 'manage_change_order_workflow',
    description: 'Create/update/list/get change order workflow records and status.',
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['create', 'update', 'list', 'get', 'due'] },
        workflow_id: { type: 'string' },
        title: { type: 'string' },
        project_name: { type: 'string' },
        due_date: { type: 'string', description: 'ISO date YYYY-MM-DD' },
        status: { type: 'string', description: 'open, submitted, under_review, approved, rejected, closed' },
        fields: { type: 'object', description: 'Change order fields (scope, reason, amount, co_number, date, line items, etc.)' },
        limit: { type: 'number' },
      },
      required: ['action'],
    },
  },
  {
    name: 'manage_pay_app_workflow',
    description: 'Create/update/list/get pay application workflow records and status.',
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['create', 'update', 'list', 'get', 'due'] },
        workflow_id: { type: 'string' },
        title: { type: 'string' },
        project_name: { type: 'string' },
        due_date: { type: 'string', description: 'ISO date YYYY-MM-DD' },
        status: { type: 'string', description: 'open, submitted, under_review, approved, rejected, closed' },
        fields: { type: 'object', description: 'Pay app fields (contract_amount, work_completed, retainage_rate, previous_payments, line_items, etc.)' },
        limit: { type: 'number' },
      },
      required: ['action'],
    },
  },
  {
    name: 'export_estimate_csv',
    description: 'Export the current estimate to a CSV file.',
    input_schema: {
      type: 'object',
      properties: {
        project_name: { type: 'string', description: 'Optional project name used in filename/output' },
      },
    },
  },
  {
    name: 'export_estimate_pdf',
    description: 'Export the current estimate to a PDF file.',
    input_schema: {
      type: 'object',
      properties: {
        project_name: { type: 'string', description: 'Optional project name used in filename/output' },
      },
    },
  },
  {
    name: 'export_bid_pdf',
    description: 'Export the current estimate to a bid-style PDF with line items.',
    input_schema: {
      type: 'object',
      properties: {
        project_name: { type: 'string', description: 'Optional project name used in filename/output' },
      },
    },
  },
  {
    name: 'find_work',
    description: 'Find active bid opportunities from email and public bid sources.',
    input_schema: {
      type: 'object',
      properties: {
        trade: { type: 'string', description: 'Trade/category such as sewer, waterline, civil, gas, utility' },
        location: { type: 'string', description: 'Optional city/state filter' },
      },
    },
  },
  {
    name: 'add_to_calendar',
    description: 'Add an event to the user calendar from natural language text.',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Event details, date, and time in plain text' },
      },
      required: ['text'],
    },
  },
  {
    name: 'add_reminder',
    description: 'Create a reminder from natural language text.',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Reminder details and due time in plain text' },
      },
      required: ['text'],
    },
  },
  {
    name: 'quick_note',
    description: 'Save a quick note in the user notes app.',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Note content to save' },
      },
      required: ['text'],
    },
  },
  {
    name: 'weather',
    description: 'Get current weather for a location.',
    input_schema: {
      type: 'object',
      properties: {
        location: { type: 'string', description: 'City/state or location name' },
      },
      required: ['location'],
    },
  },
];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Authenticate user
  const user = await getUserFromRequest(req);
  if (!user) {
    res.status(401).json({ error: 'Unauthorized', code: 'auth_required' });
    return;
  }

  // Check usage limits (same gates as regular chat)
  const usage = await allocateUsage(user.id, user.email);
  if (!usage.allowed) {
    res.status(429).json({
      error: `Daily limit reached (${usage.used}/${usage.limit} messages). Sign in at openmud.ai/settings for access.`,
      code: 'rate_limited',
      used: usage.used,
      limit: usage.limit,
    });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: 'Agentic AI is not configured on the server.', code: 'no_api_key' });
    return;
  }

  let body;
  try {
    body = req.body || {};
  } catch (_) {
    res.status(400).json({ error: 'Invalid request body' });
    return;
  }

  const messages = body.messages || [];
  if (!messages.length) {
    res.status(400).json({ error: 'messages array is required' });
    return;
  }

  const ant = new Anthropic({ apiKey });

  try {
    const response = await ant.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      tools: AGENTIC_TOOLS,
      messages,
    });

    // Log usage
    logUsageEvent(user.id, {
      model: MODEL,
      inputTokens: response.usage?.input_tokens || 0,
      outputTokens: response.usage?.output_tokens || 0,
      source: detectSource(req),
      requestType: 'agentic_step',
    });

    // Parse response into text + tool_calls
    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
    const tool_calls = response.content
      .filter(b => b.type === 'tool_use')
      .map(b => ({ id: b.id, name: b.name, input: b.input }));

    res.status(200).json({
      stop_reason: response.stop_reason,
      text,
      tool_calls,
      content: response.content, // full blocks for desktop to reconstruct Claude message
      usage: { input: response.usage?.input_tokens, output: response.usage?.output_tokens },
    });
  } catch (e) {
    console.error('[agentic-step] Anthropic error:', e.message);
    res.status(500).json({ error: e.message || 'AI step failed' });
  }
};
