const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const { execFile } = require('child_process');
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
const DEV_KEY = 'openmud';
const HOSTED_FREE_MODELS = new Set(['mud1', 'gpt-4o-mini']);

function getHeader(req, name) {
  const v = req && req.headers ? req.headers[name.toLowerCase()] : '';
  if (Array.isArray(v)) return String(v[0] || '').trim();
  return String(v || '').trim();
}

function isDevBypass(req) {
  const key = getHeader(req, 'x-openmud-dev-key').toLowerCase();
  return !!key && key === DEV_KEY;
}

function normalizeOpenClawBaseUrl(raw) {
  const base = String(raw || '').trim();
  if (!base) return '';
  const trimmed = base.replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/\/v\d+$/i.test(trimmed)) return trimmed;
  return `${trimmed}/v1`;
}

function sanitizeOpenClawModel(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  // Common misconfiguration: URL pasted into model field.
  if (/^https?:\/\//i.test(value)) return '';
  return value;
}

function openClawGatewayBaseUrl(baseURL) {
  const normalized = String(baseURL || '').trim().replace(/\/+$/, '');
  if (!normalized) return '';
  return normalized.replace(/\/v\d+$/i, '');
}

async function invokeOpenClawTool({ apiKey, baseURL, tool, action, args, sessionKey }) {
  const gatewayBase = openClawGatewayBaseUrl(baseURL);
  if (!gatewayBase) {
    return { ok: false, error: 'openmud relay URL is missing or invalid.' };
  }
  const endpoint = `${gatewayBase}/tools/invoke`;
  const payload = { tool, action, args: args || {} };
  if (sessionKey) payload.sessionKey = sessionKey;
  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });
    let data = null;
    try {
      data = await resp.json();
    } catch (e) {
      data = null;
    }
    if (!resp.ok) {
      const errMsg = data?.error?.message || data?.error || `HTTP ${resp.status}`;
      return { ok: false, status: resp.status, error: String(errMsg), data: data || {} };
    }
    return { ok: true, status: resp.status, data: data || {} };
  } catch (e) {
    return { ok: false, error: e.message || 'Failed to reach openmud relay.' };
  }
}

/**
 * Gateway response: { ok, result: { content: [{type:"text",text:"...json..."}], details: {...} } }
 * Parse nodes from wherever they appear in that structure.
 */
function extractNodesFromOpenClawResult(data) {
  try {
    // Primary: data.result.details.nodes (structured, no JSON.parse needed)
    if (Array.isArray(data?.result?.details?.nodes)) return data.result.details.nodes;

    // Secondary: data.result.content MCP text blocks
    const resultContent = data?.result?.content;
    if (Array.isArray(resultContent)) {
      const textBlock = resultContent.find(b => b && b.type === 'text' && b.text);
      if (textBlock) {
        const inner = JSON.parse(textBlock.text);
        if (Array.isArray(inner?.nodes)) return inner.nodes;
      }
    }

    // Fallbacks for alternate response shapes
    const content = data?.content;
    if (Array.isArray(content)) {
      const textBlock = content.find(b => b && b.type === 'text' && b.text);
      if (textBlock) {
        const inner = JSON.parse(textBlock.text);
        if (Array.isArray(inner?.nodes)) return inner.nodes;
      }
    }
    if (Array.isArray(data?.nodes)) return data.nodes;
    if (Array.isArray(data?.result?.nodes)) return data.result.nodes;
  } catch (e) { /* ignore */ }
  return [];
}

/**
 * Returns { hasMacNode, hasConnectedMac, iosOnlyNodes, allDisconnected, nodes }.
 * Used to give targeted guidance when osascript cannot run.
 *
 * OpenClaw status API: connected nodes omit the `connected` field entirely.
 * Only disconnected nodes have connected:false explicitly. Treat absent as connected.
 */
function analyzeOpenClawNodes(nodeCheckData) {
  const nodes = extractNodesFromOpenClawResult(nodeCheckData);
  const isConnected = (n) => n?.connected !== false; // absent = connected, false = disconnected
  const isMac = (n) => /mac|darwin|macos/i.test(String(n?.platform || ''));
  const hasMacNode = nodes.some(isMac);
  const connectedMac = nodes.filter(n => isMac(n) && isConnected(n));
  const iosNodes = nodes.filter(n => /^ios/i.test(String(n?.platform || '')));
  const iosOnlyNodes = iosNodes.length > 0 && !hasMacNode;
  const allDisconnected = nodes.length > 0 && nodes.every(n => !isConnected(n));
  return { hasMacNode, hasConnectedMac: connectedMac.length > 0, iosOnlyNodes, allDisconnected, nodes };
}

/**
 * Run a command on an OpenClaw node via the local CLI.
 * Works because OpenClaw is inherently a local-gateway integration.
 * Returns { ok, stdout, stderr, exitCode, error }.
 */
function runOpenClawNodeCommand(nodeId, command, args, timeoutMs = 30000) {
  const HOME = process.env.HOME || '';
  const OPENCLAW_PATHS = [
    '/opt/homebrew/bin/openclaw',
    '/usr/local/bin/openclaw',
    '/usr/bin/openclaw',
    `${HOME}/.npm-global/bin/openclaw`,
    `${HOME}/.local/bin/openclaw`,
    `${HOME}/.local/share/npm-global/bin/openclaw`,
    `${HOME}/.volta/bin/openclaw`,
    `${HOME}/.fnm/aliases/default/bin/openclaw`,
    `${HOME}/.local/share/pnpm/openclaw`,
  ].filter(Boolean);

  return new Promise((resolve) => {
    const paramsStr = JSON.stringify({ command: [command, ...args] });
    const cliArgs = [
      'nodes', 'invoke',
      '--node', nodeId,
      '--command', 'system.run',
      '--params', paramsStr,
      '--json',
      '--invoke-timeout', String(Math.min(timeoutMs, 60000)),
      '--timeout', String(Math.min(timeoutMs + 10000, 70000)),
    ];

    const invokeWithBin = (binPath) => {
      execFile(binPath, cliArgs, { timeout: timeoutMs + 8000, env: { ...process.env } }, (err, stdout, stderr) => {
        try {
          const data = JSON.parse((stdout || '').trim() || '{}');
          if (data.ok && data.payload) {
            return resolve({ ok: data.payload.success !== false && data.payload.exitCode === 0, stdout: data.payload.stdout || '', stderr: data.payload.stderr || '', exitCode: data.payload.exitCode });
          }
          return resolve({ ok: false, error: String(stderr || stdout || err?.message || 'unknown CLI error').slice(0, 400) });
        } catch (e) {
          return resolve({ ok: false, error: String(stderr || err?.message || 'CLI parse error').slice(0, 400) });
        }
      });
    };

    const tryBin = (binPaths, idx) => {
      if (idx >= binPaths.length) {
        // All static paths failed — try resolving via shell PATH as last resort
        execFile('/bin/sh', ['-c', 'which openclaw 2>/dev/null || command -v openclaw 2>/dev/null'], {}, (_err, out) => {
          const resolved = (out || '').trim();
          if (resolved) return invokeWithBin(resolved);
          return resolve({ ok: false, error: 'openmud-agent not found. Run the install command from Settings → openmud agent' });
        });
        return;
      }
      execFile(binPaths[idx], ['--version'], { timeout: 3000 }, (err) => {
        if (err && err.code === 'ENOENT') return tryBin(binPaths, idx + 1);
        invokeWithBin(binPaths[idx]);
      });
    };
    tryBin(OPENCLAW_PATHS, 0);
  });
}

function summarizeOpenClawFailure(result) {
  const status = result?.status;
  const error = String(result?.error || '').trim() || 'Unknown error';
  if (status === 401) return 'Authentication failed (401). OpenClaw token is invalid for this gateway.';
  if (status === 404) return 'Tool is unavailable (404). It is blocked by policy or not loaded.';
  if (status === 429) return 'Gateway auth is rate-limited (429). Wait and retry.';
  if (status === 400) return `Tool input rejected (400): ${error}`;
  if (status >= 500) return `Gateway/runtime error (${status}): ${error}`;
  if (/failed to fetch|network|econnrefused|timed out|timeout|enotfound|invalid url/i.test(error)) {
    return `Gateway unreachable: ${error}`;
  }
  return error;
}

function safeJson(value, maxLen = 420) {
  try {
    const s = JSON.stringify(value);
    if (!s) return '';
    return s.length > maxLen ? `${s.slice(0, maxLen)}...` : s;
  } catch (e) {
    return '';
  }
}

function buildDebugLine(label, result) {
  const status = (result && typeof result.status !== 'undefined') ? String(result.status) : 'n/a';
  const err = String(result?.error || '').trim() || 'none';
  const raw = result?.data?.error || result?.data?.result || result?.data || null;
  const rawStr = safeJson(raw);
  return `- ${label}: status=${status}; error=${err}${rawStr ? `; raw=${rawStr}` : ''}`;
}

