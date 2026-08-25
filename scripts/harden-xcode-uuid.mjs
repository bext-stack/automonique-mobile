// SPDX-License-Identifier: Elastic-2.0

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import {
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.slice(2).includes('--check');
const xcodeRoot = join(root, 'node_modules', 'xcode');
const xcodePackagePath = join(xcodeRoot, 'package.json');
const projectPath = join(xcodeRoot, 'lib', 'pbxProject.js');

const EXPECTED_XCODE_VERSION = '3.0.1';
const EXPECTED_UUID_RANGE = '^7.0.3';
const REQUIRED_UUID_VERSION = '14.0.2';
const PRISTINE_SHA256 =
  'c4e97f21f0c4aed9a818b3f011ee0ad577a7899db8af2be243d1d7c08ba403fc';
const HARDENED_SHA256 =
  '4fb4c087a31ee1ca2d26adbd0e77d172c36004f437b904b861e2b0111517e264';
const UUID_IMPORT = "    uuid = require('uuid'),";
const CRYPTO_IMPORT = "    crypto = require('crypto'),";
const UUID_CALL = '    var id = uuid.v4()';
const CRYPTO_CALL = '    var id = crypto.randomUUID()';

function sha256(contents) {
  return createHash('sha256').update(contents).digest('hex');
}

function replaceExactlyOnce(contents, before, after) {
  assert.equal(
    contents.split(before).length - 1,
    1,
    `xcode source must contain exactly one expected fragment: ${before.trim()}`,
  );
  return contents.replace(before, after);
}

function verifyDependencyContract() {
  const xcodePackage = JSON.parse(readFileSync(xcodePackagePath, 'utf8'));
  assert.equal(
    xcodePackage.version,
    EXPECTED_XCODE_VERSION,
    'refusing to patch an unreviewed xcode release',
  );
  assert.equal(
    xcodePackage.dependencies?.uuid,
    EXPECTED_UUID_RANGE,
    'refusing to patch an unreviewed xcode uuid dependency contract',
  );

  const requireFromXcode = createRequire(xcodePackagePath);
  const uuidPackagePath = requireFromXcode.resolve('uuid/package.json');
  const uuidPackage = JSON.parse(readFileSync(uuidPackagePath, 'utf8'));
  assert.equal(
    uuidPackage.version,
    REQUIRED_UUID_VERSION,
    'xcode must resolve the reviewed, non-vulnerable uuid override',
  );
  assert.equal(
    uuidPackage.type,
    'module',
    'the uuid override contract changed; review the xcode hardening again',
  );
}

function verifyHardenedSource(contents) {
  assert.equal(
    sha256(contents),
    HARDENED_SHA256,
    'xcode hardening does not match the reviewed source digest',
  );
  assert.equal(contents.includes(UUID_IMPORT), false);
  assert.equal(contents.includes(UUID_CALL), false);
  assert.equal(contents.split(CRYPTO_IMPORT).length - 1, 1);
  assert.equal(contents.split(CRYPTO_CALL).length - 1, 1);
}

verifyDependencyContract();

let source = readFileSync(projectPath, 'utf8');
const sourceDigest = sha256(source);

if (sourceDigest === PRISTINE_SHA256) {
  assert.equal(
    checkOnly,
    false,
    'xcode is not hardened; run npm ci with lifecycle scripts enabled',
  );
  source = replaceExactlyOnce(source, UUID_IMPORT, CRYPTO_IMPORT);
  source = replaceExactlyOnce(source, UUID_CALL, CRYPTO_CALL);
  verifyHardenedSource(source);

  const temporaryPath = `${projectPath}.${process.pid}.${randomUUID()}.tmp`;
  const mode = statSync(projectPath).mode;
  try {
    writeFileSync(temporaryPath, source, { encoding: 'utf8', mode });
    renameSync(temporaryPath, projectPath);
  } finally {
    try {
      unlinkSync(temporaryPath);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
} else if (sourceDigest !== HARDENED_SHA256) {
  assert.fail(
    `refusing to patch unreviewed xcode source (sha256:${sourceDigest})`,
  );
}

verifyHardenedSource(readFileSync(projectPath, 'utf8'));

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
  `xcode ${EXPECTED_XCODE_VERSION} uses crypto.randomUUID; uuid ${REQUIRED_UUID_VERSION} is not loaded by CommonJS.`,
);
