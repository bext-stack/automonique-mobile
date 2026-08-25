// SPDX-License-Identifier: Elastic-2.0

import assert from 'node:assert/strict';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const app = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8')).expo;
const eas = JSON.parse(readFileSync(join(root, 'eas.json'), 'utf8'));
const simulator = eas.build?.simulator;
const iosIcon = readFileSync(join(root, app.ios?.icon ?? ''));

assert.equal(
  iosIcon.subarray(1, 4).toString('ascii'),
  'PNG',
  'iOS icon must be a PNG',
);
assert.ok(
  iosIcon[25] === 0 || iosIcon[25] === 2,
  'iOS icon must use an opaque grayscale or RGB PNG color type',
);

assert.equal(
  app.ios?.infoPlist?.NSAppTransportSecurity?.NSAllowsArbitraryLoads,
  false,
  'iOS must explicitly deny arbitrary network loads',
);
assert.equal(
  app.ios?.infoPlist?.NSAppTransportSecurity?.NSAllowsLocalNetworking,
  false,
  'iOS release configuration must not exempt local cleartext traffic',
);

const buildProperties = app.plugins?.find(
  (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-build-properties',
);
assert.equal(
  buildProperties?.[1]?.android?.usesCleartextTraffic,
  false,
  'Android release configuration must explicitly deny cleartext traffic',
);

assert.match(
  eas.cli?.version ?? '',
  /^\d+\.\d+\.\d+$/,
  'EAS CLI must be pinned to an exact version',
);
assert.equal(eas.cli?.requireCommit, true, 'EAS builds require a clean commit');
assert.equal(
  eas.cli?.appVersionSource,
  'local',
  'simulator versions must come from committed configuration',
);
assert.ok(simulator, 'the simulator build profile is required');
assert.equal(simulator.distribution, 'internal');
assert.equal(simulator.autoIncrement, false);
assert.equal(simulator.developmentClient, undefined);
assert.equal(simulator.node, '24.19.0');
assert.equal(simulator.android?.gradleCommand, ':app:assembleRelease');
assert.equal(simulator.android?.withoutCredentials, true);
assert.equal(simulator.android?.image, 'ubuntu-26.04-jdk-17-ndk-r27b-sdk-57');
assert.equal(simulator.ios?.simulator, true);
assert.equal(simulator.ios?.withoutCredentials, true);
assert.equal(simulator.ios?.image, 'macos-tahoe-26.5-xcode-26.6');
assert.equal(app.android?.versionCode, 1);
assert.equal(app.ios?.buildNumber, '1');
assert.equal(
  Object.hasOwn(eas.build ?? {}, 'production'),
  false,
  'a production profile requires a separately reviewed release change',
);

const workspace = mkdtempSync(join(tmpdir(), 'automonique-native-policy-'));
try {
  for (const path of [
    'app.json',
    'package.json',
    'package-lock.json',
    'assets',
  ]) {
    cpSync(join(root, path), join(workspace, path), { recursive: true });
  }
  const installedModules = join(root, 'node_modules');
  assert.ok(
    existsSync(installedModules),
    'run npm ci before native verification',
  );
  symlinkSync(installedModules, join(workspace, 'node_modules'), 'dir');

  const expoCli = join(installedModules, 'expo', 'bin', 'cli');
  const prebuild = spawnSync(
    process.execPath,
    [expoCli, 'prebuild', '--clean', '--no-install', '--platform', 'all'],
    {
      cwd: workspace,
      encoding: 'utf8',
      env: { ...process.env, CI: '1' },
    },
  );
  assert.equal(
    prebuild.status,
    0,
    `Expo prebuild failed:\n${prebuild.stdout}\n${prebuild.stderr}`,
  );

  const androidManifest = readFileSync(
    join(workspace, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'),
    'utf8',
  );
  assert.match(
    androidManifest,
    /android:usesCleartextTraffic="false"/,
    'generated Android release manifest must deny cleartext traffic',
  );

  const iosInfo = readFileSync(
    join(workspace, 'ios', 'Automonique', 'Info.plist'),
    'utf8',
  );
  assert.match(
    iosInfo,
    /<key>NSAllowsArbitraryLoads<\/key>\s*<false\/>/,
    'generated iOS app must deny arbitrary network loads',
  );
  assert.match(
    iosInfo,
    /<key>NSAllowsLocalNetworking<\/key>\s*<false\/>/,
    'generated iOS app must not exempt local cleartext traffic',
  );

  console.log(
    'Native release transport and simulator profile policies verified.',
  );
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
