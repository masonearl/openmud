/**
 * Serves the latest downloadable openmud desktop archive.
 * Prefers a macOS zip asset and falls back to a DMG when needed.
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

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const debug = req.url && req.url.includes('debug=1');
  const publicDesktopUrl = (process.env.PUBLIC_DESKTOP_URL || process.env.PUBLIC_DMG_URL || '').trim();
  const releasesUrl = 'https://github.com/masonearl/openmud/releases';

  if (publicDesktopUrl) {
    if (debug) {
      return res.status(200).json({
        ok: true,
        source: 'PUBLIC_DESKTOP_URL',
        redirect_url: publicDesktopUrl,
      });
    }
    res.setHeader('Location', publicDesktopUrl);
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.status(302).end();
  }

  try {
    const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=20`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!response.ok) {
      const body = debug ? await response.text() : '';
      if (debug) {
        return res.status(200).json({
          ok: false,
          github_status: response.status,
          github_error: body.slice(0, 200),
        });
      }
      return res.redirect(302, releasesUrl);
    }

    const releases = await response.json();
    const release = pickLatestDesktopRelease(releases);
    const asset = pickDesktopAsset(release);
    if (!release || !asset) {
      if (debug) {
        return res.status(200).json({
          ok: false,
          reason: 'no_desktop_asset',
          release_tags: Array.isArray(releases) ? releases.map((item) => item && item.tag_name).filter(Boolean) : [],
        });
      }
      return res.redirect(302, releasesUrl);
    }

    if (debug) {
      return res.status(200).json({
        ok: true,
        tag: release.tag_name || '',
        asset_name: asset.name,
        redirect_url: asset.browser_download_url,
      });
    }

    res.setHeader('Location', asset.browser_download_url);
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.status(302).end();
  } catch (err) {
    if (debug) {
      return res.status(200).json({
        ok: false,
        error: err.message,
      });
    }
    return res.redirect(302, releasesUrl);
  }
};
