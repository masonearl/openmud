const { createClient } = require('@supabase/supabase-js');

/**
 * Get the authenticated user from the request's Authorization header.
 * Returns null if no valid JWT or auth fails.
 */
async function getUserFromRequest(req) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return null;

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;

  const supabase = createClient(url, serviceKey);
  const { data: { user }, error } = await supabase.auth.getUser(token);
  return error ? null : user;
}

module.exports = { getUserFromRequest };
