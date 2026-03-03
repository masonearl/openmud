#!/usr/bin/env node
/**
 * Generate Apple Sign in with Apple client secret (JWT) for Supabase.
 *
 * Usage:
 *   node scripts/generate-apple-jwt.js
 *
 * You'll be prompted for:
 *   - Team ID (from Apple Developer account, 10 chars)
 *   - Key ID (from Keys page when you created the key)
 *   - Service ID (e.g. com.mudrag.web)
 *   - Path to .p8 file (e.g. ~/Desktop/AuthKey_XXXXXXXXXX.p8)
 *
 * Output: JWT to paste into Supabase → Authentication → Providers → Apple → Secret Key
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

function generateJWT(teamId, keyId, serviceId, privateKeyPath) {
  try {
    const jwt = require('jsonwebtoken');
    const key = fs.readFileSync(privateKeyPath, 'utf8');
    const now = Math.floor(Date.now() / 1000);
    const exp = now + 180 * 24 * 60 * 60; // 6 months

    const token = jwt.sign(
      {
        iss: teamId,
        iat: now,
        exp,
        aud: 'https://appleid.apple.com',
        sub: serviceId,
      },
      key,
      {
        algorithm: 'ES256',
        keyid: keyId,
      }
    );

    return token;
  } catch (e) {
    if (e.code === 'MODULE_NOT_FOUND') {
      console.error('\nRun: npm install jsonwebtoken');
      process.exit(1);
    }
    throw e;
  }
}

async function prompt(question, defaultValue = '') {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const def = defaultValue ? ` (${defaultValue})` : '';
  return new Promise((resolve) => {
    rl.question(question + def + ': ', (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue);
    });
  });
}

async function main() {
  let teamId, keyId, serviceId, p8Path;

  if (process.argv.length >= 5) {
    teamId = process.argv[2];
    keyId = process.argv[3];
    p8Path = process.argv[4].replace(/^~/, process.env.HOME || '');
    serviceId = process.argv[5] || 'com.mudrag.web';
  } else {
    console.log('\n=== Apple Sign in with Apple JWT Generator ===\n');
    console.log('Find these in Apple Developer:');
    console.log('  Team ID: developer.apple.com/account → Membership');
    console.log('  Key ID: Certificates, Identifiers & Profiles → Keys → your key');
    console.log('  Service ID: com.mudrag.web\n');

    teamId = await prompt('Team ID', '');
    keyId = await prompt('Key ID', '');
    serviceId = await prompt('Service ID', 'com.mudrag.web');
    let p8PathInput = await prompt('Path to .p8 file', '~/Desktop/AuthKey_XXXXXXXXXX.p8');
    p8Path = p8PathInput.replace(/^~/, process.env.HOME || '');
  }
  if (!fs.existsSync(p8Path)) {
    console.error('\nError: .p8 file not found at', p8Path);
    console.log('Your .p8 file might be named AuthKey_XXXXXXXXXX.p8 on your Desktop.');
    process.exit(1);
  }

  const token = generateJWT(teamId, keyId, serviceId, p8Path);

  console.log('\n--- Copy this JWT into Supabase ---\n');
  console.log(token);
  console.log('\n--- Supabase: Authentication → Providers → Apple → Secret Key ---\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
