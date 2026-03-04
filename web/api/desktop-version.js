/**
 * Returns the latest openmud desktop version and download URL.
 * Used by the desktop app for update checks.
 */
const handler = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Cache-Control', 'public, max-age=300');
  const publicDmgUrl = process.env.PUBLIC_DMG_URL && process.env.PUBLIC_DMG_URL.trim();

  try {
    const headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    const token = process.env.GITHUB_TOKEN && process.env.GITHUB_TOKEN.trim();
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(
      'https://api.github.com/repos/masonearl/openmud.ai/releases/latest',
      { headers }
    );
    if (!response.ok) {
      return res.status(502).json({ error: 'Could not fetch release' });
    }

    const release = await response.json();
    const tag = release.tag_name || '';
    const version = tag.replace(/^v/, '');
    const dmgAsset = release.assets?.find((a) =>
      a.name && a.name.toLowerCase().endsWith('.dmg')
    );
    // Route app updates through our API so private GitHub assets still work.
    const url = publicDmgUrl || 'https://openmud.ai/api/download-dmg';

    res.status(200).json({ version, tag, url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = handler;
