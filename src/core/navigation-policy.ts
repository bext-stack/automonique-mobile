// SPDX-License-Identifier: Elastic-2.0

import type { MobileLifecycleState } from './mobile-lifecycle';

export function admitsOperationalNavigation(
  phase: MobileLifecycleState['phase'],
): boolean {
  // Persisted views remain useful while access renews or the network is
  // unavailable. The lifecycle and projection still gate every command.
  return (
    phase === 'ready' || phase === 'refreshing' || phase === 'refresh_required'
  );
}
