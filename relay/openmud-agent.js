#!/usr/bin/env node
/**
 * openmud-agent — local bridge between openmud.ai and your OpenClaw gateway.
 *
 * Usage:
 *   node openmud-agent.js --token <your-token>
 *
 * Options:
 *   --token      Your openmud pairing token (from Settings → OpenClaw)
 *   --gateway    OpenClaw gateway base URL (default: http://localhost:18789/v1)
 *   --relay      openmud relay server URL (default: wss://openmud-relay.up.railway.app)
 *   --oc-key     OpenClaw API key (default: reads from ~/.openclaw/identity/device-auth.json)
 *
 * Install and run once; set to auto-start with: node openmud-agent.js --token <token> --install
 */

'use strict';

const { WebSocket } = require('ws');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ── Parse args ─────────────────────────────────────────────────────────────

const args = {};
process.argv.slice(2).forEach((a, i, arr) => {
  if (a.startsWith('--')) args[a.slice(2)] = arr[i + 1] || true;
});

const TOKEN = args.token;
const GATEWAY_URL = (args.gateway || 'http://localhost:18789/v1').replace(/\/+$/, '');
const RELAY_URL = (args.relay || 'wss://openmud-relay.up.railway.app').replace(/^http/, 'ws').replace(/\/+$/, '');

if (!TOKEN) {
  console.error('Error: --token is required. Get your token from openmud.ai → Settings → OpenClaw.');
  process.exit(1);
}

// ── Read OpenClaw key ──────────────────────────────────────────────────────

function readOpenClawKey() {
  if (args['oc-key']) return args['oc-key'];
  try {
    const authPath = path.join(os.homedir(), '.openclaw', 'identity', 'device-auth.json');
    const data = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    return data?.tokens?.operator?.token || '';
  } catch {
    return '';
  }
}

const OC_KEY = readOpenClawKey();

// ── Call local OpenClaw gateway ────────────────────────────────────────────

function callGateway(messages, model) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: model || 'gpt-4.1-mini',
      messages: [
        {
          role: 'system',
          content: 'You are OpenClaw, an agentic assistant for openmud. Execute tasks directly — do not ask for confirmation. You are connected to the user\'s Mac via OpenClaw nodes and can run osascript to control Apple Calendar, Apple Mail, and other apps. Be direct and action-first.'
        },
        ...messages
      ],
      temperature: 0.3,
      max_tokens: 1024
    });

    const urlObj = new URL(GATEWAY_URL + '/chat/completions');
    const lib = urlObj.protocol === 'https:' ? https : http;

    const req = lib.request({
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...(OC_KEY ? { 'Authorization': 'Bearer ' + OC_KEY } : {})
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const d = JSON.parse(data);
          const content = d?.choices?.[0]?.message?.content;
          if (content) resolve(content);
          else reject(new Error(d?.error?.message || 'No content in gateway response'));
        } catch {
          reject(new Error('Invalid JSON from gateway'));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(90000, () => { req.destroy(); reject(new Error('Gateway request timed out')); });
    req.write(body);
    req.end();
  });
}

// ── WebSocket connection to relay ──────────────────────────────────────────

let ws = null;
let reconnectDelay = 2000;

function connect() {
  console.log(`[openmud-agent] Connecting to relay at ${RELAY_URL}...`);
  ws = new WebSocket(RELAY_URL);

  ws.on('open', () => {
    reconnectDelay = 2000;
    ws.send(JSON.stringify({ type: 'auth', token: TOKEN }));
  });

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'auth_ok') {
      console.log(`[openmud-agent] Connected. Waiting for messages from openmud.ai...`);
      console.log(`[openmud-agent] OpenClaw gateway: ${GATEWAY_URL}`);
      return;
    }

    // Incoming request from browser via relay
    if (msg.requestId && msg.messages) {
      console.log(`[openmud-agent] Request received: ${msg.requestId.slice(0, 8)}...`);
      try {
        const response = await callGateway(msg.messages, msg.model);
        console.log(`[openmud-agent] Response sent (${response.length} chars)`);
        ws.send(JSON.stringify({ type: 'response', requestId: msg.requestId, response }));
      } catch (err) {
        console.error(`[openmud-agent] Gateway error: ${err.message}`);
        ws.send(JSON.stringify({ type: 'response', requestId: msg.requestId, error: err.message }));
      }
    }
  });

  ws.on('close', () => {
    console.log(`[openmud-agent] Disconnected. Reconnecting in ${reconnectDelay / 1000}s...`);
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
  });

  ws.on('error', (err) => {
    console.error(`[openmud-agent] Connection error: ${err.message}`);
  });
}

connect();
