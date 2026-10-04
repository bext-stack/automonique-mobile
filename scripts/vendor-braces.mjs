// SPDX-License-Identifier: Elastic-2.0
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = '3.0.4-automonique.1';
const upstreamUrl = 'https://registry.npmjs.org/braces/-/braces-3.0.3.tgz';
const upstreamIntegrity =
  'sha512-yQbXgO/OSZVD2IsiLlro+7Hf6Q18EJrKSEsdoMzKePKXct3gvD8oLcOQdIzGupr5Fj+EDe8gO/lxc1BzfMpxvA==';
const temporary = mkdtempSync(join(tmpdir(), 'braces-hardening-'));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const guard =
  "if (depth > 128) throw new SyntaxError('Brace nesting exceeds safety limit (128)');";
try {
  const response = await fetch(upstreamUrl);
  assert.equal(response.ok, true);
  const archive = Buffer.from(await response.arrayBuffer());
  assert.equal(
    `sha512-${createHash('sha512').update(archive).digest('base64')}`,
    upstreamIntegrity,
  );
  writeFileSync(join(temporary, 'upstream.tgz'), archive);
  execFileSync('tar', [
    '-xzf',
    join(temporary, 'upstream.tgz'),
    '-C',
    temporary,
  ]);
  const packageRoot = join(temporary, 'package');
  const files = {};
  const patch = (file, edits) => {
    const before = readFileSync(join(packageRoot, file), 'utf8');
    let after = before;
    for (const [from, to, count = 1] of edits) {
      assert.equal(
        after.split(from).length - 1,
        count,
        `Unexpected source in ${file}`,
      );
      after = after.replaceAll(from, to);
    }
    writeFileSync(join(packageRoot, file), after);
    files[file] = { before: sha256(before), after: sha256(after) };
  };
  // Bound the parser's explicit stack before it can call recursive helpers.
  // This covers braces and parentheses, including unbalanced input.
  patch('lib/parse.js', [
    [
      '      stack.push(block);',
      "      if (stack.length > 128) throw new SyntaxError('Brace nesting exceeds safety limit (128)');\n      stack.push(block);",
      2,
    ],
  ]);
  // The public APIs also accept caller-supplied ASTs, bypassing the parser.
  for (const file of ['lib/compile.js', 'lib/expand.js']) {
    patch(file, [
      [
        'const walk = (node, parent = {}) => {',
        `const walk = (node, parent = {}, depth = 0) => {\n    ${guard}`,
      ],
      ['walk(child, node)', 'walk(child, node, depth + 1)'],
    ]);
  }
  patch('lib/stringify.js', [
    [
      'const stringify = (node, parent = {}) => {',
      `const stringify = (node, parent = {}, depth = 0) => {\n    ${guard}`,
    ],
    ['stringify(child)', 'stringify(child, {}, depth + 1)'],
  ]);
  const manifestPath = join(packageRoot, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.version, '3.0.3');
  manifest.version = version;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const packed = JSON.parse(
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
  writeFileSync(
    join(root, 'vendor/braces.json'),
    `${JSON.stringify(
      {
        name: 'braces',
        version,
        description:
          'Downstream depth-guard patch; not an upstream braces release.',
        advisory: 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm',
        upstreamUrl,
        upstreamIntegrity,
        files,
        archive: packed.filename,
        archiveSha256: sha256(
          readFileSync(join(root, 'vendor', packed.filename)),
        ),
        integrity: packed.integrity,
        license: 'MIT',
      },
      null,
      2,
    )}\n`,
  );
  console.log(`Packed ${packed.filename}; upstream MIT license retained.`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
