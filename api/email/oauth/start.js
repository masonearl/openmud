const { setApiHeaders, handleOptions } = require('../../_lib/auth');
const {
  GMAIL_PROVIDER,
  MICROSOFT_PROVIDER,
  getUserFromRequest,
  buildProviderAuthUrl,
} = require('../../_lib/emailTools');

module.exports = async function handler(req, res) {
  setApiHeaders(res);
  if (handleOptions(req, res)) return;

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { user } = await getUserFromRequest(req);
    const providerRaw = String(req.body?.provider || '').trim().toLowerCase();
    const provider = providerRaw === MICROSOFT_PROVIDER || providerRaw === GMAIL_PROVIDER ? providerRaw : null;
    if (!provider) {
      return res.status(400).json({ error: 'Unsupported provider. Use "gmail" or "microsoft".' });
    }

    const returnTo = String(req.body?.return_to || '/chat.html');
    const authUrl = await buildProviderAuthUrl(req, user.id, provider, returnTo);
    return res.status(200).json({ provider, auth_url: authUrl });
  } catch (err) {
    return res.status(400).json({ error: err?.message || 'Could not start OAuth flow.' });
  }
};
