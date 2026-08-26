// SPDX-License-Identifier: Elastic-2.0

import {
  MOBILE_AUTH_SCHEMA_V1,
  MobileProtocolVersion_MAX,
  MobileProtocolVersion_MIN,
  type MobileAuthorization,
} from '@automonique/sdk';

export type { MobileAuthorization };

/**
 * The mobile protocol major versions this build can speak, read from the
 * vendored SDK's own generated bounds rather than restated here. Re-vendoring a
 * canonical SDK that widens the range widens this app in the same step, and no
 * hand-edited constant can drift away from the archive that is actually
 * installed.
 */
export const SUPPORTED_MOBILE_PROTOCOL_VERSIONS = Object.freeze({
  min: MobileProtocolVersion_MIN as bigint,
  max: MobileProtocolVersion_MAX as bigint,
});

/**
 * Decide whether a server is compatible, and on which version.
 *
 * Admission negotiates on the advertised protocol major version. A server is
 * admitted when the versions it advertises overlap the range this build
 * supports, and the highest version in that overlap is the one used. Versions
 * above this build's ceiling are ignored rather than refused: that is what
 * keeps an already-published app usable against a server that has moved on.
 *
 * The vendored schema digest is deliberately not consulted. The server never
 * advertises it, and it fingerprints the whole generated surface -- admin,
 * automation and progress included -- rather than the mobile subset this app
 * speaks, so comparing it would refuse servers over changes the app cannot
 * observe. It stays recorded evidence of provenance in
 * `vendor/automonique-sdk.json`, checked at build time by `npm run sdk:verify`.
 */
export function negotiateMobileProtocolVersion(
  advertised: readonly bigint[],
): bigint {
  let selected: bigint | null = null;
  for (const version of advertised) {
    if (
      version < SUPPORTED_MOBILE_PROTOCOL_VERSIONS.min ||
      version > SUPPORTED_MOBILE_PROTOCOL_VERSIONS.max
    ) {
      continue;
    }
    if (selected === null || version > selected) selected = version;
  }
  if (selected === null) throw new Error('mobile_protocol_unsupported');
  return selected;
}

/** Recheck time and identity at the point the descriptor enters the gateway. */
export function admitMobileAuthorization(
  value: MobileAuthorization,
  expectedIdentity: string,
  now = Date.now(),
): MobileAuthorization {
  if (
    value.schema !== MOBILE_AUTH_SCHEMA_V1 ||
    value.server_identity !== expectedIdentity ||
    value.issued_at_ms > BigInt(now) ||
    value.issued_at_ms >= value.expires_at_ms ||
    value.expires_at_ms <= BigInt(now) ||
    value.actions.length === 0 ||
    new Set(value.actions).size !== value.actions.length ||
    new Set(value.session_scope).size !== value.session_scope.length
  ) {
    throw new Error('mobile_capabilities_incompatible');
  }
  return value;
}
