// SPDX-License-Identifier: Elastic-2.0

// Rebuild the downstream security backport from the integrity-pinned npm release.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = '1.4.1-automonique.1';
const upstreamIntegrity =
  'sha512-LarFH0+6VfriEhqMMcLX2F7SwSXeWwnEAJEsYm5QKWchiVYVvJyV9v7UDvUv+w5HO23ZpQTXDv/GxdDdMyOuoQ==';
const upstreamUrl =
  'https://registry.npmjs.org/node-forge/-/node-forge-1.4.0.tgz';
const upstreamFix = 'https://github.com/digitalbazaar/forge/pull/1152';
const upstreamFixCommit = 'ceba34402e329f0365134f23fe19898756527d65';
const temporary = mkdtempSync(join(tmpdir(), 'forge-backport-'));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
try {
  const response = await fetch(upstreamUrl);
  assert.equal(response.ok, true);
  const archive = Buffer.from(await response.arrayBuffer());
  assert.equal(
    `sha512-${createHash('sha512').update(archive).digest('base64')}`,
    upstreamIntegrity,
  );
  const originalArchive = join(temporary, 'upstream.tgz');
  writeFileSync(originalArchive, archive);
  execFileSync('tar', ['-xzf', originalArchive, '-C', temporary]);
  const packageRoot = join(temporary, 'package');
  const sourcePath = join(packageRoot, 'lib/rsa.js');
  const before = readFileSync(sourcePath, 'utf8');
  const fragment = '            obj.value.length !== 2) {';
  assert.equal(before.split(fragment).length, 2);
  const after = before
    .replace(
      fragment,
      "            obj.value.length !== 2 ||\n            obj.value[0].value.length !==\n              (('parameters' in capture) ? 2 : 1)) {",
    )
    .replace(
      '// validate DigestInfo structure and element count',
      '// validate outer and nested DigestInfo element counts (CVE-2026-85393)',
    );
  writeFileSync(sourcePath, after);
  const manifestPath = join(packageRoot, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.version, '1.4.0');
  manifest.version = version;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const result = JSON.parse(
    execFileSync(
      'npm',
      [
        'pack',
        '--ignore-scripts',
        '--json',
        '--pack-destination',
        join(root, 'vendor'),
      ],
      { cwd: packageRoot, encoding: 'utf8' },
    ),
  )[0];
  const metadata = {
    name: 'node-forge',
    version,
    description:
      'Downstream security backport; not an upstream node-forge release.',
    advisory: 'https://github.com/advisories/GHSA-86w9-cpqp-85rv',
    upstreamUrl,
    upstreamIntegrity,
    upstreamFix,
    upstreamFixCommit,
    originalRsaSha256: sha256(before),
    patchedRsaSha256: sha256(after),
    archive: result.filename,
    archiveSha256: sha256(readFileSync(join(root, 'vendor', result.filename))),
    integrity: result.integrity,
    license: 'BSD-3-Clause (upstream dual-license option)',
  };
  writeFileSync(
    join(root, 'vendor/node-forge.json'),
    `${JSON.stringify(metadata, null, 2)}\n`,
  );
  console.log(`Packed ${result.filename}; upstream BSD license retained.`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
