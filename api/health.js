const { setApiHeaders, API_VERSION } = require('./_lib/auth');

module.exports = async function handler(req, res) {
  setApiHeaders(res);
  res.status(200).json({
    status: 'healthy',
    service: 'openmud',
    version: API_VERSION,
    endpoints: [
      'POST /api/chat',
      'POST /api/search',
      'POST /api/schedule',
      'POST /api/proposal',
      'POST /api/python/estimate',
      'POST /api/python/schedule',
      'POST /api/python/proposal',
      'GET  /api/python/rates',
      'GET  /api/health',
    ],
  });
};
