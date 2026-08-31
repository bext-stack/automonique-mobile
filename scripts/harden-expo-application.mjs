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
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.slice(2).includes('--check');
const applicationRoot = join(root, 'node_modules', 'expo-application');
const packagePath = join(applicationRoot, 'package.json');
const modulePath = join(
  applicationRoot,
  'android',
  'src',
  'main',
  'java',
  'expo',
  'modules',
  'application',
  'ApplicationModule.kt',
);
const gradlePath = join(applicationRoot, 'android', 'build.gradle');

const EXPECTED_VERSION = '57.0.2';
const PRISTINE_MODULE_SHA256 =
  '170ba1cc296587cfa70da1e8278d5f81b03f9ee0e36f99a2abc62770204611b1';
const HARDENED_MODULE_SHA256 =
  '847d733b6f6424640d15b57174832001175ae2a4654442903e7a8cadd9677a66';
const PRISTINE_GRADLE_SHA256 =
  'ee6ce5163afe510d6c7a0b5ed676769d987fd28ae7cce4337abd28e382b890ef';
const HARDENED_GRADLE_SHA256 =
  '02fd620da752e2e833b48ebf18f1dbd67ad04ad982f420c3d9f8980a348ceec0';
const INSTALL_REFERRER_FUNCTION =
  '\n    AsyncFunction("getInstallReferrerAsync") { promise: Promise ->';
const MODULE_DEFINITION_END = '\n  }\n\n  private val packageName';
const INSTALL_REFERRER_DEPENDENCY =
  "dependencies {\n  implementation 'com.android.installreferrer:installreferrer:2.2'\n\n";

function sha256(contents) {
  return createHash('sha256').update(contents).digest('hex');
}

function replaceExactlyOnce(contents, before, after) {
  assert.equal(
    contents.split(before).length - 1,
    1,
    `expo-application source must contain exactly one expected fragment: ${before.trim()}`,
  );
  return contents.replace(before, after);
}

function hardenModule(contents) {
  for (const importLine of [
    'import android.os.RemoteException\n',
    'import com.android.installreferrer.api.InstallReferrerClient\n',
    'import com.android.installreferrer.api.InstallReferrerStateListener\n',
    'import expo.modules.kotlin.Promise\n',
  ]) {
    contents = replaceExactlyOnce(contents, importLine, '');
  }

  const start = contents.indexOf(INSTALL_REFERRER_FUNCTION);
  assert.notEqual(
    start,
    -1,
    'expo-application install-referrer function moved',
  );
  const end = contents.indexOf(MODULE_DEFINITION_END, start);
  assert.notEqual(end, -1, 'expo-application module definition moved');
  return `${contents.slice(0, start)}${contents.slice(end)}`;
}

function hardenGradle(contents) {
  return replaceExactlyOnce(
    contents,
    INSTALL_REFERRER_DEPENDENCY,
    'dependencies {\n',
  );
}

function writeAtomically(path, contents) {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const mode = statSync(path).mode;
  try {
    writeFileSync(temporaryPath, contents, { encoding: 'utf8', mode });
    renameSync(temporaryPath, path);
  } finally {
    try {
      unlinkSync(temporaryPath);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

function verifyHardened(path, expectedSha256) {
  const contents = readFileSync(path, 'utf8');
  assert.equal(
    sha256(contents),
    expectedSha256,
    `expo-application hardening drifted: ${path}`,
  );
  assert.doesNotMatch(
    contents,
    /installreferrer|InstallReferrer|getInstallReferrer/u,
  );
}

function hardenFile(path, pristineSha256, hardenedSha256, transform) {
  const contents = readFileSync(path, 'utf8');
  const digest = sha256(contents);
  if (digest === pristineSha256) {
    assert.equal(
      checkOnly,
      false,
      'expo-application is not hardened; run npm ci with lifecycle scripts enabled',
    );
    const hardened = transform(contents);
    assert.equal(
      sha256(hardened),
      hardenedSha256,
      `expo-application transformation drifted: ${path}`,
    );
    writeAtomically(path, hardened);
  } else if (digest !== hardenedSha256) {
    assert.fail(
      `refusing to patch unreviewed expo-application source (sha256:${digest})`,
    );
  }
  verifyHardened(path, hardenedSha256);
}

const applicationPackage = JSON.parse(readFileSync(packagePath, 'utf8'));
const rootPackage = JSON.parse(
  readFileSync(join(root, 'package.json'), 'utf8'),
);
assert.deepEqual(rootPackage.expo?.autolinking?.android?.buildFromSource, [
  'expo-application',
  'expo-notifications',
]);
assert.equal(applicationPackage.name, 'expo-application');
assert.equal(
  applicationPackage.version,
  EXPECTED_VERSION,
  'refusing to patch an unreviewed expo-application release',
);
assert.equal(applicationPackage.license, 'MIT');

hardenFile(
  modulePath,
  PRISTINE_MODULE_SHA256,
  HARDENED_MODULE_SHA256,
  hardenModule,
);
hardenFile(
  gradlePath,
  PRISTINE_GRADLE_SHA256,
  HARDENED_GRADLE_SHA256,
  hardenGradle,
);

console.log(
  `expo-application ${EXPECTED_VERSION} excludes the unused Android Install Referrer API and dependency.`,
);
