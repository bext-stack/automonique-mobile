// SPDX-License-Identifier: Elastic-2.0

import {
  MOBILE_AUTH_MEDIA_TYPE,
  MOBILE_AUTH_PROTOCOL,
  MOBILE_AUTH_SCHEMA_V1,
  MOBILE_PLATFORM_V2_AUTHORIZATION_MEDIA_TYPE,
  MOBILE_PLATFORM_V2_AUTHORIZATION_SCHEMA,
  PLATFORM_MEDIA_TYPE,
  PLATFORM_PROTOCOL,
  PLATFORM_PROTOCOL_VERSION,
  PLATFORM_SCHEMA_V1,
  PLATFORM_V1_SCHEMA_DIGEST,
  SCHEMA_DIGEST_ALGORITHM,
} from '@automonique/sdk';

/** Runtime imports keep the exact vendored protocol identity in every bundle. */
export const AUTOMONIQUE_SDK_METADATA = Object.freeze({
  packageName: '@automonique/sdk',
  protocol: PLATFORM_PROTOCOL,
  protocolVersion: PLATFORM_PROTOCOL_VERSION,
  schema: PLATFORM_SCHEMA_V1,
  schemaDigest: `${SCHEMA_DIGEST_ALGORITHM}:${PLATFORM_V1_SCHEMA_DIGEST}`,
  mediaType: PLATFORM_MEDIA_TYPE,
  mobileAuth: Object.freeze({
    protocol: MOBILE_AUTH_PROTOCOL,
    schema: MOBILE_AUTH_SCHEMA_V1,
    mediaType: MOBILE_AUTH_MEDIA_TYPE,
  }),
  mobilePlatformV2: Object.freeze({
    schema: MOBILE_PLATFORM_V2_AUTHORIZATION_SCHEMA,
    mediaType: MOBILE_PLATFORM_V2_AUTHORIZATION_MEDIA_TYPE,
  }),
});
