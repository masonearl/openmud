const { handleOAuthCallback } = require('../../_lib/emailTools');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).send('Method not allowed');
  }

  try {
    const result = await handleOAuthCallback(req);
    if (!result.ok) {
      return res.redirect(302, result.redirectTo || '/chat.html?email_connected=error');
    }
    return res.redirect(302, result.redirectTo || '/chat.html?email_connected=ok');
  } catch (err) {
    return res.redirect(302, '/chat.html?email_connected=error');
  }
};
