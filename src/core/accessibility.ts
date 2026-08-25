// SPDX-License-Identifier: Elastic-2.0

import { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

export function useReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (active) setReducedMotion(enabled);
      })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReducedMotion,
    );
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return reducedMotion;
}

export function announceForAccessibility(message: string): void {
  if (Platform.OS === 'web') return;
  AccessibilityInfo.announceForAccessibility(message);
}

export function receiptAnnouncement(
  action: 'follow_up' | 'decide_approval' | 'stop_run',
  outcome: string,
): string {
  const label =
    action === 'follow_up'
      ? 'Follow-up'
      : action === 'decide_approval'
        ? 'Approval decision'
        : 'Run stop request';
  return `${label}: ${outcome.replaceAll('_', ' ')}`;
}

export function approvalAnnouncement(
  title: string,
  decision: 'grant' | 'deny',
  outcome: string,
): string {
  return outcome === 'completed'
    ? `${decision === 'deny' ? 'Denied' : 'Granted'} ${title}.`
    : `${title}. ${receiptAnnouncement('decide_approval', outcome)}`;
}
