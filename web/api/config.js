const fs = require('fs');
const path = require('path');

function readEnvValueFromFiles(keys) {
  const cwd = process.cwd();
  const candidates = [
    path.resolve(cwd, '.env.local'),
    path.resolve(cwd, '.env'),
    path.resolve(cwd, 'web/.env.local'),
    path.resolve(cwd, 'web/.env'),
    path.resolve(cwd, '../.env.local'),
    path.resolve(cwd, '../.env'),
  ];
  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;
    let content = '';
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (_) {
      continue;
    }
    for (const key of keys) {
      const re = new RegExp('^\\s*' + key + '\\s*=\\s*(.*)\\s*$', 'm');
      const m = content.match(re);
      if (!m || !m[1]) continue;
      let value = m[1].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (value) return value;
    }
  }
  return '';
}

// Returns public config (safe for client). Used by auth.js.
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const url =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    readEnvValueFromFiles(['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL']) ||
    '';
  const anonKey =
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    readEnvValueFromFiles(['SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY']) ||
    '';
  return res.status(200).json({
    enabled: !!(url && anonKey),
    supabaseUrl: url,
    supabaseAnonKey: anonKey,
  });
};
