const { checkAuth, setApiHeaders, handleOptions } = require('./_lib/auth');
const telemetry = require('./_lib/toolTelemetry');

module.exports = async function handler(req, res) {
  setApiHeaders(res);
  if (handleOptions(req, res)) return;

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = checkAuth(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.message });
  }

  return res.status(200).json(telemetry.snapshot());
};
