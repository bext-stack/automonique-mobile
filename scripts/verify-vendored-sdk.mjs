// SPDX-License-Identifier: Elastic-2.0

import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

import {
  MOBILE_AUTH_SCHEMA_V1,
  MOBILE_PLATFORM_V2_ACTIONS,
  MOBILE_PLATFORM_V2_AUTHORIZATION_MEDIA_TYPE,
  MOBILE_PLATFORM_V2_AUTHORIZATION_SCHEMA,
  MobileLifecycleClient,
  MobileSessionClient,
  PLATFORM_V1_SCHEMA_DIGEST,
  PlatformV2Client,
  HttpsPlatformV2Transport,
  SCHEMA_DIGEST,
  decodeMobilePlatformV2Authorization,
  encodeMobilePlatformV2GrantRequest,
  mobilePlatformClientId,
} from '@automonique/sdk';
import * as sdkRoot from '@automonique/sdk';
import * as sdkTesting from '@automonique/sdk/testing';

const root = process.cwd();
const manifest = JSON.parse(
  await readFile(join(root, 'vendor', 'automonique-sdk.json'), 'utf8'),
);
const archive = await readFile(join(root, 'vendor', manifest.archive));
const archiveSha256 = createHash('sha256').update(archive).digest('hex');
const installed = JSON.parse(
  await readFile(
    join(root, 'node_modules', '@automonique', 'sdk', 'package.json'),
    'utf8',
  ),
);
const installedRoot = join(root, 'node_modules', '@automonique', 'sdk');

async function filesRecursively(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesRecursively(absolute)));
    else files.push(absolute);
  }
  return files.sort();
}

const topLevel = (await readdir(installedRoot)).sort();
const expectedTopLevel = ['LICENSE', 'README.md', 'dist', 'package.json'];
const license = await readFile(join(installedRoot, 'LICENSE'), 'utf8');
const runtimeFiles = (
  await filesRecursively(join(installedRoot, 'dist'))
).filter((file) => file.endsWith('.js'));

for (const file of runtimeFiles) {
  const source = await readFile(file, 'utf8');
  if (
    !source.startsWith('// SPDX-License-Identifier: Apache-2.0\n') ||
    /\brequire\s*\(|\b(?:node|bun):[A-Za-z0-9_./-]+/u.test(source)
  ) {
    throw new Error(
      `vendored_automonique_sdk_runtime_boundary_failed:${relative(installedRoot, file)}`,
    );
  }
  const specifiers = [
    ...source.matchAll(
      /\b(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/gu,
    ),
    ...source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gu),
  ];
  for (const match of specifiers) {
    const specifier = match[1];
    if (specifier === undefined || !specifier.startsWith('.')) {
      throw new Error(
        `vendored_automonique_sdk_runtime_import_failed:${relative(installedRoot, file)}`,
      );
    }
    const target = resolve(dirname(file), specifier);
    const targetRelative = relative(join(installedRoot, 'dist'), target);
    if (
      targetRelative.startsWith('..') ||
      !target.endsWith('.js') ||
      !(await stat(target).catch(() => null))?.isFile()
    ) {
      throw new Error(
        `vendored_automonique_sdk_runtime_import_failed:${relative(installedRoot, file)}`,
      );
    }
  }
}

if (
  manifest.package !== '@automonique/sdk' ||
  installed.name !== manifest.package ||
  installed.version !== manifest.version ||
  archiveSha256 !== manifest.archiveSha256 ||
  `sha256:${PLATFORM_V1_SCHEMA_DIGEST}` !== manifest.schemaDigest ||
  `sha256:${SCHEMA_DIGEST}` !== manifest.aggregateSchemaDigest ||
  installed.automonique?.schemaDigest !== manifest.schemaDigest ||
  installed.automonique?.aggregateSchemaDigest !==
    manifest.aggregateSchemaDigest ||
  installed.license !== 'Apache-2.0' ||
  JSON.stringify(topLevel) !== JSON.stringify(expectedTopLevel) ||
  !license.includes('Apache License') ||
  !license.includes('Version 2.0, January 2004') ||
  runtimeFiles.length === 0 ||
  MOBILE_AUTH_SCHEMA_V1 !== 'automonique.mobile-auth/v1' ||
  MOBILE_PLATFORM_V2_AUTHORIZATION_SCHEMA !==
    'automonique.mobile-platform-v2-authorization/v1' ||
  MOBILE_PLATFORM_V2_AUTHORIZATION_MEDIA_TYPE !==
    'application/vnd.automonique.mobile-platform-v2-authorization.v1+json' ||
  !MOBILE_PLATFORM_V2_ACTIONS.includes('get_mutation_receipt') ||
  typeof MobileLifecycleClient !== 'function' ||
  typeof MobileLifecycleClient.prototype.grantPlatformV2 !== 'function' ||
  typeof MobileLifecycleClient.prototype.platformV2Authorization !==
    'function' ||
  typeof MobileSessionClient !== 'function' ||
  typeof decodeMobilePlatformV2Authorization !== 'function' ||
  typeof encodeMobilePlatformV2GrantRequest !== 'function' ||
  typeof mobilePlatformClientId !== 'function' ||
  typeof PlatformV2Client !== 'function' ||
  typeof HttpsPlatformV2Transport !== 'function' ||
  Object.hasOwn(sdkRoot, 'PlatformV2CanonicalTestingTransport') ||
  Object.hasOwn(sdkTesting, 'PlatformV2CanonicalTestingTransport')
) {
  throw new Error('vendored_automonique_sdk_verification_failed');
}

console.log(
  `verified ${manifest.package}@${manifest.version} from ${manifest.sourceCommit}`,
);
