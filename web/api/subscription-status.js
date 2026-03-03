const { getSubscriptionStatus } = require('./lib/subscription');
const { getUserFromRequest } = require('./lib/auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ active: false, tier: 'free' });
  }

  const user = await getUserFromRequest(req);
  let email = null;
  if (user && user.email) {
    email = user.email;
  } else {
    const { email: bodyEmail } = req.body || {};
    if (bodyEmail && typeof bodyEmail === 'string') email = bodyEmail;
  }

  if (!email) {
    return res.status(200).json({ active: false, tier: 'free' });
  }

  const status = await getSubscriptionStatus(email);
  return res.status(200).json({ active: status.active, tier: status.tier });
};
