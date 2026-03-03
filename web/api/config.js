// Returns public config (safe for client). Used by auth.js.
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  return res.status(200).json({
    supabaseUrl: url || '',
    supabaseAnonKey: anonKey || '',
  });
};
