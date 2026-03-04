const Stripe = require('stripe');

const TIER_PRICE_ENV = {
  personal: 'STRIPE_PRICE_PERSONAL',
  pro: 'STRIPE_PRICE_PRO',
  executive: 'STRIPE_PRICE_EXECUTIVE',
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    return res.status(500).json({ error: 'Stripe not configured. Add STRIPE_SECRET_KEY to Vercel env vars.' });
  }

  const stripe = new Stripe(stripeSecretKey);
  const { priceId, tier, email, successUrl, cancelUrl } = req.body || {};

  let price = priceId;
  if (!price && tier && TIER_PRICE_ENV[tier]) {
    price = process.env[TIER_PRICE_ENV[tier]];
  }
  if (!price) {
    price = process.env.STRIPE_PRICE_PRO || process.env.STRIPE_PRICE_ID;
  }
  if (!price) {
    return res.status(400).json({ error: 'No price ID. Set STRIPE_PRICE_PRO (or STRIPE_PRICE_PERSONAL, STRIPE_PRICE_EXECUTIVE) in Vercel or pass priceId/tier in body.' });
  }

  const origin = req.headers.origin || req.headers.referer || 'https://openmud.ai';
  const base = origin.replace(/\/$/, '');
  const success = successUrl || base + '/subscribe-success.html';
  const successWithEmail = email
    ? success + (success.includes('?') ? '&' : '?') + 'email=' + encodeURIComponent(email)
    : success;
  const cancel = cancelUrl || base + '/automations.html';

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price, quantity: 1 }],
      success_url: successWithEmail + (successWithEmail.includes('?') ? '&' : '?') + 'session_id={CHECKOUT_SESSION_ID}',
      cancel_url: cancel,
      customer_email: email || undefined,
      metadata: { source: 'mudrag' },
      subscription_data: {
        metadata: { source: 'mudrag', tier: tier || 'pro' },
      },
    });
    return res.status(200).json({ url: session.url, sessionId: session.id });
  } catch (e) {
    console.error('Stripe checkout error:', e);
    return res.status(500).json({ error: e.message || 'Checkout failed' });
  }
};