function buildOpenClawEmailTroubleshootMessage({ linkCheck, nodeCheck, nodeDescribe, runProbe, sendAttempt, execAttempt, osascriptProbe, mailProbe, nodeAnalysis }) {
  const analysis = nodeAnalysis || (nodeCheck.ok ? analyzeOpenClawNodes(nodeCheck.data) : { nodes: [], iosOnlyNodes: false, allDisconnected: false, hasMacNode: false, hasConnectedMac: false });
  const lines = [
    'I could not send that email through OpenClaw yet.',
    '',
    'Diagnostics:',
    `- Link test (sessions_list): ${linkCheck.ok ? 'ok' : summarizeOpenClawFailure(linkCheck)}`,
    `- Node tool test (nodes status): ${nodeCheck.ok ? 'ok' : summarizeOpenClawFailure(nodeCheck)}`,
    `- Node describe: ${nodeDescribe && nodeDescribe.ok ? 'ok' : summarizeOpenClawFailure(nodeDescribe || {})}`,
    `- Node run probe (/usr/bin/true): ${runProbe && runProbe.ok ? 'ok' : summarizeOpenClawFailure(runProbe || {})}`,
    `- Send attempt (nodes run -> osascript): ${sendAttempt ? (sendAttempt.ok ? 'ok' : summarizeOpenClawFailure(sendAttempt)) : 'skipped'}`,
    `- Fallback attempt (exec -> osascript): ${execAttempt ? (execAttempt.ok ? 'ok' : summarizeOpenClawFailure(execAttempt)) : 'skipped'}`,
    `- Probe (nodes.run osascript return): ${osascriptProbe ? (osascriptProbe.ok ? 'ok' : summarizeOpenClawFailure(osascriptProbe)) : 'skipped'}`,
    `- Probe (nodes.run Mail accessibility): ${mailProbe ? (mailProbe.ok ? 'ok' : summarizeOpenClawFailure(mailProbe)) : 'skipped'}`,
    '',
    'How to fix:',
  ];

  if (!linkCheck.ok) {
    lines.push('- Verify your openmud relay URL and token in Settings → openmud agent.');
  } else if (!nodeCheck.ok) {
    lines.push('- openmud agent is connected but not responding.');
    lines.push('- Make sure openmud-agent is running on your Mac.');
  } else if (analysis.iosOnlyNodes) {
    lines.push('- Your only paired node is an iPhone (iOS). Email sending via osascript requires a Mac node.');
    lines.push('- Run the install command from Settings → openmud agent to connect your Mac.');
    lines.push('- Once a macOS node is paired and connected, retry the send.');
  } else if (analysis.allDisconnected) {
    lines.push('- Your Mac node is paired but not currently connected.');
    lines.push('- Restart openmud-agent on your Mac, then retry.');
  } else if (!analysis.hasMacNode) {
    lines.push('- No Mac agent detected. Run the install command from Settings → openmud agent.');
    lines.push('- Apple Mail and osascript only run on macOS.');
  } else if (osascriptProbe && !osascriptProbe.ok) {
    lines.push('- The Mac node cannot execute osascript. Check openmud-agent is running and has permissions.');
  } else if (mailProbe && !mailProbe.ok) {
    lines.push('- Apple Mail is not accessible from the OpenClaw node.');
    lines.push('- On that Mac: System Settings -> Privacy & Security -> Automation -> allow Terminal or node in Automation permissions.');
    lines.push('- Open Mail.app once and confirm an account is configured and can send.');
  } else {
    lines.push('- Ensure Apple Mail is configured on the target Mac and can send normally.');
    lines.push('- Ensure the node allows running osascript commands.');
  }

  if (analysis.nodes.length > 0) {
    lines.push('');
    lines.push('Mac agents connected:');
    analysis.nodes.forEach(n => {
      const status = n.connected ? 'connected' : 'not connected';
      lines.push(`- ${n.displayName || n.nodeId || 'unknown'} (${n.platform || 'unknown platform'}) — ${status}`);
    });
  }

  lines.push('');
  lines.push('Debug details:');
  lines.push(buildDebugLine('sessions_list', linkCheck));
  lines.push(buildDebugLine('nodes.status', nodeCheck));
  lines.push(buildDebugLine('nodes.describe', nodeDescribe || {}));
  lines.push(buildDebugLine('nodes.run(true)', runProbe || {}));
  lines.push(buildDebugLine('nodes.run(osascript send)', sendAttempt || {}));
  lines.push(buildDebugLine('exec(osascript)', execAttempt || {}));
  lines.push(buildDebugLine('nodes.run(osascript return)', osascriptProbe || {}));
  lines.push(buildDebugLine('nodes.run(mail accessibility)', mailProbe || {}));
  lines.push('Re-run: "verify openmud agent status" after fixing, then retry the send.');
  return lines.join('\n');
}

function shellQuoteSingle(value) {
  const s = String(value || '');
  if (!s) return "''";
  return `'${s.replace(/'/g, `'\"'\"'`)}'`;
}

function escapeAppleScriptText(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n/g, '\\n');
}

function buildMailAppleScript({ to, subject, body }) {
  const toEsc = escapeAppleScriptText(to);
  const subjectEsc = escapeAppleScriptText(subject || 'Quick note');
  const bodyEsc = escapeAppleScriptText(body || 'Hello');
  return `tell application "Mail"
set newMessage to make new outgoing message with properties {subject:"${subjectEsc}", content:"${bodyEsc}", visible:false}
tell newMessage
make new to recipient at end of to recipients with properties {address:"${toEsc}"}
send
end tell
end tell`;
}

