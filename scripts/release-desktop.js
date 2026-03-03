#!/usr/bin/env node
/**
 * Release a new desktop app version.
 * Bumps version in desktop/package.json, commits, tags, and pushes.
 * Triggers GitHub Actions to build .dmg and create release.
 *
 * Usage: npm run release:desktop [patch|minor|major]
 * Default: patch (1.0.2 -> 1.0.3)
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const pkgPath = path.join(__dirname, '..', 'desktop', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const bump = process.argv[2] || 'patch';

const parts = pkg.version.split('.').map(Number);
if (bump === 'major') {
  parts[0]++;
  parts[1] = 0;
  parts[2] = 0;
} else if (bump === 'minor') {
  parts[1]++;
  parts[2] = 0;
} else {
  parts[2]++;
}
const newVersion = parts.join('.');

pkg.version = newVersion;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

const tag = `v${newVersion}`;
execSync('git add desktop/package.json', { stdio: 'inherit' });
execSync(`git commit -m "Release openmud ${newVersion}"`, { stdio: 'inherit' });
execSync(`git tag ${tag}`, { stdio: 'inherit' });
execSync('git push && git push origin ' + tag, { stdio: 'inherit' });

console.log(`\nReleased ${tag}. GitHub Actions will build and publish the .dmg.`);
console.log('Check https://github.com/masonearl/openmud/actions');
