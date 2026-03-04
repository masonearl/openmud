#!/usr/bin/env node
/**
 * Auth setup helper. Run: npm run setup:auth
 * - Creates web/.env from .env.example if missing
 * - Prints a checklist of manual steps
 */

const fs = require('fs');
const path = require('path');

const webDir = path.join(__dirname, '..', 'web');
const envExample = path.join(webDir, '.env.example');
const envFile = path.join(webDir, '.env');

function main() {
  console.log('\n=== openmud Auth Setup ===\n');

  // 1. Create .env if missing
  if (!fs.existsSync(envFile) && fs.existsSync(envExample)) {
    fs.copyFileSync(envExample, envFile);
    console.log('Created web/.env from .env.example');
    console.log('  → Edit web/.env and add your Supabase keys for local dev\n');
  } else if (fs.existsSync(envFile)) {
    const content = fs.readFileSync(envFile, 'utf8');
    const hasSupabase = /SUPABASE_URL=.+/.test(content) && !content.includes('your-project.supabase.co');
    if (hasSupabase) {
      console.log('web/.env exists with Supabase config\n');
    } else {
      console.log('web/.env exists – ensure SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY are set\n');
    }
  }

  // 2. Print manual steps
  console.log('Manual steps (cannot be automated):\n');
  console.log('  1. Supabase SQL');
  console.log('     → Dashboard → SQL Editor → New query');
  console.log('     → Paste contents of docs/supabase-users-table.sql');
  console.log('     → Run\n');
  console.log('  2. Enable Email auth');
  console.log('     → Authentication → Providers → Email → Enable → Save\n');
  console.log('  3. Redirect URLs');
  console.log('     → Authentication → URL Configuration');
  console.log('     → Add: https://openmud.ai/try, https://openmud.ai/settings.html');
  console.log('     → Add: http://localhost:3947/try, http://localhost:3947/settings.html\n');
  console.log('  4. Vercel env vars (you have these)');
  console.log('     → SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY\n');
  console.log('Full guide: docs/SETUP-AUTH.md\n');
}

main();
