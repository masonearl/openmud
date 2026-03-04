/**
 * Serves the latest openmud .dmg from GitHub Releases.
 * - With GITHUB_TOKEN (private repo): streams the .dmg through this API (no redirect).
 * - Without token (public repo): redirects to the GitHub asset URL.
 * Add ?debug=1 to get JSON diagnostic info instead of download.
 */
const { Readable } = require('stream');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const debug = req.url && req.url.includes('debug=1');
  const publicDmgUrl = process.env.PUBLIC_DMG_URL && process.env.PUBLIC_DMG_URL.trim();
  const token = process.env.GITHUB_TOKEN && process.env.GITHUB_TOKEN.trim();
  const releasesUrl = 'https://github.com/masonearl/openmud.ai/releases/latest';

  // Prefer explicit public hosting (Vercel Blob/S3/R2) when configured.
  if (publicDmgUrl) {
    if (debug) {
      return res.status(200).json({
        ok: true,
        source: 'PUBLIC_DMG_URL',
        redirect_url: publicDmgUrl,
        has_token: !!token,
      });
    }
    res.setHeader('Location', publicDmgUrl);
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.status(302).end();
  }

  try {
    const headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    const response = await fetch(
      'https://api.github.com/repos/masonearl/openmud.ai/releases/latest',
      { headers }
    );

    if (!response.ok) {
      if (debug) {
        const body = await response.text();
        return res.status(200).json({
          ok: false,
          github_status: response.status,
          github_error: body.slice(0, 200),
          has_token: !!token,
          has_public_dmg_url: !!publicDmgUrl,
        });
      }
      if (publicDmgUrl) {
        res.setHeader('Location', publicDmgUrl);
        res.setHeader('Cache-Control', 'no-store, max-age=0');
        return res.status(302).end();
      }

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(503).send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Download unavailable</title>
  </head>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 32px; line-height: 1.5;">
    <h1>Download temporarily unavailable</h1>
    <p>We could not fetch the latest openmud release right now.</p>
    <p>Please try again shortly or contact <a href="mailto:hi@masonearl.com">hi@masonearl.com</a>.</p>
    <p><a href="${releasesUrl}">GitHub releases</a></p>
  </body>
</html>`);
    }

    const release = await response.json();
    const dmgAsset = release.assets?.find((a) =>
      a.name && a.name.toLowerCase().endsWith('.dmg')
    );

    if (!dmgAsset) {
      if (debug) {
        return res.status(200).json({
          ok: false,
          reason: 'no_dmg_asset',
          asset_names: release.assets?.map((a) => a.name) || [],
          has_public_dmg_url: !!publicDmgUrl,
        });
      }
      if (publicDmgUrl) {
        res.setHeader('Location', publicDmgUrl);
        res.setHeader('Cache-Control', 'no-store, max-age=0');
        return res.status(302).end();
      }
      return res.redirect(302, releasesUrl);
    }

    if (debug) {
      return res.status(200).json({
        ok: true,
        proxy: !!token,
        redirect_url: dmgAsset.browser_download_url,
        asset_name: dmgAsset.name,
      });
    }

    // Private repo: stream the .dmg through this API (bypasses 404 on direct GitHub URL)
    if (token && dmgAsset.id) {
      const assetRes = await fetch(
        `https://api.github.com/repos/masonearl/openmud.ai/releases/assets/${dmgAsset.id}`,
        {
          headers: {
            Accept: 'application/octet-stream',
            Authorization: `Bearer ${token}`,
            'X-GitHub-Api-Version': '2022-11-28',
          },
          redirect: 'follow',
        }
      );
      if (!assetRes.ok) {
        if (publicDmgUrl) {
          res.setHeader('Location', publicDmgUrl);
          res.setHeader('Cache-Control', 'no-store, max-age=0');
          return res.status(302).end();
        }
        return res.redirect(302, releasesUrl);
      }
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${dmgAsset.name}"`);
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      const contentLength = assetRes.headers.get('content-length');
      if (contentLength) res.setHeader('Content-Length', contentLength);
      Readable.fromWeb(assetRes.body).pipe(res);
      return;
    }

    // Optional explicit override for public hosting (S3/R2/etc)
    if (publicDmgUrl) {
      res.setHeader('Location', publicDmgUrl);
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      return res.status(302).end();
    }

    // Public repo: redirect to GitHub
    res.setHeader('Location', dmgAsset.browser_download_url);
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.status(302).end();
  } catch (err) {
    if (debug) {
      return res.status(200).json({
        ok: false,
        error: err.message,
        has_token: !!token,
        has_public_dmg_url: !!publicDmgUrl,
      });
    }
    if (publicDmgUrl) {
      res.setHeader('Location', publicDmgUrl);
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      return res.status(302).end();
    }
    res.redirect(302, releasesUrl);
  }
};
