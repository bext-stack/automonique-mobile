// SPDX-License-Identifier: Elastic-2.0

import type {
  NotificationPermission,
  ReviewNotificationData,
} from './review-notifications';

export interface ReviewNotificationRuntime {
  readonly supported: boolean;
  configure(): Promise<void>;
  permission(): Promise<NotificationPermission>;
  requestPermission(): Promise<NotificationPermission>;
  lastResponse(): Promise<unknown | null>;
  clearLastResponse(): Promise<void>;
  onResponse(listener: (data: unknown) => void): () => void;
  schedule(content: {
    readonly title: string;
    readonly body: string;
    readonly data: ReviewNotificationData;
  }): Promise<void>;
}

/** Web/SSR fallback. Metro selects the native implementation on iOS/Android. */
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
