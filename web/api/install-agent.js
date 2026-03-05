'use strict';

// Serves the install.sh script from GitHub raw so users can run:
// curl -fsSL https://openmud.ai/install-agent | bash -s -- --token TOKEN

const https = require('https');

const SCRIPT_URL = 'https://raw.githubusercontent.com/masonearl/openmud/main/relay/install.sh';

module.exports = async (req, res) => {
  try {
    const script = await new Promise((resolve, reject) => {
      https.get(SCRIPT_URL, { headers: { 'User-Agent': 'openmud-install' } }, r => {
        let data = '';
        r.on('data', c => { data += c; });
        r.on('end', () => resolve(data));
      }).on('error', reject);
    });
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.status(200).send(script);
  } catch (e) {
    res.status(500).send('# Error fetching installer: ' + e.message + '\n');
  }
};
