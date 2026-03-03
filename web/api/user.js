const { createClient } = require('@supabase/supabase-js');
const { getUserFromRequest } = require('./lib/auth');
const { getSubscriptionStatus } = require('./lib/subscription');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized', user: null });
  }

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return res.status(500).json({ error: 'Server misconfigured', user: null });
  }

  const supabase = createClient(url, serviceKey);
  const { id, email } = user;

  try {
    const { data: existing } = await supabase
      .from('users')
      .select('id, email, subscription_tier, created_at')
      .eq('id', id)
      .single();

    if (existing) {
      const subStatus = await getSubscriptionStatus(email);
      const tier = subStatus.tier || existing.subscription_tier || 'free';
      await supabase
        .from('users')
        .update({ subscription_tier: tier, updated_at: new Date().toISOString() })
        .eq('id', id);

      return res.status(200).json({
        user: {
          id: existing.id,
          email: existing.email,
          subscription_tier: tier,
          subscription_active: subStatus.active,
        },
      });
    }

    const subStatus = await getSubscriptionStatus(email);
    const { error: insertErr } = await supabase.from('users').insert({
      id,
      email: email || '',
      subscription_tier: subStatus.tier || 'free',
    });

    if (insertErr) {
      if (insertErr.code === '23505') {
        const { data: row } = await supabase.from('users').select('id, email, subscription_tier').eq('id', id).single();
        if (row) {
          return res.status(200).json({
            user: {
              id: row.id,
              email: row.email,
              subscription_tier: row.subscription_tier,
              subscription_active: subStatus.active,
            },
          });
        }
      }
      console.error('User upsert error:', insertErr);
      return res.status(500).json({ error: 'Failed to create user', user: null });
    }

    return res.status(200).json({
      user: {
        id,
        email: email || '',
        subscription_tier: subStatus.tier || 'free',
        subscription_active: subStatus.active,
      },
    });
  } catch (e) {
    console.error('User API error:', e);
    return res.status(500).json({ error: 'Server error', user: null });
  }
};
