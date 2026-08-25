// SPDX-License-Identifier: Elastic-2.0

import {
  ResourceAuthority_VALUES,
  type ResourceAuthority,
} from '@automonique/sdk';

import type { MobileAction } from './types';

export interface MobileAuthorization {
  readonly protocol: 'automonique.platform';
  readonly schema: 'automonique.platform/v1';
  readonly serverIdentity: string;
  readonly actor: string;
  readonly sessionAuthority: ResourceAuthority;
  readonly allowedActions: readonly MobileAction[];
  readonly limits: {
    readonly maxPageEvents: number;
    readonly maxFollowUpBytes: number;
  };
}

const MOBILE_ACTIONS: readonly MobileAction[] = [
  'attach',
  'follow_up',
  'decide_approval',
  'stop_run',
];

export function admitMobileAuthorization(
  value: MobileAuthorization,
  expectedIdentity: string,
): MobileAuthorization {
  if (
    value.protocol !== 'automonique.platform' ||
    value.schema !== 'automonique.platform/v1' ||
    value.serverIdentity !== expectedIdentity ||
    !/^[\x21-\x7e]{1,256}$/.test(value.actor) ||
    !/^[\x21-\x7e]{1,256}$/.test(value.serverIdentity) ||
    !ResourceAuthority_VALUES.includes(value.sessionAuthority) ||
    !Array.isArray(value.allowedActions) ||
    new Set(value.allowedActions).size !== value.allowedActions.length ||
    value.allowedActions.some((action) => !MOBILE_ACTIONS.includes(action)) ||
    !Number.isInteger(value.limits.maxPageEvents) ||
    value.limits.maxPageEvents < 1 ||
    value.limits.maxPageEvents > 512 ||
    !Number.isInteger(value.limits.maxFollowUpBytes) ||
    value.limits.maxFollowUpBytes < 1 ||
    value.limits.maxFollowUpBytes > 65_536
  ) {
    throw new Error('mobile_capabilities_incompatible');
  }
  return value;
}
