// SPDX-License-Identifier: Elastic-2.0

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  MOBILE_AUTH_SCHEMA_V1,
  MobileLifecycleClient,
  MobileSessionClient,
  PLATFORM_V1_SCHEMA_DIGEST,
  PlatformV2Client,
  HttpsPlatformV2Transport,
  SCHEMA_DIGEST,
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
  MOBILE_AUTH_SCHEMA_V1 !== 'automonique.mobile-auth/v1' ||
  typeof MobileLifecycleClient !== 'function' ||
  typeof MobileSessionClient !== 'function' ||
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
