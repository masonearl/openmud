const { setApiHeaders, handleOptions } = require('../_lib/auth');

module.exports = async function handler(req, res) {
  setApiHeaders(res);
  if (handleOptions(req, res)) return;

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const url = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const anonKey = String(process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();
  if (!url || !anonKey) {
    return res.status(200).json({ enabled: false });
  }

  return res.status(200).json({
    enabled: true,
    supabase_url: url,
    supabase_anon_key: anonKey,
  });
};
