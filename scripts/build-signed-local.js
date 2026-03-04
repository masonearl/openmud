#!/usr/bin/env node
/**
 * Build + sign + notarize locally using cert from Keychain.
 * No .p12 export, no GitHub secrets.
 *
 * 1. cp desktop/.env.signing.example desktop/.env.signing
 * 2. Fill in APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID
 * 3. npm run build:local (from desktop/)
 */

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const desktopDir = path.join(__dirname, '..', 'desktop');
const envPath = path.join(desktopDir, '.env.signing');

if (!fs.existsSync(envPath)) {
  console.error('\nMissing .env.signing');
  console.error('  cp desktop/.env.signing.example desktop/.env.signing');
  console.error('  Then add: APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID\n');
  process.exit(1);
}

const envContent = fs.readFileSync(envPath, 'utf8');
const env = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'true' };
for (const line of envContent.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim();
}

console.log('Building with cert from Keychain (signed + notarized)...\n');
const r = spawnSync('npx', ['electron-builder', '--mac', 'dmg'], {
  cwd: desktopDir,
  stdio: 'inherit',
  env,
});

process.exit(r.status ?? 1);
