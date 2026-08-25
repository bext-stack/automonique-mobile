// SPDX-License-Identifier: Elastic-2.0

import type { MobileLifecycleState } from './mobile-lifecycle';

export function admitsOperationalNavigation(
  phase: MobileLifecycleState['phase'],
): boolean {
  return phase === 'ready';
}
