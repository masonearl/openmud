const Stripe = require('stripe');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripeSecretKey || !webhookSecret) {
    console.error('Stripe webhook: missing STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET');
    return res.status(500).end();
  }

  const stripe = new Stripe(stripeSecretKey);
  const rawBody = req.body;
  if (!rawBody) {
    return res.status(400).end();
  }
  const raw = typeof rawBody === 'string' ? rawBody : Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : JSON.stringify(rawBody);

  let event;
  try {
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(raw, sig, webhookSecret);
  } catch (e) {
    console.error('Webhook signature verification failed:', e.message);
    return res.status(400).end();
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      if (session.mode === 'subscription' && session.subscription) {
        console.log('Subscription created:', session.subscription, 'customer:', session.customer);
      }
      break;
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      console.log('Subscription', event.type, sub.id, 'status:', sub.status);
      break;
    }
    default:
      break;
  }

  return res.status(200).end();
};
