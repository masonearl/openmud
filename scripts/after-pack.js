/**
 * electron-builder afterPack hook.
 * macOS 15 (Sequoia) sets com.apple.provenance on all executables and codesign
 * now rejects re-signing pre-signed binaries with "resource fork...detritus not allowed".
 * Fix: strip existing code signatures from every Mach-O binary in the .app BEFORE
 * electron-builder runs codesign, so it signs fresh with no prior signature detritus.
 */
const { execSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

function findMachOBinaries(dir) {
  const results = [];
  function walk(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.isFile()) continue;
      // Check for Mach-O magic bytes
      try {
        const fd = fs.openSync(full, 'r');
        const buf = Buffer.alloc(4);
        fs.readSync(fd, buf, 0, 4, 0);
        fs.closeSync(fd);
        const magic = buf.readUInt32BE(0);
        // MH_MAGIC_64, MH_CIGAM_64, FAT_MAGIC, FAT_CIGAM
        if (magic === 0xFEEDFACF || magic === 0xCFFAEDFE || magic === 0xCAFEBABE || magic === 0xBEBAFECA) {
          results.push(full);
        }
      } catch (_) {}
    }
  }
  walk(dir);
  return results;
}

exports.default = async function afterPack(context) {
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productName}.app`);
  console.log(`  • removing existing signatures + com.apple.provenance (macOS 15 codesign fix)`);
  const binaries = findMachOBinaries(appPath);
  let stripped = 0;
  let cleaned = 0;
  for (const bin of binaries) {
    const r = spawnSync('codesign', ['--remove-signature', bin], { encoding: 'utf8' });
    if (r.status === 0) stripped++;
    // macOS 15.3 sets com.apple.provenance on all executables; codesign treats it as detritus
    const x = spawnSync('xattr', ['-d', 'com.apple.provenance', bin], { encoding: 'utf8' });
    if (x.status === 0) cleaned++;
  }
  console.log(`    stripped sigs: ${stripped}/${binaries.length}, cleared provenance: ${cleaned}/${binaries.length}`);
};
