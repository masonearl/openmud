const { createClient } = require('@supabase/supabase-js');
const { decryptText, hashOpaqueCode } = require('../lib/secure-tokens');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const handoffCode = String((req.body && req.body.handoff_code) || '').trim();
  if (!handoffCode) {
    return res.status(400).json({ error: 'handoff_code required' });
  }

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  const supabase = createClient(url, serviceKey);
  const codeHash = hashOpaqueCode(handoffCode);

  try {
    const { data: row, error } = await supabase
      .from('desktop_auth_handoffs')
      .select('id, user_id, access_token_encrypted, refresh_token_encrypted, expires_at, consumed_at')
      .eq('code_hash', codeHash)
      .maybeSingle();

    if (error) throw error;
    if (!row) {
      return res.status(404).json({ error: 'Desktop sign-in code not found.' });
    }
    if (row.consumed_at) {
      return res.status(410).json({ error: 'Desktop sign-in code was already used.' });
    }
    if (row.expires_at && Date.parse(row.expires_at) < Date.now()) {
      await supabase.from('desktop_auth_handoffs').delete().eq('id', row.id);
      return res.status(410).json({ error: 'Desktop sign-in code expired. Try opening the app again.' });
    }

    const { data: updated, error: updateError } = await supabase
      .from('desktop_auth_handoffs')
      .update({ consumed_at: new Date().toISOString() })
      .eq('id', row.id)
      .is('consumed_at', null)
      .select('id')
      .maybeSingle();
    if (updateError) throw updateError;
    if (!updated) {
      return res.status(410).json({ error: 'Desktop sign-in code was already used.' });
    }

    console.log(JSON.stringify({
      event: 'desktop_handoff_redeemed',
      user_id: row.user_id,
      handoff_id: row.id,
    }));

    return res.status(200).json({
      access_token: decryptText(row.access_token_encrypted),
      refresh_token: decryptText(row.refresh_token_encrypted),
    });
  } catch (err) {
    console.error(JSON.stringify({
      event: 'desktop_handoff_redeem_failed',
      message: err.message || 'Unknown error',
    }));
    return res.status(500).json({ error: 'Desktop sign-in failed.' });
  }
};