function sendTextResponse(res, text, toolsUsed, streamEnabled) {
  if (streamEnabled) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    const payload = { content: String(text || '') };
    res.write('data: ' + JSON.stringify(payload) + '\n\n');
    res.write('data: [DONE]\n\n');
    res.end();
    return true;
  }
  res.status(200).json({ response: String(text || ''), tools_used: toolsUsed || [] });
  return true;
}

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

  'openclaw': `You are OpenClaw, an agentic assistant for openmud. You execute tasks—you do not just answer questions.
${MUDRAG_CAPABILITIES ? '\n' + MUDRAG_CAPABILITIES + '\n' : ''}
EXECUTION RULES (follow these strictly):
- Execute immediately. Do NOT ask for confirmation before acting. Do NOT ask multiple clarifying questions.
- If you can infer the intent, act on it with sensible defaults. Ask at most ONE question if truly critical info is missing.
- Calendar events: if you know who, when, and where—create it. Default duration 1 hour. Default reminder 15 min. Default calendar: first available or Work.
- Emails: if you know recipient and message—send it. Do not ask the user to approve content you can infer.
- For any agentic task (email, calendar, file, system action): state what you are doing in one line, then do it.
- Never say "I need approval" or "I need permission"—either execute or explain why it technically cannot run.

When users ask "what can you do": List email sending, calendar events, estimates, proposals, schedules, construction Q&A.

Tool triggers:
- Cost/estimate → estimate_project_cost, calculate_material_cost, calculate_labor_cost, calculate_equipment_cost
- Schedule/timeline → build_schedule. End with: [MUDRAG_SCHEDULE]{"project":"Name","duration":N,"start_date":"YYYY-MM-DD","phases":["Phase1",...]}[/MUDRAG_SCHEDULE]
- Proposal/scope → render_proposal_html. End with: [MUDRAG_PROPOSAL]{"client":"Name","scope":"...","total":N,"duration":N,"bid_items":[{"description":"Material","amount":N},...]}[/MUDRAG_PROPOSAL]
- Create project + email/info → End with: [MUDRAG_CREATE_PROJECT]{"name":"...","client":"...","scope":"...","total":null}[/MUDRAG_CREATE_PROJECT]

Be direct, concise, action-first.${OUTPUT_RULES}`,

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
const OPENCLAW_MODELS = {
  'openclaw': process.env.OPENCLAW_MODEL || 'openclaw',
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

/**
 * Quick detector: does this message contain an email send request?
 * Scans only the most relevant sentence to avoid picking up prior context.
 * Returns { to } if detected, null otherwise. Subject/body are resolved by model.
 */
function parseSendEmailIntent(userText) {
  const text = String(userText || '').trim();
  if (!text) return null;

  // Find the sentence/clause most likely to be the actual send command
  const clauses = text.split(/[\n.!?]+/).map(s => s.trim()).filter(Boolean);
  const relevant = [...clauses].reverse().find(s =>
    /\b(send|compose|write|draft)\b/i.test(s) && /\bemail\b/i.test(s)
  ) || clauses[clauses.length - 1] || text;

  if (!/\b(send|compose|write|draft)\b/i.test(relevant) || !/\bemail\b/i.test(relevant)) return null;

  const toMatch = relevant.match(/\bto\s+([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/i)
    || text.match(/\bto\s+([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/i);
  if (!toMatch) return null;
  const to = String(toMatch[1] || '').trim();
  if (!to) return null;

  // Extract body from the relevant clause only — never from the full text
  const bodyAfterSaying = relevant.match(/\b(?:saying|say|body)\s+["']?(.+?)["']?$/i);
  const bodyAfterColon = relevant.match(/:\s*(.+)$/);
  let body = '';
  if (bodyAfterSaying?.[1]) body = String(bodyAfterSaying[1]).trim();
  else if (bodyAfterColon?.[1]) body = String(bodyAfterColon[1]).trim();
  else body = '';

  // Subject from the relevant clause only
  const subjectMatch = relevant.match(/\b(?:subject|about|re:|regarding)\s+["']?([^"':\n]{1,60})["']?/i);
  let subject = subjectMatch ? String(subjectMatch[1]).trim() : '';
  if (!subject) subject = body && body.length <= 30 ? body : 'Quick note';

  return { to, subject, body: body || 'Hello', text: `Send email to ${to}: ${subject}`, needsModelRefinement: !bodyAfterSaying && !bodyAfterColon };
}

/**
 * Use the OpenClaw model to properly extract email intent from the user's request.
 * Returns { to, subject, body } or null on failure.
 */
async function resolveiMessageIntentViaModel(userText, apiKey, baseURL, modelName) {
  try {
    const client = new OpenAI({ apiKey, baseURL });
    const response = await client.chat.completions.create({
      model: modelName,
      messages: [
        {
          role: 'system',
          content: 'Extract the iMessage/text details the user wants to send. Return ONLY a JSON object:\n{"to":"recipient name, phone number, or email","message":"The message text to send"}\nIf message content is not specified, write a short friendly message matching the stated intent. Never include explanation outside the JSON.'
        },
        { role: 'user', content: userText }
      ],
      max_tokens: 200,
      temperature: 0.1,
    });
    const raw = String(response.choices?.[0]?.message?.content || '');
    const match = raw.match(/\{[\s\S]*?\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (parsed.to && parsed.message) return parsed;
    }
  } catch (e) { /* fall through */ }
  return null;
}

/**
 * Extract who the user wants to text back from a "reply/text back" request.
 * Returns { to: 'name or handle' } or null.
 */
async function resolveSmartReplyIntentViaModel(userText, apiKey, modelName) {
  try {
    const client = new OpenAI({ apiKey });
    const response = await client.chat.completions.create({
      model: modelName,
      messages: [
        {
          role: 'system',
          content: 'The user wants to reply to or text back someone. Extract the contact name. Return ONLY JSON: {"to":"contact name or number"}. Never include explanation outside the JSON.'
        },
        { role: 'user', content: userText }
      ],
      max_tokens: 60,
      temperature: 0.1,
    });
    const raw = String(response.choices?.[0]?.message?.content || '');
    const match = raw.match(/\{[\s\S]*?\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (parsed.to) return parsed;
    }
  } catch (e) { /* fall through */ }
  return null;
}

/**
 * Draft a reply message in the user's voice given a conversation thread.
 * userName: the user's name for context.
 * thread: array of { from, text } messages.
 * userRequest: any additional instruction (e.g. "keep it short and friendly").
 */
async function draftSmartReplyViaModel(thread, userName, userRequest, apiKey, modelName) {
  const threadStr = thread.map(m => `${m.from}: ${m.text}`).join('\n');
  try {
    const client = new OpenAI({ apiKey });
    const response = await client.chat.completions.create({
      model: modelName,
      messages: [
        {
          role: 'system',
          content: `You are drafting an iMessage reply on behalf of ${userName || 'the user'}. Write in a casual, natural texting style that matches how ${userName || 'the user'} would write. Keep it concise — this is a text message, not an email. Do not add pleasantries or sign-offs. Return ONLY the message text, nothing else.`
        },
        {
          role: 'user',
          content: `Here is the recent conversation:\n${threadStr}\n\nDraft a reply from me (${userName || 'me'})${userRequest ? '. Additional instruction: ' + userRequest : ''}. Reply only with the message text.`
        }
      ],
      max_tokens: 200,
      temperature: 0.7,
    });
    return (response.choices?.[0]?.message?.content || '').trim();
  } catch (e) { return null; }
}

async function resolveEmailIntentViaModel(userText, apiKey, baseURL, modelName) {
  try {
    const client = new OpenAI({ apiKey, baseURL });
    const response = await client.chat.completions.create({
      model: modelName,
      messages: [
        {
          role: 'system',
          content: 'Extract the email details the user wants to send. Return ONLY a JSON object:\n{"to":"email@example.com","subject":"Subject line (concise, under 10 words)","body":"Full email body text"}\nIf body content is not specified, write a short professional message matching the stated intent. Never include explanation outside the JSON.'
        },
        { role: 'user', content: userText }
      ],
      max_tokens: 300,
      temperature: 0.1,
    });
    const raw = String(response.choices?.[0]?.message?.content || '');
    const match = raw.match(/\{[\s\S]*?\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (parsed.to && parsed.subject && parsed.body) return parsed;
    }
  } catch (e) { /* fall through */ }
  return null;
}

/**
 * Detect calendar event creation intent.
 * Returns { detected: true } if the message looks like a calendar add request, null otherwise.
 */
function parseCalendarIntent(userText) {
  const text = String(userText || '').toLowerCase().trim();
  if (!text) return null;
  const hasAction = /\b(add|create|schedule|book|put|set up|block|log|record)\b/.test(text);
  const hasTarget = /\b(event|meeting|appointment|calendar|reminder|call|lunch|dinner|session|conference)\b/.test(text)
    || /\b(to my calendar|on my calendar|in my calendar|to the calendar)\b/.test(text);
  if (!hasAction || !hasTarget) return null;
  // Must have some time/date signal to be an actionable calendar intent
  const hasTime = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|next week|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{1,2}(st|nd|rd|th)?|am|pm|noon|midnight|\d:\d\d)\b/i.test(text);
  if (!hasTime) return null;
  return { detected: true };
}

/**
 * Use the model to extract a structured calendar event from the user's request.
 * Returns { title, date, time, durationMinutes, location, calendarName, reminderMinutes } or null.
 * date is "YYYY-MM-DD", time is "HH:MM" (24h).
 */
async function resolveCalendarIntentViaModel(userText, apiKey, baseURL, modelName, clientDate) {
  // Use client-supplied date (browser local time) to avoid UTC timezone drift on the server.
  let todayStr, todayDay;
  if (clientDate && /^\d{4}-\d{2}-\d{2}$/.test(clientDate)) {
    todayStr = clientDate;
    const d = new Date(clientDate + 'T12:00:00'); // noon to avoid any DST edge
    todayDay = d.toLocaleDateString('en-US', { weekday: 'long' });
  } else {
    const today = new Date();
    todayStr = today.toISOString().split('T')[0];
    todayDay = today.toLocaleDateString('en-US', { weekday: 'long' });
  }
  try {
    const client = new OpenAI({ apiKey, baseURL });
    const response = await client.chat.completions.create({
      model: modelName,
      messages: [
        {
          role: 'system',
          content: `Today is ${todayDay}, ${todayStr}. Extract a calendar event from the user's request. Return ONLY valid JSON:\n{"title":"Event title","date":"YYYY-MM-DD","time":"HH:MM","durationMinutes":60,"location":"Location or null","calendarName":"WORK or null","reminderMinutes":15}\nRules:\n- date: resolve relative dates (this Thursday, next Monday) relative to today\n- time: 24-hour format. "1pm"=13:00, "1:30pm"=13:30, "around 1pm"=13:00. Default to 09:00 if unclear.\n- durationMinutes: default 60. Use 30 for quick calls, 120 for longer sessions.\n- calendarName: use "WORK" for business/professional meetings, "HOME" for personal. null for default.\n- reminderMinutes: default 15. Use what user specifies.\n- Never include explanation outside the JSON.`
        },
        { role: 'user', content: userText }
      ],
      max_tokens: 200,
      temperature: 0.1,
    });
    const raw = String(response.choices?.[0]?.message?.content || '');
    const match = raw.match(/\{[\s\S]*?\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (parsed.title && parsed.date && parsed.time) return parsed;
    }
  } catch (e) { /* fall through */ }
  return null;
}

/**
 * Build an AppleScript to create a Calendar event.
 * Uses numeric date-setting to avoid locale-dependent string parsing.
 */
function buildCalendarAppleScript({ title, date, time, durationMinutes, location, calendarName, reminderMinutes }) {
  const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const [year, month, day] = (date || '').split('-').map(Number);
  const [hour, minute] = (time || '09:00').split(':').map(Number);
  const dur = Number(durationMinutes) || 60;
  const rem = reminderMinutes != null ? Number(reminderMinutes) : 15;

  // Case-insensitive calendar lookup — user calendars may be all-caps
  const calLookup = calendarName
    ? `repeat with c in (get calendars)\nif (name of c) as text is equal to "${esc(calendarName)}" or (name of c) as text is equal to "${esc(calendarName.toUpperCase())}" or (name of c) as text is equal to "${esc(calendarName.toLowerCase())}" then\nset targetCal to c\nexit repeat\nend if\nend repeat`
    : '';

  const locationProp = location ? `, location:"${esc(location)}"` : '';
  const reminderBlock = rem > 0
    ? `\ntell newEvent\nmake new sound alarm at end of sound alarms with properties {trigger interval:${-rem}}\nend tell`
    : '';

  return `tell application "Calendar"
set targetCal to missing value
${calLookup}
if targetCal is missing value then set targetCal to (get first calendar)
set eventStart to current date
set year of eventStart to ${year}
set month of eventStart to ${month}
set day of eventStart to ${day}
set hours of eventStart to ${hour}
set minutes of eventStart to ${minute}
set seconds of eventStart to 0
set eventEnd to eventStart + (${dur} * minutes)
tell targetCal
set newEvent to make new event with properties {summary:"${esc(title)}", start date:eventStart, end date:eventEnd${locationProp}}${reminderBlock}
end tell
end tell`;
}

/**
 * Detect calendar event deletion intent.
 * Returns { detected: true } if the message is asking to delete/remove a calendar event.
 */
function parseDeleteCalendarIntent(userText) {
  const text = String(userText || '').toLowerCase().trim();
  if (!text) return null;
  const hasDelete = /\b(delete|remove|cancel|clear|take off|get rid of|undo)\b/.test(text);
  const hasTarget = /\b(event|meeting|appointment|calendar|that|it)\b/.test(text)
    || /\b(from (my )?calendar|off (my )?calendar)\b/.test(text);
  if (hasDelete && hasTarget) return { detected: true };
  return null;
}

/**
 * Use the model to identify which event to delete, using full conversation context.
 * Returns { title, date, calendarName } or null.
 */
async function resolveDeleteCalendarIntentViaModel(conversationText, apiKey, baseURL, modelName) {
  const today = new Date().toISOString().split('T')[0];
  try {
    const client = new OpenAI({ apiKey, baseURL });
    const response = await client.chat.completions.create({
      model: modelName,
      messages: [
        {
          role: 'system',
          content: `Today is ${today}. Based on the conversation, identify the calendar event the user wants to delete. Return ONLY valid JSON:\n{"title":"Distinctive part of event title","date":"YYYY-MM-DD or null","calendarName":"WORK or null"}\nRules:\n- title: the most distinctive keyword from the event name (e.g. "Bluelight" not the full title).\n- date: the event date in YYYY-MM-DD, or null if unknown.\n- calendarName: the calendar it was added to (e.g. "WORK"), or null.\n- Never include explanation outside the JSON.`
        },
        { role: 'user', content: conversationText }
      ],
      max_tokens: 100,
      temperature: 0.1,
    });
    const raw = String(response.choices?.[0]?.message?.content || '');
    const match = raw.match(/\{[\s\S]*?\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (parsed.title) return parsed;
    }
  } catch (e) { /* fall through */ }
  return null;
}

/**
 * Build AppleScript to find and delete calendar events matching title (and optionally date).
 * Uses date-filtered 'whose' predicates so Calendar doesn't scan all events.
 * Targets a specific calendar when known to avoid iterating all 30+ calendars.
 */
function buildDeleteCalendarAppleScript({ title, date, calendarName }) {
  const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const searchTitle = esc(title);

  let dateSetup = '';
  let eventQuery = '';

  if (date) {
    const [y, m, d] = date.split('-').map(Number);
    dateSetup = `set startOfDay to current date
set year of startOfDay to ${y}
set month of startOfDay to ${m}
set day of startOfDay to ${d}
set hours of startOfDay to 0
set minutes of startOfDay to 0
set seconds of startOfDay to 0
set endOfDay to startOfDay + (1 * days)`;
    // Date-filtered query — Calendar indexes by date, so this is fast
    eventQuery = `(get events of c whose start date >= startOfDay and start date < endOfDay)`;
  } else {
    // No date — search only within the next 60 days to avoid full scan
    dateSetup = `set startOfDay to (current date) - (30 * days)
set endOfDay to (current date) + (60 * days)`;
    eventQuery = `(get events of c whose start date >= startOfDay and start date < endOfDay)`;
  }

  // If we know the calendar, search only that one. Otherwise search all.
  let calLoop = '';
  if (calendarName) {
    const calName = esc(calendarName);
    const calNameUpper = esc(calendarName.toUpperCase());
    calLoop = `repeat with c in (get calendars)
if name of c is "${calName}" or name of c is "${calNameUpper}" then
${dateSetup}
try
set dayEvents to ${eventQuery}
set toDelete to {}
repeat with e in dayEvents
if (summary of e) contains "${searchTitle}" then
set end of toDelete to e
end if
end repeat
repeat with e in toDelete
delete e
set deletedCount to deletedCount + 1
end repeat
end try
end if
end repeat`;
  } else {
    calLoop = `${dateSetup}
repeat with c in (get calendars)
try
set dayEvents to ${eventQuery}
set toDelete to {}
repeat with e in dayEvents
if (summary of e) contains "${searchTitle}" then
set end of toDelete to e
end if
end repeat
repeat with e in toDelete
delete e
set deletedCount to deletedCount + 1
end repeat
end try
end repeat`;
  }

  return `tell application "Calendar"
set deletedCount to 0
${calLoop}
return deletedCount as text
end tell`;
}

function isOpenClawVerifyIntent(userText) {
  const t = String(userText || '').toLowerCase().trim();
  if (!t) return false;
  const hasOpenClaw = /\b(openclaw)\b/.test(t);
  const hasVerifyWords = /\b(verify|verification|test|health|status|connected|connection|pair|paired|node|computer|mac)\b/.test(t);
  const hasDirectPhrase = /\b(verify|check|test)\b[\s\S]{0,40}\b(pair|paired|node|computer|mac)\b/.test(t);
  return (hasOpenClaw && hasVerifyWords) || hasDirectPhrase;
}

function buildQuickEstimateResponse(intent) {
  const qty = intent.quantity;
  const sizeIn = intent.sizeInches;
  const pipeType = intent.pipeType;
  const sizeLabel = intent.sizeRaw;

  const knownPipe = { 4: 8.5, 6: 12, 8: 18 };
  let unitRate = knownPipe[4];
  if (pipeType === 'gas' && sizeIn <= 1.25) {
    unitRate = 4.75;
  } else if (knownPipe[Math.round(sizeIn)]) {
    unitRate = knownPipe[Math.round(sizeIn)];
  } else if (sizeIn < 4) {
    unitRate = 7.25;
  } else if (sizeIn < 6) {
    unitRate = 10.25;
  } else if (sizeIn < 8) {
    unitRate = 14.5;
  } else {
    unitRate = 18 + ((sizeIn - 8) * 2.1);
  }

  const productionByType = { sewer: 120, water: 160, storm: 140, gas: 220, electrical: 200 };
  const lfPerDay = productionByType[pipeType] || 140;
  const laborDayCost = 3200;
  const equipmentDayCost = 900;

  const days = Math.max(1, Math.ceil(qty / lfPerDay));
  const material = qty * unitRate * 1.1; // includes waste/fittings
  const labor = days * laborDayCost;
  const equipment = days * equipmentDayCost;
  const subtotal = material + labor + equipment;
  const markupPct = 0.15;
  const markup = subtotal * markupPct;
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

function isOpenClawSetupHelpIntent(userText) {
  const t = String(userText || '').toLowerCase().trim();
  if (!t) return false;
  return /openclaw/.test(t) && /(link|connect|setup|set up|enable|configure|how)/.test(t);
}

function buildOpenClawSetupHelpResponse() {
  return [
    'OpenClaw setup has two parts: gateway credentials and Mac node pairing.',
    '',
    'Part 1 — Gateway credentials (one-time):',
    '1) Install OpenClaw: npm install -g openclaw (or download from openclaw.ai)',
    '2) Run: openclaw configure — follow prompts to set up the gateway',
    '3) Start the gateway service: openclaw daemon install && openclaw daemon start',
    '4) Get your auth token: openclaw config get gateway.auth.token',
    '5) Note your gateway URL: http://YOUR_LAN_IP:18789/v1',
    '',
    'Part 2 — Pair your Mac as a node (required for email and desktop actions):',
    '1) Install the node service: openclaw node install',
    '2) Approve it: openclaw devices approve <id shown in pending list>',
    '3) Allowlist osascript: openclaw approvals allowlist add --agent "*" "/usr/bin/osascript"',
    '4) Check: openclaw nodes status — you should see your Mac as connected',
    '',
    'Part 3 — Connect to openmud:',
    '1) Open Settings → Provider API keys → OpenClaw section',
    '2) Paste: API key = your auth token, Base URL = http://YOUR_IP:18789/v1, Model = gpt-4.1-mini',
    '3) Save. Switch model to OpenClaw Agent in chat.',
    '',
    'Quick chat setup (after gateway is running):',
    '/openclaw enable key=YOUR_TOKEN url=http://YOUR_IP:18789/v1 model=gpt-4.1-mini',
    '',
    'Verify it works: "verify openmud agent status"',
    'Then try: "send an email to someone@example.com saying hello"'
  ].join('\n');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Openmud-Dev-Key, X-OpenAI-Api-Key, X-Anthropic-Api-Key, X-Grok-Api-Key, X-OpenRouter-Api-Key, X-OpenClaw-Api-Key, X-OpenClaw-Base-Url, X-OpenClaw-Model, X-Openmud-Relay-Token, X-Client-Date');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { messages, model = 'mud1', temperature = 0.7, max_tokens = 1024, use_tools = false, estimate_context = null, stream = false, email, project_id } = req.body || {};
    const reqSource = detectSource(req);
    const devBypass = isDevBypass(req);
    const openaiKeyOverride = getHeader(req, 'x-openai-api-key');
    const anthropicKeyOverride = getHeader(req, 'x-anthropic-api-key');
    const grokKeyOverride = getHeader(req, 'x-grok-api-key');
    const openrouterKeyOverride = getHeader(req, 'x-openrouter-api-key');
    const openclawKeyOverride = getHeader(req, 'x-openclaw-api-key');
    const openclawBaseUrlOverride = getHeader(req, 'x-openclaw-base-url');
    const openclawModelOverride = getHeader(req, 'x-openclaw-model');

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array required', response: null });
    }

    const isMud1 = model === 'mud1';
    const isAnthropic = model.startsWith('claude-');
    const isOpenClaw = model === 'openclaw';
    const isGrok = /^grok/i.test(model);
    const isOpenRouter = /^openrouter\//i.test(model);
    const isOpenAIModel = !isMud1 && !isAnthropic && !isOpenClaw && !isGrok && !isOpenRouter;
    const usingOwnKey =
      (isOpenAIModel && !!openaiKeyOverride) ||
      (isAnthropic && !!anthropicKeyOverride) ||
      (isOpenClaw && !!openclawKeyOverride) ||
      (isGrok && !!grokKeyOverride) ||
      (isOpenRouter && !!openrouterKeyOverride);

    // Auth policy:
    // - Dev bypass always skips auth.
    // - BYOK requests (provider key supplied in headers) can run without sign-in.
    // - Hosted usage still requires auth.
    let user = null;
    if (!devBypass) {
      user = await getUserFromRequest(req);
      if (!usingOwnKey && !user) {
        return res.status(401).json({
          error: 'Sign in to chat. Go to openmud.ai/settings to sign in.',
          response: null,
        });
      }

      // Hosted policy:
      // - mud1 is always free (no daily cap)
      // - one hosted low-cost model is available with daily caps
      // - premium models require user-provided API keys
      if (!usingOwnKey && !HOSTED_FREE_MODELS.has(model)) {
        return res.status(403).json({
          error: 'This model requires your own API key. Add it in Settings to continue.',
          response: null,
        });
      }

      // Only apply daily allocation to hosted non-mud1 requests.
      if (!usingOwnKey && !isMud1) {
        const alloc = await allocateUsage(user.id, user.email);
        if (!alloc.allowed) {
          const limitLabel = alloc.limit == null ? 'unlimited' : alloc.limit;
          return res.status(429).json({
            error: `Daily limit reached (${alloc.used}/${limitLabel}). Sign in at openmud.ai/settings for access.`,
            response: null,
            usage: { used: alloc.used, limit: alloc.limit, date: alloc.date },
          });
        }
      }
    }

    const lastUserMsg = [...messages].reverse().find((m) => m && m.role === 'user');
    // Client sends their local date (YYYY-MM-DD) so calendar resolution uses the right day,
    // not the UTC date on the Vercel server (which can be a day ahead of US timezones).
    const clientDate = getHeader(req, 'x-client-date') || null;
    const quickEstimate = parseQuickEstimateIntent(lastUserMsg && lastUserMsg.content);
    const openClawSetupHelp = isOpenClawSetupHelpIntent(lastUserMsg && lastUserMsg.content);
    const sendEmailIntent = parseSendEmailIntent(lastUserMsg && lastUserMsg.content);
    const calendarIntent = parseCalendarIntent(lastUserMsg && lastUserMsg.content);
    const deleteCalendarIntent = !calendarIntent && parseDeleteCalendarIntent(lastUserMsg && lastUserMsg.content);
    const openClawVerifyIntent = isOpenClawVerifyIntent(lastUserMsg && lastUserMsg.content);
    if (model === 'mud1' && quickEstimate) {
      return res.status(200).json({
        response: buildQuickEstimateResponse(quickEstimate),
        tools_used: ['estimate_project_cost'],
      });
    }
    if (model === 'mud1' && openClawSetupHelp) {
      return res.status(200).json({
        response: buildOpenClawSetupHelpResponse(),
        tools_used: [],
      });
    }
    // ── Relay path (any model) ────────────────────────────────────────────
    // If the user has a local openmud-agent connected and the message looks like
    // an automation (email, calendar), execute it directly — no model switch needed.
    const relayTokenAny = getHeader(req, 'x-openmud-relay-token');
    if (relayTokenAny) {
      const RELAY_HTTP_UNIVERSAL = process.env.OPENMUD_RELAY_URL || 'https://openmud-production.up.railway.app';
      const lastMsg = lastUserMsg?.content || '';
      const relayApiKey = process.env.OPENAI_API_KEY;
      const relayModel = 'gpt-4o-mini';
      const msgHistory = messages.filter(m => m.role === 'user').map(m => m.content).join(' ');

      // Helper: send one command to relay and poll for result
      async function relayRun(cmd, timeoutSecs = 30) {
        const reqId = 'srv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
        cmd.requestId = reqId;
        const sendRes = await fetch(`${RELAY_HTTP_UNIVERSAL}/relay/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: relayTokenAny, requestId: reqId, ...cmd, messages: [] }),
        });
        const sendData = await sendRes.json();
        if (!sendData.ok) throw new Error('No agent connected. Open Settings and make sure openmud-agent is running.');
        for (let i = 0; i < timeoutSecs; i++) {
          await new Promise(r => setTimeout(r, 1000));
          const pollRes = await fetch(`${RELAY_HTTP_UNIVERSAL}/relay/status/${reqId}`);
          const pollData = await pollRes.json();
          if (pollData.ready) {
            if (pollData.error) throw new Error(pollData.error);
            return pollData.response;
          }
        }
        throw new Error('Mac took too long to respond.');
      }

      let command = null;
      let smartReplyIntent = /text.*back|reply.*to\s+\w|respond.*to\s+\w|text\s+\w+.*back/i.test(lastMsg);

      if (calendarIntent || /calendar|event|meeting|schedule/i.test(lastMsg)) {
        const eventData = await resolveCalendarIntentViaModel(msgHistory, relayApiKey, undefined, relayModel, clientDate);
        if (eventData) command = { type: 'calendar_add', title: eventData.title, date: eventData.date, time: eventData.time, durationMinutes: eventData.durationMinutes, location: eventData.location, calendarName: eventData.calendarName, reminderMinutes: eventData.reminderMinutes };
      } else if (deleteCalendarIntent || /delete.*event|remove.*event|cancel.*event/i.test(lastMsg)) {
        const delData = await resolveDeleteCalendarIntentViaModel(msgHistory, relayApiKey, undefined, relayModel);
        if (delData) command = { type: 'calendar_delete', title: delData.title, date: delData.date, calendarName: delData.calendarName };
      } else if (smartReplyIntent) {
        // Two-step: read messages → draft reply → send
        try {
          const replyIntent = await resolveSmartReplyIntentViaModel(msgHistory, relayApiKey, relayModel);
          if (replyIntent?.to) {
            // Step 1: read last messages from contact
            const readResult = await relayRun({ type: 'read_messages', to: replyIntent.to, count: 8 }, 30);
            let thread = [];
            let contactHandle = replyIntent.to;
            let readParsed = null;
            try { readParsed = JSON.parse(readResult); } catch {}

            // Contact ambiguity — ask user to pick with buttons
            if (readParsed?._ambiguous) {
              return res.status(200).json({
                response: readParsed.question,
                _choices: (readParsed.names || []).map(name => ({
                  label: name,
                  message: `Text ${name} back`,
                })),
              });
            }

            thread = readParsed?.messages || [];
            contactHandle = readParsed?.handle || replyIntent.to;

            if (thread.length === 0) {
              return res.status(200).json({ response: `No recent messages found with ${replyIntent.to}.` });
            }

            // Step 2: draft reply in user's voice
            const userName = req.body?.userName || getHeader(req, 'x-user-name') || 'Mason';
            const additionalInstruction = lastMsg.replace(/text.*back|reply.*to\s+\w+|respond.*to\s+\w+/i, '').trim();
            const drafted = await draftSmartReplyViaModel(thread, userName, additionalInstruction, relayApiKey, relayModel);
            if (!drafted) return res.status(200).json({ response: 'Could not draft a reply. Try again.' });

            // Step 3: send the drafted reply
            const sendResult = await relayRun({ type: 'imessage_send', to: replyIntent.to, message: drafted }, 25);
            const lastMsg2 = thread.filter(m => m.from !== 'me').slice(-1)[0];
            return res.status(200).json({
              response: `Read ${thread.length} messages with ${replyIntent.to}.\n\nTheir last message: "${lastMsg2?.text || '(no text)'}"\n\nReplied: "${drafted}"\n\n${sendResult}`
            });
          }
        } catch (err) {
          return res.status(200).json({ response: 'Error during smart reply: ' + err.message });
        }
      } else if (/imessage|iMessage|send.*text|text.*to\s+\w|send.*imessage/i.test(lastMsg)) {
        const imsgData = await resolveiMessageIntentViaModel(msgHistory, relayApiKey, undefined, relayModel);
        if (imsgData) command = { type: 'imessage_send', to: imsgData.to, message: imsgData.message };
      } else if (sendEmailIntent || /send.*email|email.*to|write.*email/i.test(lastMsg)) {
        const emailData = await resolveEmailIntentViaModel(msgHistory, relayApiKey, undefined, relayModel);
        if (emailData) command = { type: 'email_send', to: emailData.to, subject: emailData.subject, body: emailData.body };
      }

      if (command) {
        try {
          const result = await relayRun(command, 60);
          // Check if agent returned a contact ambiguity response
          let resultParsed = null;
          try { resultParsed = JSON.parse(result); } catch {}
          if (resultParsed?._ambiguous) {
            const actionLabel = command.type === 'email_send' ? 'Email' : 'Text';
            const msgPayload = command.type === 'email_send'
              ? command.subject || ''
              : command.message || '';
            return res.status(200).json({
              response: resultParsed.question,
              _choices: (resultParsed.names || []).map(name => ({
                label: name,
                message: `${actionLabel} ${name}${msgPayload ? ': ' + msgPayload : ''}`,
              })),
            });
          }
          return res.status(200).json({ response: result });
        } catch (err) {
          return res.status(200).json({ response: 'Error from your Mac: ' + err.message });
        }
      }
      // No automation command detected — fall through to normal AI response
    }

    // mud1: True RAG — retrieve from knowledge base → GPT-4o generates grounded response
    if (isMud1) {
      const apiKey = openaiKeyOverride || process.env.OPENAI_API_KEY;
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
      if (project_id && user && user.id) {
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
      if (user && user.id && !usingOwnKey) {
        logUsageEvent(user.id, { model, inputTokens: usage.prompt_tokens || 0, outputTokens: usage.completion_tokens || 0, source: reqSource, requestType: use_tools ? 'estimate' : 'chat' });
      }
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
      const apiKey = anthropicKeyOverride || process.env.ANTHROPIC_API_KEY;
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
          const rawText = Array.isArray(response.content)
            ? response.content
              .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
              .map((b) => b.text)
              .join('\n')
            : '';
          const lastUser = chatMessages.filter((m) => m.role === 'user').pop();
          let text = ensureScheduleBlock(rawText || 'No response.', lastUser?.content, use_tools, messages);
          text = ensureProposalBlock(text, lastUser?.content, use_tools, estimate_context);
          const ausage = response.usage || {};
          if (user && user.id && !usingOwnKey) {
            logUsageEvent(user.id, { model, inputTokens: ausage.input_tokens || 0, outputTokens: ausage.output_tokens || 0, source: reqSource, requestType: use_tools ? 'estimate' : 'chat' });
          }
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

    if (isOpenClaw) {
      // ── Relay path (no OpenClaw required) ──────────────────────────────
      // If the browser passes a relay token, route through the openmud relay
      // server to the user's local openmud-agent.js. The server figures out
      // the intent, sends a structured command, and waits for the result.
      const relayToken = getHeader(req, 'x-openmud-relay-token');
      const RELAY_HTTP = process.env.OPENMUD_RELAY_URL || 'https://openmud-production.up.railway.app';

      if (relayToken) {
        const lastMsg = lastUserMsg?.content || '';
        // Use server's hosted key for relay intent resolution
        const relayApiKey = process.env.OPENAI_API_KEY;
        const relayModel = 'gpt-4o-mini';

        // Combine message history into a single string for intent resolution
        const msgHistory = messages.filter(m => m.role === 'user').map(m => m.content).join(' ');

        // Resolve intent → structured command via AI
        let command = null;
        if (calendarIntent || /calendar|event|meeting|schedule/i.test(lastMsg)) {
          const eventData = await resolveCalendarIntentViaModel(msgHistory, relayApiKey, undefined, relayModel, clientDate);
          if (eventData) command = { type: 'calendar_add', title: eventData.title, date: eventData.date, time: eventData.time, durationMinutes: eventData.durationMinutes, location: eventData.location, calendarName: eventData.calendarName, reminderMinutes: eventData.reminderMinutes };
        } else if (deleteCalendarIntent || /delete.*event|remove.*event|cancel.*event/i.test(lastMsg)) {
          const delData = await resolveDeleteCalendarIntentViaModel(msgHistory, relayApiKey, undefined, relayModel);
          if (delData) command = { type: 'calendar_delete', title: delData.title, date: delData.date, calendarName: delData.calendarName };
        } else if (/imessage|iMessage|send.*text|text.*to\s+\w|send.*imessage/i.test(lastMsg)) {
          const imsgData = await resolveiMessageIntentViaModel(msgHistory, relayApiKey, undefined, relayModel);
          if (imsgData) command = { type: 'imessage_send', to: imsgData.to, message: imsgData.message };
        } else if (sendEmailIntent || /send.*email|email.*to|write.*email/i.test(lastMsg)) {
          const emailData = await resolveEmailIntentViaModel(msgHistory, relayApiKey, undefined, relayModel);
          if (emailData) command = { type: 'email_send', to: emailData.to, subject: emailData.subject, body: emailData.body };
        }

        if (command) {
          const requestId = 'srv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
          command.requestId = requestId;

          // Send to relay
          try {
            const sendRes = await fetch(`${RELAY_HTTP}/relay/send`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token: relayToken, requestId, ...command, messages: [] }),
            });
            const sendData = await sendRes.json();
            if (!sendData.ok) {
              return res.status(503).json({ error: 'No agent connected. Make sure openmud-agent is running on your Mac (see Settings → openmud agent).', response: null });
            }

            // Poll relay for response (up to 60s)
            for (let i = 0; i < 60; i++) {
              await new Promise(r => setTimeout(r, 1000));
              const pollRes = await fetch(`${RELAY_HTTP}/relay/status/${requestId}`);
              const pollData = await pollRes.json();
              if (pollData.ready) {
                if (pollData.error) return res.status(200).json({ response: 'Error from your Mac: ' + pollData.error });
                return res.status(200).json({ response: pollData.response });
              }
            }
            return res.status(504).json({ error: 'Your Mac took too long to respond. Check that openmud-agent is running.', response: null });
          } catch (err) {
            return res.status(502).json({ error: 'Relay error: ' + err.message, response: null });
          }
        }

        // No specific command — fall through to regular AI chat with OpenClaw system prompt
        {
          const ocSystemPrompt = getSystemPrompt('openclaw');
          const ocMessages = messages[0]?.role === 'system'
            ? [{ role: 'system', content: ocSystemPrompt + '\n\n' + messages[0].content }, ...messages.slice(1)]
            : [{ role: 'system', content: ocSystemPrompt }, ...messages];
          const ocClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
          const ocCompletion = await ocClient.chat.completions.create({ model: 'gpt-4o-mini', messages: ocMessages, temperature: 0.5, max_tokens: 1024 });
          const ocReply = ocCompletion.choices?.[0]?.message?.content || 'No response.';
          return res.status(200).json({ response: ocReply });
        }
      }

      // ── Legacy OpenClaw gateway path ────────────────────────────────────
      const apiKey = openclawKeyOverride || process.env.OPENCLAW_API_KEY;
      const baseURL = normalizeOpenClawBaseUrl(openclawBaseUrlOverride || process.env.OPENCLAW_BASE_URL);
      if (!apiKey || !baseURL) {
        return res.status(500).json({
          error: 'OpenClaw agent not linked. Go to Settings → openmud agent and follow setup to connect your Mac.',
          response: null,
        });
      }

      if (openClawVerifyIntent) {
        const verify = await invokeOpenClawTool({
          apiKey,
          baseURL,
          tool: 'sessions_list',
          action: 'json',
          args: { limit: 5 },
        });
        const nodeStatus = await invokeOpenClawTool({
          apiKey,
          baseURL,
          tool: 'nodes',
          action: 'status',
          args: {},
        });
        const linkOk = !!verify.ok;
        const nodeOk = !!nodeStatus.ok;
        const sessions = verify.data?.result;
        const sessionCount = Array.isArray(sessions)
          ? sessions.length
          : (Array.isArray(sessions?.sessions) ? sessions.sessions.length : null);
        const sessionMsg = Number.isFinite(sessionCount)
          ? `${sessionCount} session${sessionCount === 1 ? '' : 's'} returned`
          : 'session query completed';

        // Parse node details using MCP content blocks format
        const verifyNodeAnalysis = nodeOk ? analyzeOpenClawNodes(nodeStatus.data) : null;
        const nodeHints = [];
        if (verifyNodeAnalysis) {
          nodeHints.push(`${verifyNodeAnalysis.nodes.length} node(s) visible`);
          if (verifyNodeAnalysis.hasConnectedMac) nodeHints.push('Mac node connected');
          else if (verifyNodeAnalysis.iosOnlyNodes) nodeHints.push('iPhone node only — need a Mac node for email/osascript');
          else if (verifyNodeAnalysis.allDisconnected) nodeHints.push('node(s) paired but not connected');
          else if (!verifyNodeAnalysis.hasMacNode) nodeHints.push('no Mac node detected');
        }
        const nodeMsg = nodeOk
          ? (nodeHints.length ? nodeHints.join(', ') : 'nodes tool reachable')
          : summarizeOpenClawFailure(nodeStatus);

        const nodeListLines = verifyNodeAnalysis && verifyNodeAnalysis.nodes.length > 0
          ? ['\nPaired nodes:', ...verifyNodeAnalysis.nodes.map(n =>
            `- ${n.displayName || n.nodeId || 'unknown'} (${n.platform || 'unknown platform'}) — ${n.connected ? 'connected' : 'not connected'}`
          )]
          : [];

        if (linkOk && nodeOk && verifyNodeAnalysis && verifyNodeAnalysis.hasConnectedMac) {
          return sendTextResponse(
            res,
            [`openmud agent connected.`, `- Gateway/auth: ok (${sessionMsg})`, `- Computer/node pairing: ok (${nodeMsg})`, ...nodeListLines, '', 'You can send: "using my apple email send an email to hi@masonearl.com saying hello"'].join('\n'),
            ['openclaw_verify', 'openclaw_nodes_status'],
            stream && !use_tools
          );
        }

        const failLines = [
          'openmud agent — action needed.',
          `- Gateway/auth: ${linkOk ? `ok (${sessionMsg})` : summarizeOpenClawFailure(verify)}`,
          `- Computer/node pairing: ${nodeOk ? `ok (${nodeMsg})` : nodeMsg}`,
          ...nodeListLines,
          '',
          'What to fix:',
        ];
        if (!linkOk) {
          failLines.push('- In web Settings, verify your relay URL and token in Settings → openmud agent.');
        } else if (!nodeOk) {
          failLines.push('- Make sure openmud-agent is running on your Mac.');
          failLines.push('- openmud-agent connected but not responding to commands.');
        } else if (verifyNodeAnalysis && verifyNodeAnalysis.iosOnlyNodes) {
          failLines.push('- Your only paired node is an iPhone. Email and osascript require a Mac node.');
          failLines.push('- Run the install from Settings → openmud agent to connect your Mac.');
        } else if (verifyNodeAnalysis && verifyNodeAnalysis.allDisconnected) {
          failLines.push('- Your node is paired but not connected. Restart openmud-agent on your Mac.');
        }
        failLines.push('- Re-run: "verify openmud agent status" in web chat.');
        return sendTextResponse(
          res,
          failLines.join('\n'),
          ['openclaw_verify', 'openclaw_nodes_status'],
          stream && !use_tools
        );
      }

      if (sendEmailIntent) {
        const linkCheck = await invokeOpenClawTool({
          apiKey,
          baseURL,
          tool: 'sessions_list',
          action: 'json',
          args: { limit: 1 },
        });
        const nodeCheck = await invokeOpenClawTool({
          apiKey,
          baseURL,
          tool: 'nodes',
          action: 'status',
          args: {},
        });

        // Detect node issues early so we skip pointless osascript probes.
        // Only bail when we know for certain osascript cannot work.
        const nodeAnalysis = nodeCheck.ok ? analyzeOpenClawNodes(nodeCheck.data) : null;
        const canRunOsascript = nodeAnalysis ? nodeAnalysis.hasConnectedMac : false;

        // Short-circuit only when there is definitively no usable Mac node:
        // iOS-only nodes, no nodes at all, or all nodes explicitly disconnected with no Mac.
        const noUsableMac = nodeAnalysis && (
          nodeAnalysis.iosOnlyNodes ||
          (!nodeAnalysis.hasMacNode && nodeAnalysis.nodes.length > 0) ||
          (nodeAnalysis.allDisconnected && !nodeAnalysis.hasMacNode) ||
          nodeAnalysis.nodes.length === 0
        );

        if (noUsableMac) {
          return sendTextResponse(
            res,
            buildOpenClawEmailTroubleshootMessage({
              linkCheck,
              nodeCheck,
              nodeDescribe: null,
              runProbe: null,
              sendAttempt: null,
              execAttempt: null,
              osascriptProbe: null,
              mailProbe: null,
              nodeAnalysis,
            }),
            ['openclaw_nodes_run', 'send_email'],
            stream && !use_tools
          );
        }

        // Get the connected Mac node ID from status to use with CLI
        const connectedMacNode = nodeAnalysis && nodeAnalysis.nodes.find(n => {
          const isMac = /mac|darwin|macos/i.test(String(n?.platform || ''));
          const isConn = n?.connected !== false;
          return isMac && isConn;
        });
        const macNodeId = connectedMacNode?.nodeId;

        if (!macNodeId) {
          return sendTextResponse(
            res,
            buildOpenClawEmailTroubleshootMessage({ linkCheck, nodeCheck, nodeDescribe: null, runProbe: null, sendAttempt: null, execAttempt: null, osascriptProbe: null, mailProbe: null, nodeAnalysis }),
            ['openclaw_nodes_run', 'send_email'],
            stream && !use_tools
          );
        }

        // Probe: confirm osascript is reachable on the node
        const probeResult = await runOpenClawNodeCommand(macNodeId, '/usr/bin/osascript', ['-e', 'return "ok"'], 15000);
        const runProbe = probeResult.ok ? { ok: true } : { ok: false, error: probeResult.error };

        // Use model to resolve subject/body properly — avoids regex picking up unrelated context
        const effectiveModel = sanitizeOpenClawModel(openclawModelOverride) || OPENCLAW_MODELS[model] || OPENCLAW_MODELS.openclaw;
        const lastUserContent = lastUserMsg && lastUserMsg.content ? String(lastUserMsg.content) : sendEmailIntent.text;
        const modelIntent = probeResult.ok
          ? await resolveEmailIntentViaModel(lastUserContent, apiKey, baseURL, effectiveModel)
          : null;

        // Merge: model result overrides regex for subject/body, keep regex `to` as ground truth
        const finalIntent = {
          to: sendEmailIntent.to,
          subject: modelIntent?.subject || sendEmailIntent.subject,
          body: modelIntent?.body || sendEmailIntent.body || 'Hello',
        };

        // Send the email
        const script = buildMailAppleScript(finalIntent);
        let sendResult = null;
        let sendError = null;
        if (probeResult.ok) {
          sendResult = await runOpenClawNodeCommand(macNodeId, '/usr/bin/osascript', ['-e', script], 30000);
          if (!sendResult.ok) sendError = sendResult.error;
        }

        if (sendResult && sendResult.ok) {
          const confirmMsg = [
            `Sent email via Apple Mail.`,
            ``,
            `To: ${finalIntent.to}`,
            `Subject: ${finalIntent.subject}`,
            ``,
            finalIntent.body,
          ].join('\n');
          return sendTextResponse(
            res,
            confirmMsg,
            ['openclaw_nodes_run', 'send_email'],
            stream && !use_tools
          );
        }

        // Build troubleshoot message with what we know
        const send = sendResult ? { ok: sendResult.ok, error: sendError, status: sendResult.ok ? 200 : 500 } : null;
        const troubleshooting = buildOpenClawEmailTroubleshootMessage({
          linkCheck,
          nodeCheck,
          nodeDescribe: null,
          runProbe: probeResult.ok ? { ok: true, status: 200 } : { ok: false, status: 500, error: probeResult.error },
          sendAttempt: send,
          execAttempt: null,
          osascriptProbe: null,
          mailProbe: null,
          nodeAnalysis,
        });
        return sendTextResponse(
          res,
          troubleshooting,
          ['openclaw_nodes_run', 'send_email'],
          stream && !use_tools
        );
      }

      if (calendarIntent) {
        const nodeCheck = await invokeOpenClawTool({ apiKey, baseURL, tool: 'nodes', action: 'status', args: {} });
        const nodeAnalysis = nodeCheck.ok ? analyzeOpenClawNodes(nodeCheck.data) : null;
        const connectedMacNode = nodeAnalysis && nodeAnalysis.nodes.find(n =>
          /mac|darwin|macos/i.test(String(n?.platform || '')) && n?.connected !== false
        );
        const macNodeId = connectedMacNode?.nodeId;

        if (!macNodeId) {
          return sendTextResponse(res, 'Cannot create the calendar event — no connected Mac node found. Run "verify openmud agent status" to diagnose.', ['openclaw_calendar'], stream && !use_tools);
        }

        const effectiveModelCal = sanitizeOpenClawModel(openclawModelOverride) || OPENCLAW_MODELS[model] || OPENCLAW_MODELS.openclaw;
        const lastUserContent = lastUserMsg?.content ? String(lastUserMsg.content) : '';
        // Combine full conversation context so model can resolve "yes", "this Thursday", follow-up answers
        const allUserContent = messages.filter(m => m.role === 'user').map(m => String(m.content || '')).join('\n');
        const calDetails = await resolveCalendarIntentViaModel(allUserContent || lastUserContent, apiKey, baseURL, effectiveModelCal, clientDate);

        if (!calDetails) {
          return sendTextResponse(res, 'Could not parse the calendar event details. Please include the date, time, and what the event is for.', ['openclaw_calendar'], stream && !use_tools);
        }

        const script = buildCalendarAppleScript(calDetails);
        const result = await runOpenClawNodeCommand(macNodeId, '/usr/bin/osascript', ['-e', script], 45000);

        if (result.ok) {
          const [yy, mm, dd] = (calDetails.date || '').split('-');
          const eventDate = new Date(Number(yy), Number(mm) - 1, Number(dd));
          const dateLabel = eventDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
          const [h, min] = (calDetails.time || '09:00').split(':').map(Number);
          const timeLabel = new Date(0, 0, 0, h, min).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
          const confirmLines = [
            `Added to Apple Calendar.`,
            ``,
            `Event: ${calDetails.title}`,
            `Date: ${dateLabel}`,
            `Time: ${timeLabel}`,
            calDetails.location ? `Location: ${calDetails.location}` : null,
            calDetails.calendarName ? `Calendar: ${calDetails.calendarName}` : null,
            calDetails.reminderMinutes > 0 ? `Reminder: ${calDetails.reminderMinutes} min before` : null,
          ].filter(Boolean).join('\n');
          return sendTextResponse(res, confirmLines, ['openclaw_calendar'], stream && !use_tools);
        }

        // Failed — give specific error output
        const errDetail = String(result.stderr || result.error || 'unknown error').slice(0, 400);
        const helpMsg = /not authorized|TCC|permission|denied/i.test(errDetail)
          ? `\n\nFix: go to System Settings > Privacy & Security > Automation and make sure the OpenClaw node (Terminal or openclaw) has permission to control Calendar.`
          : '';
        return sendTextResponse(res, `Could not add the calendar event.\n\n${errDetail}${helpMsg}`, ['openclaw_calendar'], stream && !use_tools);
      }

      if (deleteCalendarIntent) {
        const nodeCheck = await invokeOpenClawTool({ apiKey, baseURL, tool: 'nodes', action: 'status', args: {} });
        const nodeAnalysis = nodeCheck.ok ? analyzeOpenClawNodes(nodeCheck.data) : null;
        const connectedMacNode = nodeAnalysis && nodeAnalysis.nodes.find(n =>
          /mac|darwin|macos/i.test(String(n?.platform || '')) && n?.connected !== false
        );
        const macNodeId = connectedMacNode?.nodeId;

        if (!macNodeId) {
          return sendTextResponse(res, 'Cannot delete the calendar event — no connected Mac node. Run "verify openmud agent status" to diagnose.', ['openclaw_calendar_delete'], stream && !use_tools);
        }

        const effectiveModelDel = sanitizeOpenClawModel(openclawModelOverride) || OPENCLAW_MODELS[model] || OPENCLAW_MODELS.openclaw;
        const allConversation = messages.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${String(m.content || '')}`).join('\n');
        const delDetails = await resolveDeleteCalendarIntentViaModel(allConversation, apiKey, baseURL, effectiveModelDel);

        if (!delDetails || !delDetails.title) {
          return sendTextResponse(res, 'Could not identify which event to delete. Please specify the event name or date.', ['openclaw_calendar_delete'], stream && !use_tools);
        }

        const script = buildDeleteCalendarAppleScript(delDetails);
        const result = await runOpenClawNodeCommand(macNodeId, '/usr/bin/osascript', ['-e', script], 45000);

        if (result.ok) {
          const count = parseInt(String(result.stdout || '0').trim(), 10) || 0;
          const msg = count > 0
            ? `Deleted ${count} event${count > 1 ? 's' : ''} matching "${delDetails.title}"${delDetails.date ? ` on ${delDetails.date}` : ''} from Apple Calendar.`
            : `No events found matching "${delDetails.title}"${delDetails.date ? ` on ${delDetails.date}` : ''}. Check the event name or date and try again.`;
          return sendTextResponse(res, msg, ['openclaw_calendar_delete'], stream && !use_tools);
        }

        const errDetail = String(result.stderr || result.error || 'unknown error').slice(0, 300);
        return sendTextResponse(res, `Could not delete the event.\n\n${errDetail}`, ['openclaw_calendar_delete'], stream && !use_tools);
      }

      const openclaw = new OpenAI({ apiKey, baseURL });
      const systemPrompt = getSystemPrompt(model);
      const hasSystem = messages[0]?.role === 'system';
      const apiMessages = hasSystem
        ? [{ role: 'system', content: `${systemPrompt}\n\n${messages[0].content}` }, ...messages.slice(1)]
        : [{ role: 'system', content: systemPrompt }, ...messages];

      const effectiveModel = sanitizeOpenClawModel(openclawModelOverride) || OPENCLAW_MODELS[model] || OPENCLAW_MODELS.openclaw;
      const createParams = {
        model: effectiveModel,
        messages: apiMessages,
        max_tokens: Math.min(max_tokens, 4096),
        temperature,
      };

      if (stream && !use_tools) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');

        const streamCompletion = await openclaw.chat.completions.create({
          ...createParams,
          stream: true,
        });

        for await (const chunk of streamCompletion) {
          const content = chunk.choices?.[0]?.delta?.content;
          if (content) {
            res.write('data: ' + JSON.stringify({ content }) + '\n\n');
          }
        }
        res.write('data: [DONE]\n\n');
        return res.end();
      }

      const completion = await openclaw.chat.completions.create(createParams);
      const rawText = completion.choices?.[0]?.message?.content || 'No response.';
      const lastUser = messages.filter((m) => m.role === 'user').pop();
      let text = ensureScheduleBlock(rawText, lastUser?.content, use_tools, messages);
      text = ensureProposalBlock(text, lastUser?.content, use_tools, estimate_context);
      const usage = completion.usage || {};
      if (user && user.id && !usingOwnKey) {
        logUsageEvent(user.id, {
          model,
          inputTokens: usage.prompt_tokens || 0,
          outputTokens: usage.completion_tokens || 0,
          source: reqSource,
          requestType: use_tools ? 'estimate' : 'chat',
        });
      }
      return res.status(200).json({ response: text, tools_used: [] });
    }

    if (isGrok) {
      const apiKey = grokKeyOverride || process.env.XAI_API_KEY || '';
      if (!apiKey) {
        return res.status(500).json({
          error: 'Grok key missing. Add key in Settings or set XAI_API_KEY.',
          response: null,
        });
      }
      const grok = new OpenAI({ apiKey, baseURL: 'https://api.x.ai/v1' });
      const systemPrompt = getSystemPrompt('gpt-4o-mini');
      const hasSystem = messages[0]?.role === 'system';
      const apiMessages = hasSystem
        ? [{ role: 'system', content: `${systemPrompt}\n\n${messages[0].content}` }, ...messages.slice(1)]
        : [{ role: 'system', content: systemPrompt }, ...messages];
      const completion = await grok.chat.completions.create({
        model: model || 'grok-2-latest',
        messages: apiMessages,
        max_tokens: Math.min(max_tokens, 4096),
        temperature,
      });
      const text = completion.choices?.[0]?.message?.content || 'No response.';
      return res.status(200).json({ response: text, tools_used: [] });
    }

    if (isOpenRouter) {
      const apiKey = openrouterKeyOverride || process.env.OPENROUTER_API_KEY || '';
      if (!apiKey) {
        return res.status(500).json({
          error: 'OpenRouter key missing. Add key in Settings or set OPENROUTER_API_KEY.',
          response: null,
        });
      }
      const orClient = new OpenAI({ apiKey, baseURL: 'https://openrouter.ai/api/v1' });
      const baseModel = model.replace(/^openrouter\//i, '') || 'openai/gpt-4o-mini';
      const systemPrompt = getSystemPrompt('gpt-4o-mini');
      const hasSystem = messages[0]?.role === 'system';
      const apiMessages = hasSystem
        ? [{ role: 'system', content: `${systemPrompt}\n\n${messages[0].content}` }, ...messages.slice(1)]
        : [{ role: 'system', content: systemPrompt }, ...messages];
      const completion = await orClient.chat.completions.create({
        model: baseModel,
        messages: apiMessages,
        max_tokens: Math.min(max_tokens, 4096),
        temperature,
      });
      const text = completion.choices?.[0]?.message?.content || 'No response.';
      return res.status(200).json({ response: text, tools_used: [] });
    }

    const effectiveModel = isMud1 ? 'gpt-4o-mini' : (OPENAI_MODELS[model] || model);
    const apiKey = openaiKeyOverride || process.env.OPENAI_API_KEY;
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
    if (user && user.id && !usingOwnKey) {
      logUsageEvent(user.id, { model, inputTokens: ousage.prompt_tokens || 0, outputTokens: ousage.completion_tokens || 0, source: reqSource, requestType: use_tools ? 'estimate' : 'chat' });
    }
    return res.status(200).json({ response: text, tools_used: [] });
  } catch (err) {
    console.error('Chat error:', err);
    let msg = err?.message || String(err);
    const status = err?.status ?? err?.statusCode;
    if (status === 401) msg = 'Invalid API key. Check your provider key in Settings or your server env vars.';
    else if (status === 429) msg = 'Rate limit exceeded. Try again in a moment.';
    else if ((msg.toLowerCase().includes('model') && (msg.toLowerCase().includes('not found') || msg.toLowerCase().includes('does not exist')))) msg = 'Model not available. Try a different model.';
    return res.status(500).json({
      error: msg,
      response: msg,
    });
  }
};
