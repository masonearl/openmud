const { setApiHeaders, handleOptions } = require('../_lib/auth');
const { getUserFromRequest, getUserConnections, toPublicConnection } = require('../_lib/emailTools');

module.exports = async function handler(req, res) {
  setApiHeaders(res);
  if (handleOptions(req, res)) return;

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { user } = await getUserFromRequest(req);
    const connections = await getUserConnections(user.id);
    return res.status(200).json({
      user: { id: user.id, email: user.email || null },
      connections: connections.map(toPublicConnection),
    });
  } catch (err) {
    return res.status(401).json({ error: err?.message || 'Unauthorized' });
  }
};
