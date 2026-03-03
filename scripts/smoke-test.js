#!/usr/bin/env node
/**
 * Smoke test for the openmud tool server.
 * Run with dev:local in another terminal first.
 *
 * Usage: npm run test:smoke
 */
const http = require('http');

const TOOL_SERVER = 'http://127.0.0.1:3847';

function get(path) {
  return new Promise((resolve, reject) => {
    const u = new URL(path, TOOL_SERVER);
    const req = http.request(
      { hostname: u.hostname, port: u.port || 3847, path: u.pathname, method: 'GET' },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function post(path, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(path, TOOL_SERVER);
    const data = JSON.stringify(body);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port || 3847,
        path: u.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      },
      (res) => {
        let out = '';
        res.on('data', (c) => { out += c; });
        res.on('end', () => resolve({ status: res.statusCode, body: out }));
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function run() {
  console.log('Smoke test: openmud tool server (port 3847)\n');

  try {
    const r = await get('/api/config');
    if (r.status !== 200) {
      console.error('FAIL /api/config:', r.status, r.body);
      process.exit(1);
    }
    console.log('  ✓ /api/config 200');
  } catch (e) {
    console.error('FAIL /api/config:', e.code || e.message);
    console.error('\n  Start the app first: npm run dev:local');
    process.exit(1);
  }

  try {
    const r = await post('/api/chat', {
      messages: [{ role: 'user', content: 'hi' }],
      model: 'mud1',
    });
    if (r.status !== 200) {
      console.error('FAIL /api/chat:', r.status, (r.body || '').slice(0, 200));
      process.exit(1);
    }
    const data = JSON.parse(r.body || '{}');
    if (!data.response) {
      console.error('FAIL /api/chat: no response field');
      process.exit(1);
    }
    console.log('  ✓ /api/chat (mud1) 200');
  } catch (e) {
    console.error('FAIL /api/chat:', e.message);
    process.exit(1);
  }

  console.log('\nAll smoke tests passed.\n');
}

run();
