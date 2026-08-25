// SPDX-License-Identifier: Elastic-2.0

import {
  MOBILE_AUTH_SCHEMA_V1,
  type MobileAuthorization,
} from '@automonique/sdk';

export type { MobileAuthorization };

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
