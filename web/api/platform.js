const { TIER_LIMITS } = require('./lib/usage');
const { getPublicModelCatalog } = require('./lib/model-policy');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  return res.status(200).json({
    beta_phase: true,
    default_model: 'mud1',
    tier_limits: TIER_LIMITS,
    notes: {
      mud1: 'mud1 is always free.',
      hosted_beta: 'A small hosted model set is available during beta with platform limits.',
      byok: 'You can always add your own provider keys in Settings.',
      subscriptions: 'Subscriptions can unlock more hosted access later without changing your saved setup.',
    },
    models: getPublicModelCatalog(),
  });
};
