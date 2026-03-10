const { createClient } = require('@supabase/supabase-js');
const { getUserFromRequest } = require('../lib/auth');
const { encryptText, generateOpaqueCode, hashOpaqueCode } = require('../lib/secure-tokens');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getUserFromRequest(req);
  if (!user || !user.id || !user.accessToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const refreshToken = String((req.body && req.body.refresh_token) || '').trim();
  if (!refreshToken) {
    return res.status(400).json({ error: 'refresh_token required' });
  }

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  const supabase = createClient(url, serviceKey);
  const handoffCode = generateOpaqueCode();
  const expiresAt = new Date(Date.now() + (5 * 60 * 1000)).toISOString();

  try {
    await supabase
      .from('desktop_auth_handoffs')
      .delete()
      .eq('user_id', user.id);

    const { error } = await supabase.from('desktop_auth_handoffs').insert({
      user_id: user.id,
      code_hash: hashOpaqueCode(handoffCode),
      access_token_encrypted: encryptText(user.accessToken),
      refresh_token_encrypted: encryptText(refreshToken),
      expires_at: expiresAt,
    });

    if (error) throw error;

    return res.status(200).json({
      handoff_code: handoffCode,
      expires_at: expiresAt,
    });
  } catch (err) {
    console.error(JSON.stringify({
      event: 'desktop_handoff_start_failed',
      user_id: user.id,
      message: err.message || 'Unknown error',
    }));
    return res.status(500).json({ error: 'Could not prepare desktop sign-in.' });
  }
};
