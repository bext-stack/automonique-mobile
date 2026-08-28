// SPDX-License-Identifier: Elastic-2.0

import {
  admitReviewNotification,
  decodeReviewNotificationData,
  encodeReviewNotificationData,
  mayRequestNotificationPermission,
} from './review-notifications';
import type { ServerIdentity } from './workspace-companion';

const route = {
  pathname: '/workspace/[server]/[workspace]' as const,
  params: {
    server: `sha256:${'a'.repeat(64)}`,
    workspace: 'workspace-35',
    revision: '4',
    destination: 'review',
    review_revision: '9',
  },
};

test('never prompts for notifications without an explicit operator gesture', () => {
  expect(
    mayRequestNotificationPermission({
      permission: 'undetermined',
      userInitiated: false,
    }),
  ).toBe(false);
  expect(
    mayRequestNotificationPermission({
      permission: 'undetermined',
      userInitiated: true,
    }),
  ).toBe(true);
  expect(
    mayRequestNotificationPermission({
      permission: 'denied',
      userInitiated: true,
    }),
  ).toBe(false);
});

test('background notification is content-free and requires current Needs You attention', () => {
  const candidate = {
    permission: 'granted' as const,
    appState: 'background' as const,
    authorizationActive: true,
    projectionLive: true,
    attentionState: 'needs_you' as const,
    unread: 1,
    route,
  };
  expect(admitReviewNotification(candidate)).toEqual({
    title: 'Automonique needs you',
    body: 'Open the current review to inspect the bounded request.',
    route,
  });
  expect(
    admitReviewNotification({ ...candidate, appState: 'active' }),
  ).toBeNull();
  expect(
    admitReviewNotification({ ...candidate, authorizationActive: false }),
  ).toBeNull();
  expect(
    admitReviewNotification({ ...candidate, attentionState: 'working' }),
  ).toBeNull();
  for (const refused of [
    { permission: 'denied' as const },
    { permission: 'undetermined' as const },
    { appState: 'inactive' as const },
    { projectionLive: false },
    { unread: 0 },
  ]) {
    expect(admitReviewNotification({ ...candidate, ...refused })).toBeNull();
  }
});

test('notification coordinates are exact, bounded, and inert until live re-admission', () => {
  const request = {
    serverIdentity: `sha256:${'a'.repeat(64)}` as ServerIdentity,
    workspaceId: 'workspace-35',
    workspaceRevision: '4',
    reviewRevision: '9',
    fileId: 'file-1',
    hunkId: 'hunk-1',
  };
  const encoded = encodeReviewNotificationData(request);
  expect(Object.keys(encoded).sort()).toEqual(
    [
      'file_id',
      'hunk_id',
      'kind',
      'review_revision',
      'server_identity',
      'workspace_id',
      'workspace_revision',
    ].sort(),
  );
  expect(JSON.stringify(encoded)).not.toMatch(
    /session|pathname|body|title|token/iu,
  );
  expect(decodeReviewNotificationData(encoded)).toEqual(request);
  expect(() =>
    decodeReviewNotificationData({ ...encoded, pathname: '/settings' }),
  ).toThrow('review_notification_invalid');
  expect(() =>
    decodeReviewNotificationData({ ...encoded, workspace_revision: '0' }),
  ).toThrow('review_notification_invalid');
  expect(() =>
    decodeReviewNotificationData({ ...encoded, file_id: null }),
  ).toThrow('review_notification_invalid');
});
