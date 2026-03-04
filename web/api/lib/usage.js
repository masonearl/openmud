const { createClient } = require('@supabase/supabase-js');
const { getSubscriptionStatus } = require('./subscription');

const TIER_LIMITS = { free: 5, personal: 100, pro: null, executive: null };

// Cost per 1M tokens in microdollars (1 USD = 1,000,000 microdollars).
// mud1 uses gpt-4o under the hood. Update these as pricing changes.
const MODEL_PRICING = {
  'mud1':                    { input: 5_000_000, output: 15_000_000 }, // gpt-4o
  'gpt-4o':                  { input: 5_000_000, output: 15_000_000 },
  'gpt-4o-mini':             { input:   150_000, output:    600_000 },
  'claude-3-haiku-20240307': { input:   250_000, output:  1_250_000 },
  'claude-haiku-4-5-20251001':{ input:  800_000, output:  4_000_000 },
  'claude-sonnet-4-6':       { input: 3_000_000, output: 15_000_000 },
};

function computeCostMicrodollars(model, inputTokens, outputTokens) {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING['gpt-4o-mini'];
  const inCost  = Math.round((inputTokens  / 1_000_000) * pricing.input);
  const outCost = Math.round((outputTokens / 1_000_000) * pricing.output);
  return inCost + outCost;
}

/**
 * Detect request source from HTTP headers.
 * Desktop sends User-Agent containing 'mudrag-desktop', or X-openmud-Source header.
 * iOS will send X-openmud-Source: ios.
 */
function detectSource(req) {
  const explicit = (req.headers['x-mudrag-source'] || '').toLowerCase();
  if (explicit === 'desktop') return 'desktop';
  if (explicit === 'ios')     return 'ios';
  if (/mudrag-desktop/i.test(req.headers['user-agent'] || '')) return 'desktop';
  return 'web';
}

/**
 * Log a single AI request to usage_events. Fire-and-forget — never throws.
 * @param {string} userId
 * @param {{ model: string, inputTokens: number, outputTokens: number, source: string, requestType: string }} opts
 */
async function logUsageEvent(userId, { model = 'mud1', inputTokens = 0, outputTokens = 0, source = 'web', requestType = 'chat' } = {}) {
  try {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key || !userId) return;
    const supabase = createClient(url, key);
    const costMicrodollars = computeCostMicrodollars(model, inputTokens, outputTokens);
    await supabase.from('usage_events').insert({
      user_id: userId,
      source,
      model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_microdollars: costMicrodollars,
      request_type: requestType,
    });
  } catch (e) {
    console.error('[usage] logUsageEvent failed:', e.message);
  }
}

module.exports.logUsageEvent   = logUsageEvent;
module.exports.detectSource    = detectSource;
module.exports.MODEL_PRICING   = MODEL_PRICING;
module.exports.computeCostMicrodollars = computeCostMicrodollars;

function getLimitForTier(tier) {
  return TIER_LIMITS[tier] != null ? TIER_LIMITS[tier] : TIER_LIMITS.free;
}

/**
 * Get today's usage count for a user. Requires email for subscription lookup.
 */
async function getUsage(userId, email) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !userId) {
    return { used: 0, limit: TIER_LIMITS.free, date: new Date().toISOString().slice(0, 10) };
  }

  const supabase = createClient(url, key);
  const today = new Date().toISOString().slice(0, 10);

  const subStatus = email ? await getSubscriptionStatus(email) : { tier: 'free', limit: TIER_LIMITS.free };
  const limit = subStatus.limit != null ? subStatus.limit : getLimitForTier(subStatus.tier || 'free');

  const { data: row } = await supabase
    .from('usage_daily')
    .select('count')
    .eq('user_id', userId)
    .eq('date', today)
    .single();

  const used = (row && row.count) || 0;
  return { used, limit, date: today, tier: subStatus.tier || 'free' };
}

/**
 * Increment usage for today. Returns new count. Call only after successful chat.
 * Uses atomic RPC to avoid race conditions.
 */
async function incrementUsage(userId) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !userId) return { used: 0 };

  const supabase = createClient(url, key);
  const { data: count, error } = await supabase.rpc('increment_usage_daily', { p_user_id: userId });
  if (error) {
    console.error('Usage increment error:', error);
    return { used: 0 };
  }
  return { used: count != null ? count : 0 };
}

/**
 * Check if user can send a message. If yes, return { allowed: true, used, limit }.
 * If over limit, return { allowed: false, used, limit }.
 */
async function checkUsage(userId, email) {
  const usage = await getUsage(userId, email);
  const { used, limit } = usage;
  if (limit != null && used >= limit) {
    return { allowed: false, ...usage };
  }
  return { allowed: true, ...usage };
}

/**
 * Allocate one usage (check + increment). Call before processing chat.
 * Returns { allowed: true, used, limit } if ok, { allowed: false, used, limit } if over limit.
 */
async function allocateUsage(userId, email) {
  const check = await checkUsage(userId, email);
  if (!check.allowed) return check;
  const inc = await incrementUsage(userId);
  return { allowed: true, used: inc.used, limit: check.limit, date: check.date };
}

module.exports = {
  getUsage, incrementUsage, checkUsage, allocateUsage, getLimitForTier, TIER_LIMITS,
  logUsageEvent, detectSource, MODEL_PRICING, computeCostMicrodollars,
};
