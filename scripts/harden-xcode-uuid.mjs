// SPDX-License-Identifier: Elastic-2.0
// xcode 4 removes uuid upstream. Verify the reviewed replacement instead of patching it.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const metadata = require('xcode/package.json');
assert.equal(metadata.version, '4.0.0');
assert.equal(metadata.dependencies?.uuid, undefined);
const source = readFileSync(require.resolve('xcode/lib/pbxProject.js'), 'utf8');
assert.equal(
  createHash('sha256').update(source).digest('hex'),
  '3333b63bcfab7c83b62c34129492c99dce7015e4cc4f7deacd943864cef17031',
);
assert.ok(source.includes('crypto.randomUUID()'));
assert.equal(source.includes("require('uuid')"), false);
const xcode = createRequire(import.meta.url)('xcode');
const project = xcode.project(
  '/nonexistent/Automonique.xcodeproj/project.pbxproj',
);
project.hash = { project: { objects: {} } };
const first = project.generateUuid();
const second = project.generateUuid();
assert.match(first, /^[0-9A-F]{24}$/);
assert.match(second, /^[0-9A-F]{24}$/);
assert.notEqual(first, second);

console.log(
  'xcode 4.0.0 uses native crypto.randomUUID without a uuid dependency.',
);
