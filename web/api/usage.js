const { getUserFromRequest } = require('./lib/auth');
const { getUsage, allocateUsage, logUsageEvent, detectSource } = require('./lib/usage');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({
      error: 'Sign in to view usage.',
      usage: null,
    });
  }

  try {
    const payload = req.body || {};
    if (req.method === 'GET') {
      const usage = await getUsage(user.id, user.email);
      return res.status(200).json({
        used: usage.used,
        limit: usage.limit,
        date: usage.date,
        tier: usage.tier || 'free',
      });
    }

    if (req.method === 'POST') {
      // increment=false is a sync/read mode for clients that already allocated usage elsewhere.
      var usageData;
      const shouldIncrement = payload.increment !== false;
      if (shouldIncrement) {
        const alloc = await allocateUsage(user.id, user.email);
        if (!alloc.allowed) {
          return res.status(429).json({
            error: `Daily limit reached (${alloc.used}/${alloc.limit}). Sign in at openmud.ai/settings for access.`,
            used: alloc.used,
            limit: alloc.limit,
            date: alloc.date,
          });
        }
        usageData = alloc;
      } else {
        usageData = await getUsage(user.id, user.email);
      }

      // Also record a detailed usage event for analytics/dashboard.
      // Desktop local Ollama calls this endpoint directly with token metadata.
      const shouldLogEvent = payload.log_event === true || (shouldIncrement && payload.log_event !== false);
      const model = payload.model || 'mud1';
      const requestType = payload.request_type || payload.requestType || 'chat';
      const source = payload.source || detectSource(req) || 'web';
      const inputTokensRaw = payload.input_tokens != null ? payload.input_tokens : payload.inputTokens;
      const outputTokensRaw = payload.output_tokens != null ? payload.output_tokens : payload.outputTokens;
      const inputTokens = Number.isFinite(Number(inputTokensRaw)) ? Math.max(0, Math.round(Number(inputTokensRaw))) : 0;
      const outputTokens = Number.isFinite(Number(outputTokensRaw)) ? Math.max(0, Math.round(Number(outputTokensRaw))) : 0;
      if (shouldLogEvent) {
        await logUsageEvent(user.id, {
          model,
          inputTokens,
          outputTokens,
          source,
          requestType,
        });
      }

      return res.status(200).json({
        used: usageData.used,
        limit: usageData.limit,
        date: usageData.date,
      });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('Usage API error:', e);
    return res.status(500).json({ error: 'Server error', usage: null });
  }
};
