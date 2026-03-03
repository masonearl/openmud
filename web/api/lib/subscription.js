const Stripe = require('stripe');

function priceIdToTier(priceId) {
  if (!priceId) return 'free';
  const env = process.env;
  if (priceId === env.STRIPE_PRICE_PERSONAL) return 'personal';
  if (priceId === env.STRIPE_PRICE_PRO || priceId === env.STRIPE_PRICE_ID) return 'pro';
  if (priceId === env.STRIPE_PRICE_EXECUTIVE) return 'executive';
  return 'pro';
}

const TIER_LIMITS = { free: 5, personal: 100, pro: null, executive: null };

async function getSubscriptionStatus(email) {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey || !email || typeof email !== 'string') {
    return { active: false, tier: 'free', limit: TIER_LIMITS.free };
  }

  const stripe = new Stripe(stripeSecretKey);
  try {
    const customers = await stripe.customers.list({ email: email.trim(), limit: 1 });
    if (customers.data.length === 0) return { active: false, tier: 'free', limit: TIER_LIMITS.free };

    const subs = await stripe.subscriptions.list({
      customer: customers.data[0].id,
      status: 'active',
      limit: 1,
      expand: ['data.items.data.price'],
    });

    if (subs.data.length === 0) return { active: false, tier: 'free', limit: TIER_LIMITS.free };

    const sub = subs.data[0];
    const priceId = sub.items?.data?.[0]?.price?.id || null;
    const tier = priceIdToTier(priceId);
    const limit = TIER_LIMITS[tier] != null ? TIER_LIMITS[tier] : TIER_LIMITS.free;
    return { active: true, tier, limit };
  } catch (e) {
    console.error('Subscription check error:', e);
    return { active: false, tier: 'free', limit: TIER_LIMITS.free };
  }
}

module.exports = { getSubscriptionStatus, priceIdToTier, TIER_LIMITS };
