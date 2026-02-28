/**
 * openmud API auth helper
 *
 * API key auth is opt-in: set OPENMUD_API_KEY in environment to enable.
 * When not set, all requests are allowed (dev/open mode).
 *
 * Clients pass the key via:
 *   - Header:  x-api-key: <key>
 *   - Header:  Authorization: Bearer <key>
 *   - Body:    { "api_key": "<key>" }
 *
 * Future: swap this for a proper key management service
 * (Upstash, PlanetScale, or a simple KV store) to support
 * per-key rate limits, usage tracking, and tiered access.
 */

const API_VERSION = '1.0';

/**
 * Validate request auth. Returns { ok: true } or { ok: false, status, message }.
 */
function checkAuth(req) {
  const masterKey = process.env.OPENMUD_API_KEY;

  // No master key set → open mode (website's own usage, dev)
  if (!masterKey) return { ok: true };

  const fromHeader =
    req.headers['x-api-key'] ||
    (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  const fromBody = req.body && req.body.api_key;
  const provided = fromHeader || fromBody;

  if (!provided) {
    return { ok: false, status: 401, message: 'Missing API key. Pass x-api-key header or Authorization: Bearer <key>.' };
  }
  if (provided !== masterKey) {
    return { ok: false, status: 403, message: 'Invalid API key.' };
  }
  return { ok: true };
}

/**
 * Attach standard API response headers.
 */
function setApiHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key, Authorization');
  res.setHeader('X-API-Version', API_VERSION);
  res.setHeader('X-Powered-By', 'openmud');
}

/**
 * Handle OPTIONS preflight.
 */
function handleOptions(req, res) {
  if (req.method === 'OPTIONS') {
    setApiHeaders(res);
    res.status(200).end();
    return true;
  }
  return false;
}

module.exports = { checkAuth, setApiHeaders, handleOptions, API_VERSION };
