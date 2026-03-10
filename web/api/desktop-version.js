/**
 * Returns the latest openmud desktop version and download URL.
 * Used by the desktop app for update checks.
 */
const GITHUB_REPO = 'masonearl/openmud';

function pickLatestDesktopRelease(releases) {
  if (!Array.isArray(releases)) return null;
  return releases.find((release) => {
    if (!release || release.draft || release.prerelease) return false;
    return Array.isArray(release.assets) && release.assets.some((asset) => {
      const name = String(asset && asset.name || '').toLowerCase();
      return name.endsWith('.zip') || name.endsWith('.dmg');
    });
  }) || null;
}

function pickDesktopAsset(release) {
  if (!release || !Array.isArray(release.assets)) return null;
  const zipAsset = release.assets.find((asset) => String(asset && asset.name || '').toLowerCase().endsWith('.zip'));
  if (zipAsset) return zipAsset;
  return release.assets.find((asset) => String(asset && asset.name || '').toLowerCase().endsWith('.dmg')) || null;
}

function parseDesktopVersion(tag) {
  return String(tag || '').replace(/^desktop-v/i, '').replace(/^v/i, '');
}

const handler = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Cache-Control', 'public, max-age=300');
  const publicDesktopUrl = (process.env.PUBLIC_DESKTOP_URL || process.env.PUBLIC_DMG_URL || '').trim();

  try {
    const headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    const token = process.env.GITHUB_TOKEN && process.env.GITHUB_TOKEN.trim();
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=20`,
      { headers }
    );
    if (!response.ok) {
      return res.status(502).json({ error: 'Could not fetch release' });
    }

    const releases = await response.json();
    const release = pickLatestDesktopRelease(releases);
    if (!release) {
      return res.status(404).json({ error: 'No desktop release asset is available yet.' });
    }
    const tag = release.tag_name || '';
    const version = parseDesktopVersion(tag);
    const asset = pickDesktopAsset(release);
    if (!asset) {
      return res.status(404).json({ error: 'No desktop release asset is available yet.' });
    }
    // Route app updates through our API so private GitHub assets still work.
    const url = publicDesktopUrl || 'https://openmud.ai/api/download-desktop';
    const assetName = String(asset.name || '');
    const assetKind = assetName.toLowerCase().endsWith('.dmg') ? 'dmg' : 'zip';

    res.status(200).json({ version, tag, url, asset_name: assetName, asset_kind: assetKind });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = handler;
