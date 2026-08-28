// SPDX-License-Identifier: Elastic-2.0

import type { ReviewNotificationRuntime } from './review-notification-runtime';

export type { ReviewNotificationRuntime } from './review-notification-runtime';

export const reviewNotificationRuntime: ReviewNotificationRuntime = {
  supported: false,
  async configure() {},
  async permission() {
    return 'denied';
  },
  async requestPermission() {
    return 'denied';
  },
  async lastResponse() {
    return null;
  },
  async clearLastResponse() {},
  onResponse() {
    return () => undefined;
  },
  async schedule() {},
};
