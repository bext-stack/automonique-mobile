// SPDX-License-Identifier: Elastic-2.0

export interface MobileCapabilities {
  readonly protocol: 'automonique.platform';
  readonly schema: 'automonique.platform/v1';
  readonly serverIdentity: string;
  readonly actor: string;
  readonly allowedActions: readonly (
    'attach' | 'follow_up' | 'decide_approval' | 'stop_run'
  )[];
  readonly limits: {
    readonly maxPageEvents: number;
    readonly maxFollowUpBytes: number;
  };
}

export function admitMobileCapabilities(
  value: MobileCapabilities,
  expectedIdentity: string,
): MobileCapabilities {
  if (
    value.protocol !== 'automonique.platform' ||
    value.schema !== 'automonique.platform/v1' ||
    value.serverIdentity !== expectedIdentity ||
    !value.actor ||
    value.limits.maxPageEvents < 1 ||
    value.limits.maxFollowUpBytes < 1
  ) {
    throw new Error('mobile_capabilities_incompatible');
  }
  return value;
}

/**
 * Deliberate production gate. The current server does not issue the scoped,
 * actor-authorized capability document required above, so the mobile app has
 * no production transport constructor yet.
 */
export function productionGatewayUnavailable(): never {
  throw new Error('mobile_production_gateway_unavailable');
}
