// SPDX-License-Identifier: Elastic-2.0

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { SCHEMA_DIGEST } from '@automonique/sdk';

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
  `sha256:${SCHEMA_DIGEST}` !== manifest.schemaDigest ||
  installed.automonique?.schemaDigest !== manifest.schemaDigest ||
  installed.license !== 'Apache-2.0'
) {
  throw new Error('vendored_automonique_sdk_verification_failed');
}

console.log(
  `verified ${manifest.package}@${manifest.version} from ${manifest.sourceCommit}`,
);
