/**
 * GET /api/dashboard?days=30
 * Returns usage analytics for the authenticated user.
 * Designed to be extended for iOS and other future sources.
 */
const { createClient } = require('@supabase/supabase-js');
const { getUserFromRequest } = require('./lib/auth');
const { getSubscriptionStatus } = require('./lib/subscription');
const { TIER_LIMITS } = require('./lib/usage');

const MODEL_LABELS = {
  'mud1':                      'mud1',
  'gpt-4o-mini':               'GPT-4o mini',
  'gpt-4o':                    'GPT-4o',
  'claude-3-haiku-20240307':   'Claude Haiku 3',
  'claude-haiku-4-5-20251001': 'Claude Haiku 4.5',
  'claude-sonnet-4-6':         'Claude Sonnet 4.6',
};

const SOURCE_LABELS = { web: 'Web', desktop: 'Desktop', ios: 'iOS' };

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Sign in required' });

  const days = Math.min(90, Math.max(1, parseInt(req.query.days || '30', 10)));

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return res.status(500).json({ error: 'Server misconfigured' });

  const supabase = createClient(url, key);

  // Subscription info
  const sub = await getSubscriptionStatus(user.email).catch(() => ({ tier: 'free' }));
  const tier = sub.tier || 'free';
  const limit = TIER_LIMITS[tier] != null ? TIER_LIMITS[tier] : null;

  // Fetch usage events for the past N days
  const since = new Date();
  since.setDate(since.getDate() - days + 1);
  since.setHours(0, 0, 0, 0);

  const { data: events, error } = await supabase
    .from('usage_events')
    .select('created_at, source, model, input_tokens, output_tokens, cost_microdollars, request_type')
    .eq('user_id', user.id)
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) {
    // Table may not exist yet — return zeros gracefully
    console.warn('[dashboard] usage_events query error:', error.message);
    return res.status(200).json({
      user: { email: user.email, tier, limit },
      totals: { messages: 0, input_tokens: 0, output_tokens: 0, cost_cents: 0 },
      daily: [],
      by_model: [],
      by_source: [],
      recent: [],
      days,
      needs_migration: false,
    });
  }

  const rows = events || [];

  // Aggregate totals
  const totals = rows.reduce((acc, r) => {
    acc.messages     += 1;
    acc.input_tokens  += r.input_tokens  || 0;
    acc.output_tokens += r.output_tokens || 0;
    acc.cost_microdollars += r.cost_microdollars || 0;
    return acc;
  }, { messages: 0, input_tokens: 0, output_tokens: 0, cost_microdollars: 0 });

  // Daily breakdown — fill every day in range with zeros
  const dailyMap = {};
  for (let i = 0; i < days; i++) {
    const d = new Date(since);
    d.setDate(d.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    dailyMap[key] = { date: key, messages: 0, cost_microdollars: 0 };
  }
  for (const r of rows) {
    const key = r.created_at.slice(0, 10);
    if (dailyMap[key]) {
      dailyMap[key].messages++;
      dailyMap[key].cost_microdollars += r.cost_microdollars || 0;
    }
  }
  const daily = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

  // By model
  const modelMap = {};
  for (const r of rows) {
    const m = r.model || 'unknown';
    if (!modelMap[m]) modelMap[m] = { model: m, label: MODEL_LABELS[m] || m, messages: 0, cost_microdollars: 0 };
    modelMap[m].messages++;
    modelMap[m].cost_microdollars += r.cost_microdollars || 0;
  }
  const by_model = Object.values(modelMap).sort((a, b) => b.messages - a.messages);

  // By source (web / desktop / ios)
  const sourceMap = {};
  for (const r of rows) {
    const s = r.source || 'web';
    if (!sourceMap[s]) sourceMap[s] = { source: s, label: SOURCE_LABELS[s] || s, messages: 0 };
    sourceMap[s].messages++;
  }
  const by_source = Object.values(sourceMap).sort((a, b) => b.messages - a.messages);

  // Recent events (last 50, formatted for the table)
  const recent = rows.slice(0, 50).map((r) => ({
    date: r.created_at,
    source: SOURCE_LABELS[r.source] || r.source,
    model: MODEL_LABELS[r.model] || r.model,
    input_tokens: r.input_tokens || 0,
    output_tokens: r.output_tokens || 0,
    cost_microdollars: r.cost_microdollars || 0,
    request_type: r.request_type || 'chat',
  }));

  return res.status(200).json({
    user: { email: user.email, tier, limit },
    totals,
    daily,
    by_model,
    by_source,
    recent,
    days,
  });
};
