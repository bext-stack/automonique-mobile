// SPDX-License-Identifier: Elastic-2.0
// Keep query-string's CommonJS API while adopting the fixed ESM decoder.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const path = require.resolve('query-string');
assert.equal(require('query-string/package.json').version, '7.1.3');
const digest = (source) => createHash('sha256').update(source).digest('hex');
let source = readFileSync(path, 'utf8');
if (
  digest(source) ===
  'caa3f2c8b45dfe1e91db22ae10743af68de8d96f26515132bb52485ec0f037fa'
) {
  assert.equal(
    process.argv.includes('--check'),
    false,
    'Run npm ci with lifecycle scripts enabled',
  );
  source = source.replace(
    "const decodeComponent = require('decode-uri-component');",
    "const decodeComponent = require('decode-uri-component').default;",
  );
  assert.equal(
    digest(source),
    'fc1ca6e1961ba005e554b1bc0de932d6454bf59bfaea03d02c7261dbdcafcdbd',
  );
  writeFileSync(path, source);
}
assert.equal(
  digest(source),
  'fc1ca6e1961ba005e554b1bc0de932d6454bf59bfaea03d02c7261dbdcafcdbd',
  'Unreviewed query-string source',
);
const query = require('query-string');
assert.deepEqual(
  { ...query.parse('title=Fran%C3%A7ais&ticket=%23123') },
  { title: 'Français', ticket: '#123' },
);
assert.equal(query.stringify({ ticket: '#123' }), 'ticket=%23123');
assert.equal(query.parse('value=%E0%A4%A').value, '%E0%A4%A');
console.log(
  'query-string 7.1.3 uses the fixed decode-uri-component ESM export.',
);
