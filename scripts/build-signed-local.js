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
const env = {
  ...process.env,
  CSC_IDENTITY_AUTO_DISCOVERY: 'true',
  CI: '',
};
for (const line of envContent.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim();
}

const appVersion = JSON.parse(fs.readFileSync(path.join(desktopDir, 'package.json'), 'utf8')).version;
const distDir = path.join(desktopDir, 'dist');
const appDir = path.join(distDir, 'mac-arm64');
const appPath = path.join(appDir, 'openmud.app');
const zipPath = path.join(distDir, `openmud-${appVersion}-arm64.zip`);

function run(command, args, opts) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    ...opts,
  });
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log('Building with cert from Keychain (signed + notarized)...\n');
run('npx', ['electron-builder', '--mac', 'dir', '--publish', 'never'], {
  cwd: desktopDir,
  env,
});

if (!fs.existsSync(appPath)) {
  console.error(`\nExpected app bundle not found: ${appPath}\n`);
  process.exit(1);
}

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
run('zip', ['-qry', zipPath, 'openmud.app'], { cwd: appDir, env });

console.log('\nSubmitting zip to Apple notarization...');
run('xcrun', [
  'notarytool',
  'submit',
  zipPath,
  '--apple-id', env.APPLE_ID,
  '--password', env.APPLE_APP_SPECIFIC_PASSWORD,
  '--team-id', env.APPLE_TEAM_ID,
  '--wait',
], { env });

console.log('\nStapling notarization ticket to app...');
run('xcrun', ['stapler', 'staple', appPath], { env });

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
run('zip', ['-qry', zipPath, 'openmud.app'], { cwd: appDir, env });

console.log('\nVerifying Gatekeeper acceptance...');
run('spctl', ['--assess', '--type', 'execute', '-vv', appPath], { env });

console.log(`\nSigned and notarized desktop build ready:\n${zipPath}\n`);
