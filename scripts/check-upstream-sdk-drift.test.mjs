// SPDX-License-Identifier: Elastic-2.0

import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { compareSdkDigests } from './check-upstream-sdk-drift.mjs';

const localCommit = '1'.repeat(40);
const upstreamCommit = '2'.repeat(40);
const localDigest = `sha256:${'a'.repeat(64)}`;
const upstreamDigest = `sha256:${'b'.repeat(64)}`;

function manifest(schemaDigest = localDigest) {
  return {
    package: '@automonique/sdk',
    sourceCommit: localCommit,
    schemaDigest,
  };
}

function upstreamPackage(schemaDigest = upstreamDigest) {
  return {
    name: '@automonique/sdk',
    automonique: { schemaDigest },
  };
}

test('reports matching schema digests as current', () => {
  const result = compareSdkDigests(
    manifest(),
    upstreamPackage(localDigest),
    upstreamCommit,
  );

  assert.equal(result.drift, false);
  assert.equal(result.localSchemaDigest, localDigest);
  assert.equal(result.upstreamSchemaDigest, localDigest);
});

test('reports drift without treating it as an invalid contract', () => {
  const result = compareSdkDigests(
    manifest(),
    upstreamPackage(),
    upstreamCommit,
  );

  assert.deepEqual(result, {
    drift: true,
    localSchemaDigest: localDigest,
    upstreamSchemaDigest: upstreamDigest,
    localSourceCommit: localCommit,
    upstreamSourceCommit: upstreamCommit,
  });
});

test('rejects malformed package metadata', () => {
  assert.throws(
    () =>
      compareSdkDigests(
        manifest('not-a-digest'),
        upstreamPackage(),
        upstreamCommit,
      ),
    /vendored_schema_digest_invalid/u,
  );
});

test('the command exits successfully on drift and writes GitHub outputs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'automonique-sdk-drift-'));
  const manifestPath = join(directory, 'manifest.json');
  const packagePath = join(directory, 'package.json');
  const outputPath = join(directory, 'github-output.txt');
  await writeFile(manifestPath, JSON.stringify(manifest()), 'utf8');
  await writeFile(packagePath, JSON.stringify(upstreamPackage()), 'utf8');

  const command = spawnSync(
    process.execPath,
    [
      new URL('./check-upstream-sdk-drift.mjs', import.meta.url).pathname,
      '--manifest',
      manifestPath,
      '--upstream-package',
      packagePath,
      '--upstream-commit',
      upstreamCommit,
      '--github-output',
      outputPath,
    ],
    { encoding: 'utf8' },
  );

  assert.equal(command.status, 0, command.stderr);
  assert.match(command.stdout, /schema drift detected/u);
  const output = await readFile(outputPath, 'utf8');
  assert.match(output, /^drift=true$/mu);
  assert.match(
    output,
    new RegExp(`^upstream_schema_digest=${upstreamDigest}$`, 'mu'),
  );
});
