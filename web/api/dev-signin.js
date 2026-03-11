const { createClient } = require('@supabase/supabase-js');

function getHeader(req, name) {
  const value = req && req.headers ? req.headers[name.toLowerCase()] : '';
  if (Array.isArray(value)) return String(value[0] || '').trim();
  return String(value || '').trim();
}

function getBaseOrigin(req) {
  const proto = getHeader(req, 'x-forwarded-proto') || 'https';
  const host = getHeader(req, 'x-forwarded-host') || getHeader(req, 'host');
  if (!host) return 'https://openmud.ai';
  return `${proto}://${host}`;
}

function getSafeNextPath(value) {
  const next = String(value || '').trim();
  if (!next || next.charAt(0) !== '/' || next.indexOf('//') === 0) return '/try';
  if (/^\/welcome(?:\.html)?(?:[?#]|$)/i.test(next)) return '/try';
  return next;
}

async function ensureDevUser(adminClient, email) {
  try {
    const linkAttempt = await adminClient.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: {},
    });
    if (!linkAttempt.error) return true;
  } catch (_) {
    // fall through to create user
  }
  const created = await adminClient.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (created && created.error && !/already|exists|registered/i.test(String(created.error.message || ''))) {
    throw created.error;
  }
  return true;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const enabled = String(process.env.OPENMUD_DEV_SIGNIN_ENABLED || '').toLowerCase() === 'true';
  const token = String(process.env.OPENMUD_DEV_SIGNIN_TOKEN || '').trim();
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!enabled || !token) {
    return res.status(403).json({ error: 'Dev sign in is disabled.' });
  }
  if (!url || !serviceKey) {
    return res.status(500).json({ error: 'Server misconfigured.' });
  }

  const body = req.body || {};
  const providedToken = String(body.token || '').trim();
  if (!providedToken || providedToken !== token) {
    return res.status(401).json({ error: 'Invalid dev token.' });
  }

  const email = String(body.email || process.env.OPENMUD_DEV_SIGNIN_EMAIL || 'dev@openmud.ai').trim().toLowerCase();
  const nextPath = getSafeNextPath(body.next || '/try');
  const redirectTo = `${getBaseOrigin(req)}/welcome.html?next=${encodeURIComponent(nextPath)}`;
  const supabase = createClient(url, serviceKey);

  try {
    await ensureDevUser(supabase, email);
    const linkResult = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: { redirectTo },
    });
    if (linkResult.error) throw linkResult.error;
    const actionLink = linkResult.data
      && linkResult.data.properties
      && linkResult.data.properties.action_link;
    if (!actionLink) {
      return res.status(500).json({ error: 'Could not create dev auth link.' });
    }
    return res.status(200).json({
      ok: true,
      email,
      action_link: actionLink,
    });
  } catch (err) {
    console.error('Dev sign-in error:', err);
    return res.status(500).json({ error: err.message || 'Dev sign in failed.' });
  }
};
