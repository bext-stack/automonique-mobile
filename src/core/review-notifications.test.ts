// SPDX-License-Identifier: Elastic-2.0

import {
  attentionNotificationKey,
  admitReviewNotification,
  decodeAttentionNotificationData,
  decodeReviewNotificationData,
  encodeAttentionSourceNotificationData,
  encodeReviewNotificationData,
  encodeSessionAttentionNotificationData,
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
    target: 'review' as const,
    route,
  };
  expect(admitReviewNotification(candidate)).toEqual({
    title: 'Automonique needs you',
    body: 'Open Automonique to inspect the current bounded request.',
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
    authorizationRevision: '8',
    principalGeneration: '3',
    workspaceId: 'workspace-35',
    workspaceRevision: '4',
    reviewRevision: '9',
    fileId: 'file-1',
    hunkId: 'hunk-1',
    checkId: null,
  };
  const encoded = encodeReviewNotificationData(request);
  expect(Object.keys(encoded).sort()).toEqual(
    [
      'file_id',
      'hunk_id',
      'check_id',
      'kind',
      'authorization_revision',
      'principal_generation',
      'review_revision',
      'server_identity',
      'workspace_id',
      'workspace_revision',
    ].sort(),
  );
  expect(JSON.stringify(encoded)).not.toMatch(
    /session|pathname|body|title|token|confirmation|correlation|digest/iu,
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
  expect(() =>
    decodeReviewNotificationData({
      ...encoded,
      authorization_revision: '9',
      extra: 'forged',
    }),
  ).toThrow('review_notification_invalid');
});

test('check attention notifications retain the exact rerun deep-link anchor', () => {
  const request = {
    serverIdentity: `sha256:${'a'.repeat(64)}` as ServerIdentity,
    authorizationRevision: '8',
    principalGeneration: '3',
    workspaceId: 'workspace-35',
    workspaceRevision: '4',
    reviewRevision: '9',
    fileId: null,
    hunkId: null,
    checkId: 'check-1',
  };
  const encoded = encodeReviewNotificationData(request);
  expect(encoded).toMatchObject({
    kind: 'automonique_review_attention_v3',
    check_id: 'check-1',
  });
  expect(decodeReviewNotificationData(encoded)).toEqual(request);
  expect(JSON.stringify(encoded)).not.toMatch(
    /confirmation|correlation|digest/iu,
  );
  expect(attentionNotificationKey({ target: 'review', request })).toContain(
    'check-1',
  );
  expect(() =>
    decodeReviewNotificationData({ ...encoded, file_id: 'file-1' }),
  ).toThrow('review_notification_invalid');
  for (const forbidden of [
    { confirmation_digest: 'ab'.repeat(32) },
    { receipt_correlation_digest: 'cd'.repeat(32) },
  ]) {
    expect(() =>
      decodeReviewNotificationData({ ...encoded, ...forbidden }),
    ).toThrow('review_notification_invalid');
  }
});

test('session notification carries only lookup coordinates and allows zero unread', () => {
  const request = {
    serverIdentity: `sha256:${'a'.repeat(64)}` as ServerIdentity,
    authorizationRevision: '8',
    principalGeneration: '3',
    workspaceId: 'workspace-35',
    workspaceRevision: '4',
    nodeKind: 'question',
    nodeId: 'question-1',
    nodeRevision: '11',
  };
  const encoded = encodeSessionAttentionNotificationData(request);
  const decoded = decodeAttentionNotificationData(encoded);
  expect(decoded).toEqual({ target: 'session', request });
  expect(JSON.stringify(encoded)).not.toMatch(
    /retained|attempt|session_id|pathname|token|body/iu,
  );
  expect(attentionNotificationKey(decoded)).toContain('question-1');
  expect(
    admitReviewNotification({
      permission: 'granted',
      appState: 'background',
      authorizationActive: true,
      projectionLive: true,
      attentionState: 'needs_you',
      unread: 0,
      target: 'session',
      route: {
        pathname: '/workspace/[server]/[workspace]/session/[session]',
        params: { session: 'current-lookup-result' },
        readOnly: false,
      },
    }),
  ).not.toBeNull();
  expect(() =>
    decodeAttentionNotificationData({ ...encoded, node_revision: '0' }),
  ).toThrow('review_notification_invalid');
});

const attentionSourceRequest = {
  serverIdentity: `sha256:${'a'.repeat(64)}` as ServerIdentity,
  authorizationRevision: '8',
  principalGeneration: '3',
  workspaceId: 'workspace-35',
  workspaceRevision: '12',
  sourceKind: 'provider_session',
  sourceId: 'work-session-34',
  itemId: 'item-a',
  itemRevision: '4',
};

test('round-trips an attention source coordinate and carries no content', () => {
  const encoded = encodeAttentionSourceNotificationData(attentionSourceRequest);
  expect(encoded).toEqual({
    kind: 'automonique_attention_source_v1',
    server_identity: attentionSourceRequest.serverIdentity,
    authorization_revision: '8',
    principal_generation: '3',
    workspace_id: 'workspace-35',
    workspace_revision: '12',
    source_kind: 'provider_session',
    source_id: 'work-session-34',
    item_id: 'item-a',
    item_revision: '4',
  });
  expect(decodeAttentionNotificationData(encoded)).toEqual({
    target: 'attention_source',
    request: attentionSourceRequest,
  });
});

test('refuses an attention source coordinate that is not exactly shaped', () => {
  const encoded = encodeAttentionSourceNotificationData(attentionSourceRequest);
  for (const mutation of [
    { ...encoded, extra: 'x' },
    { ...encoded, source_kind: 'terminal' },
    { ...encoded, item_revision: '0' },
    { ...encoded, item_revision: 'latest' },
    { ...encoded, server_identity: 'not-a-digest' },
    Object.fromEntries(
      Object.entries(encoded).filter(([field]) => field !== 'item_id'),
    ),
  ]) {
    expect(() => decodeAttentionNotificationData(mutation)).toThrow(
      'review_notification_invalid',
    );
  }
});

test('separates attention source coordinates by source and item revision', () => {
  const base = attentionNotificationKey({
    target: 'attention_source',
    request: attentionSourceRequest,
  });
  expect(base).toContain('attention_source');
  expect(
    attentionNotificationKey({
      target: 'attention_source',
      request: { ...attentionSourceRequest, itemRevision: '5' },
    }),
  ).not.toBe(base);
  expect(
    attentionNotificationKey({
      target: 'attention_source',
      request: { ...attentionSourceRequest, sourceId: 'work-session-99' },
    }),
  ).not.toBe(base);
});
