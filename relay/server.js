/**
 * openmud OpenClaw relay server.
 *
 * Architecture:
 *   - Local OpenClaw agent (openmud-agent.js) connects here via WebSocket,
 *     authenticated with a per-user token.
 *   - Browser chat sends POST /relay/send   { token, requestId, message, history }
 *   - Relay forwards to the connected agent, waits for response.
 *   - Agent POSTs back to /relay/respond    { requestId, response }
 *   - Browser polls  GET  /relay/status/:requestId for the result.
 *
 * Deploy: Railway, Fly.io, Render — any Node.js host.
 * Env vars: PORT (default 8080), RELAY_SECRET (shared HMAC secret, optional).
 */

'use strict';

const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const crypto = require('crypto');

const PORT = parseInt(process.env.PORT || '8080', 10);

// token → WebSocket connection to the local agent
const agents = new Map();

// requestId → { resolve, reject, timer }
const pending = new Map();

// requestId → response string (held for 60s so browser can retrieve)
const responses = new Map();

const REQUEST_TIMEOUT_MS = 60000;
const RESPONSE_TTL_MS = 120000;

// ── HTTP server ────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  // CORS — allow any origin so openmud.ai and localhost:3950 both work
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost`);

  // Health check
  if (req.method === 'GET' && url.pathname === '/health') {
    json(res, 200, { ok: true, agents: agents.size });
    return;
  }

  // Browser → relay: send a message to the local agent
  if (req.method === 'POST' && url.pathname === '/relay/send') {
    readBody(req).then(body => {
      const { token, requestId, ...rest } = body;
      if (!token || !requestId) {
        return json(res, 400, { error: 'Missing token or requestId' });
      }
      const ws = agents.get(token);
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        return json(res, 503, { ok: false, error: 'No agent connected for this token. Make sure openmud-agent is running on your Mac.' });
      }
      // Forward full command payload to agent (type, to, subject, body, messages, etc.)
      ws.send(JSON.stringify({ requestId, ...rest }));
      json(res, 200, { ok: true, requestId });
    }).catch(err => json(res, 500, { error: err.message }));
    return;
  }

  // Local agent → relay: post a response
  if (req.method === 'POST' && url.pathname === '/relay/respond') {
    readBody(req).then(body => {
      const { requestId, response, error } = body;
      if (!requestId) return json(res, 400, { error: 'Missing requestId' });

      // Store response for browser polling
      responses.set(requestId, { response: response || null, error: error || null, ts: Date.now() });
      setTimeout(() => responses.delete(requestId), RESPONSE_TTL_MS);

      // Resolve any pending promise
      const p = pending.get(requestId);
      if (p) {
        clearTimeout(p.timer);
        pending.delete(requestId);
        p.resolve({ response, error });
      }
      json(res, 200, { ok: true });
    }).catch(err => json(res, 500, { error: err.message }));
    return;
  }

  // Browser polls for result
  if (req.method === 'GET' && url.pathname.startsWith('/relay/status/')) {
    const requestId = url.pathname.replace('/relay/status/', '');
    const result = responses.get(requestId);
    if (result) {
      responses.delete(requestId);
      json(res, 200, { ready: true, ...result });
    } else {
      json(res, 200, { ready: false });
    }
    return;
  }

  // Check if a token has an agent connected
  if (req.method === 'GET' && url.pathname.startsWith('/relay/connected/')) {
    const token = url.pathname.replace('/relay/connected/', '');
    const ws = agents.get(token);
    json(res, 200, { connected: !!(ws && ws.readyState === WebSocket.OPEN) });
    return;
  }

  json(res, 404, { error: 'Not found' });
});

// ── WebSocket server (local agents connect here) ───────────────────────────

const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  // Agent authenticates by sending { type: 'auth', token: '<user-token>' }
  let token = null;
  let pingInterval = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (!token) {
      // First message must be auth
      if (msg.type === 'auth' && msg.token) {
        token = msg.token;
        agents.set(token, ws);
        ws.send(JSON.stringify({ type: 'auth_ok' }));
        console.log(`[relay] agent connected: ${token.slice(0, 8)}...`);

        // Keepalive ping every 20s
        pingInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.ping();
        }, 20000);
      } else {
        ws.close(4001, 'Unauthorized');
      }
      return;
    }

    // Agent sends back a response to a request
    if (msg.type === 'response' && msg.requestId) {
      const payload = { requestId: msg.requestId, response: msg.response, error: msg.error };
      // Store it for the browser poll
      responses.set(msg.requestId, { response: msg.response || null, error: msg.error || null, ts: Date.now() });
      setTimeout(() => responses.delete(msg.requestId), RESPONSE_TTL_MS);

      const p = pending.get(msg.requestId);
      if (p) {
        clearTimeout(p.timer);
        pending.delete(msg.requestId);
        p.resolve(payload);
      }
    }
  });

  ws.on('close', () => {
    if (token) {
      agents.delete(token);
      console.log(`[relay] agent disconnected: ${token.slice(0, 8)}...`);
    }
    if (pingInterval) clearInterval(pingInterval);
  });

  ws.on('error', (err) => {
    console.error('[relay] ws error:', err.message);
  });
});

// ── Helpers ────────────────────────────────────────────────────────────────

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => {
      try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

// ── Start ──────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`[relay] openmud OpenClaw relay running on port ${PORT}`);
});
