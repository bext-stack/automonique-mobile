// SPDX-License-Identifier: Elastic-2.0
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const metadata = JSON.parse(readFileSync(join(root, 'vendor/braces.json')));
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json')));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
assert.equal(
  sha256(readFileSync(join(root, 'vendor', metadata.archive))),
  metadata.archiveSha256,
);
const copies = Object.entries(lock.packages).filter(([path]) =>
  path.endsWith('/braces'),
);
assert.ok(copies.length > 0);
for (const [path, entry] of copies) {
  assert.equal(entry.version, metadata.version);
  assert.equal(entry.integrity, metadata.integrity);
  assert.equal(
    JSON.parse(readFileSync(join(root, path, 'package.json'))).version,
    metadata.version,
  );
  for (const [file, digests] of Object.entries(metadata.files)) {
    assert.equal(sha256(readFileSync(join(root, path, file))), digests.after);
  }
  const braces = require(join(root, path));
  const guarded = {
    name: 'SyntaxError',
    message: /nesting exceeds safety limit/,
  };
  for (const [open, close] of [
    ['{', '}'],
    ['(', ')'],
    ['{(', ')}'],
  ]) {
    for (const balanced of [true, false]) {
      const input =
        open.repeat(2000) + 'a,b' + (balanced ? close.repeat(2000) : '');
      for (const operation of [
        'parse',
        'compile',
        'expand',
        'stringify',
        'create',
      ]) {
        assert.throws(
          () => braces[operation](input),
          guarded,
          `${operation} must reject excessive nesting`,
        );
      }
    }
  }
  // AST consumers must enforce their own bound even when parsing was bypassed.
  for (const operation of ['compile', 'expand', 'stringify']) {
    const ast = { type: 'root', nodes: [] };
    let parent = ast;
    for (let depth = 0; depth < 12000; depth++) {
      const node = { type: 'paren', nodes: [], parent };
      parent.nodes.push(node);
      parent = node;
    }
    parent.nodes.push({ type: 'text', value: 'a' });
    assert.throws(() => braces[operation](ast), guarded);
  }
  assert.equal(
    braces.compile('src/{app,core}/**/*.{ts,tsx}'),
    'src/(app|core)/**/*.(ts|tsx)',
  );
  assert.deepEqual(braces.expand('x/{1..3}/{a,b}'), [
    'x/1/a',
    'x/1/b',
    'x/2/a',
    'x/2/b',
    'x/3/a',
    'x/3/b',
  ]);
  assert.equal(
    braces.stringify(braces.parse('src/{a,{b,c}}')),
    'src/{a,{b,c}}',
  );
  assert.equal(
    braces.stringify(braces.parse('{'.repeat(64) + 'a' + '}'.repeat(64))),
    '{'.repeat(64) + 'a' + '}'.repeat(64),
  );
  assert.deepEqual(braces.expand('{a,b'), ['{a,b']);
  assert.deepEqual(braces.expand('x/\\{a,b\\}'), ['x/{a,b}']);
  // Quoted delimiters are literals and must not consume the nesting budget.
  assert.equal(
    braces.stringify(braces.parse('"' + '{'.repeat(256) + '"')),
    '{'.repeat(256),
  );
}
console.log(
  `Verified ${copies.length} braces patch(es): pinned bytes, depth regressions, and normal glob behavior passed.`,
);
