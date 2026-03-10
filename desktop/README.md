# openmud Desktop

Electron desktop app for openmud.

## Local development

### Full stack (web API + desktop shell)

From repository root:

```bash
npm run dev
```

This runs the local web app and launches desktop pointed at local web (`PORT=3947` in dev scripts).

### Desktop app only

```bash
cd desktop
npm start
```

This launches the desktop shell directly.

## Build outputs (macOS)

From `desktop/`:

```bash
npm run build:dmg
```

Default artifact location: `desktop/dist/` (for example `openmud-<version>.dmg` and/or zip artifacts, depending on build mode).

## Local signed + notarized build

Use when testing signing locally (without GitHub Actions secrets):

1. Copy `desktop/.env.signing.example` to `desktop/.env.signing`.
2. Fill `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`.
3. Run:

```bash
cd desktop
npm run build:local
```

This uses `scripts/build-signed-local.js` to build, notarize, staple, and verify a zip artifact.

## Release runbook

From repository root:

```bash
npm run release:desktop
```

Optional version bump arg:

```bash
npm run release:desktop patch
npm run release:desktop minor
npm run release:desktop major
```

What this does:

1. Bumps `desktop/package.json` version.
2. Commits the version bump.
3. Creates and pushes tag `desktop-v<version>`.
4. Triggers `.github/workflows/release-desktop.yml`.

## CI behavior

`release-desktop.yml` builds on macOS when a `desktop-v*` tag is pushed (or manually via workflow dispatch).

- If signing secrets are present, CI builds signed `zip` and `dmg`.
- If signing secrets are absent, CI builds unsigned app bundle and zips `openmud.app`.

## Common pitfalls

1. Packaging scripts currently assume Node 20 for deterministic desktop build/test flow (`scripts/build-and-verify.sh` enforces this).
2. Missing Apple signing credentials will produce unsigned output in CI/local.
3. Auto-update checks use `/api/desktop-version`; releases without zip/dmg assets will not be picked up by updater endpoints.
