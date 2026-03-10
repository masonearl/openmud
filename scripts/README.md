# Scripts

Build, release, and maintenance scripts used from the repository root.

## Common developer flows

| Command | What it runs | Purpose |
|---|---|---|
| `npm run dev` | `scripts/dev-wrapper.sh` | Start local web + desktop dev workflow. |
| `npm run dev:test` | `scripts/dev-and-test.sh` | Start dev environment and run validation checks. |
| `npm run build:test` | `scripts/build-and-verify.sh` | Build unsigned desktop app bundle, zip, and verify archive integrity. |
| `npm run release:desktop` | `scripts/release-desktop.js` | Bump desktop version, commit, tag, and push (`desktop-v*`) to trigger release workflow. |

## Script inventory

| File | Purpose |
|---|---|
| `scripts/release-desktop.js` | Desktop release automation (version bump + git tag/push). |
| `scripts/build-signed-local.js` | Local signed + notarized desktop build using keychain cert + `.env.signing`. |
| `scripts/build-and-verify.sh` | Local unsigned packaging test (`openmud.app` zip smoke check). |
| `scripts/dev-wrapper.sh` | Root dev bootstrap used by `npm run dev`. |
| `scripts/dev-from-symlink.sh` | Local static/site dev helper used by `dev:site`. |
| `scripts/dev-and-test.sh` | Combined dev/test helper. |
| `scripts/smoke-test.js` | Smoke checks for local build/runtime behavior. |
| `scripts/site-bot.js` | Synthetic site checks used in CI and local QA. |
| `scripts/setup-auth.js` | Auth setup helper for local/dev environment. |
| `scripts/generate-apple-jwt.js` | Utility for generating Apple auth JWTs. |
| `scripts/install-latest-dmg.sh` | Download/install latest desktop DMG helper. |
| `scripts/after-pack.js` | Electron post-pack hook used during desktop build. |
| `scripts/make_favicon.py` | Favicon generation utility. |
| `scripts/make_logo_transparent.py` | Logo processing utility. |
