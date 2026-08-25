// SPDX-License-Identifier: Elastic-2.0

import {
  PLATFORM_MEDIA_TYPE,
  PLATFORM_PROTOCOL,
  PLATFORM_PROTOCOL_VERSION,
  PLATFORM_SCHEMA_V1,
  SCHEMA_DIGEST,
  SCHEMA_DIGEST_ALGORITHM,
} from '@automonique/sdk';

/** Runtime imports keep the exact vendored protocol identity in every bundle. */
export const AUTOMONIQUE_SDK_METADATA = Object.freeze({
  packageName: '@automonique/sdk',
  protocol: PLATFORM_PROTOCOL,
  protocolVersion: PLATFORM_PROTOCOL_VERSION,
  schema: PLATFORM_SCHEMA_V1,
  schemaDigest: `${SCHEMA_DIGEST_ALGORITHM}:${SCHEMA_DIGEST}`,
  mediaType: PLATFORM_MEDIA_TYPE,
});
