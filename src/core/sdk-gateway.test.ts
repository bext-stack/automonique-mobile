// SPDX-License-Identifier: Elastic-2.0

import {
  ClientId,
  CursorTopic,
  IdempotencyKey,
  MOBILE_AUTH_SCHEMA_V1,
  MobileActor,
  MobileCredentialId,
  MobileEpochMillis,
  MobileFollowUpBytes,
  MobilePageEvents,
  MobileRevision,
  MobileServerIdentity,
  MobileSessionClient,
  MobileSessionId,
  PlatformClient,
  PlatformEpochMillis,
  PlatformRevision,
  PlatformText,
  ReceiptId,
  ResourceId,
  SessionHistoryCursor,
  SessionHistoryLimit,
  SessionHistoryText,
  type PlatformAdapter,
  type PlatformClientResponse,
  type PlatformRequest,
  type MobileAuthorization,
  type ResourceCoordinate,
  type ResourceRecord,
} from '@automonique/sdk';

import { createSdkMobileGateway } from './sdk-gateway';
import { decimalRevision, type MobileAction } from './types';

const sessionCoordinate: ResourceCoordinate = {
  authority: 'automonique',
  kind: 'session',
  id: ResourceId('session-1'),
};
const runCoordinate: ResourceCoordinate = {
  authority: 'automonique',
  kind: 'run',
  id: ResourceId('run-1'),
};
const approvalCoordinate: ResourceCoordinate = {
  authority: 'automonique',
  kind: 'approval',
  id: ResourceId('approval-1'),
};
const sessionRecord: ResourceRecord = {
  resource: sessionCoordinate,
  summary: PlatformText('Production incident'),
  freshness: {
    observed_at: PlatformEpochMillis(1_777_000_000_000n),
    revision: PlatformRevision(9_007_199_254_740_993n),
    state: 'fresh',
  },
};
const cursor = {
  authority: 'automonique' as const,
  topic: CursorTopic('sessions'),
  sequence: PlatformRevision(9_007_199_254_740_995n),
};
const NOW = 1_777_000_000_000;
const SERVER_IDENTITY = MobileServerIdentity(`sha256:${'a'.repeat(64)}`);
const CREDENTIAL_ID = MobileCredentialId(`mc_${'b'.repeat(43)}`);

function authorization(
  allowedActions: readonly MobileAction[] = [
    'attach',
    'follow_up',
    'decide_approval',
    'stop_run',
  ],
): MobileAuthorization {
  return {
    schema: MOBILE_AUTH_SCHEMA_V1,
    server_identity: SERVER_IDENTITY,
    actor: MobileActor('operator-1'),
    credential_id: CREDENTIAL_ID,
    authorization_revision: MobileRevision(1n),
    credential_revision: MobileRevision(1n),
    issued_at_ms: MobileEpochMillis(BigInt(NOW - 1)),
    expires_at_ms: MobileEpochMillis(BigInt(NOW + 900_000)),
    actions: allowedActions,
    session_scope: [MobileSessionId('session-1')],
    limits: {
      max_page_events: MobilePageEvents(100n),
      max_follow_up_bytes: MobileFollowUpBytes(4_096n),
    },
  };
}

function adapter(
  override?: (request: PlatformRequest) => PlatformClientResponse | undefined,
): {
  client: PlatformClient;
  requests: PlatformRequest[];
  transport: PlatformAdapter;
} {
  const requests: PlatformRequest[] = [];
  const transport: PlatformAdapter = {
    async request(request) {
      requests.push(request);
      const overridden = override?.(request);
      if (overridden) return overridden;
      switch (request.method) {
        case 'capabilities':
          return {
            kind: 'capabilities',
            value: {
              protocol: 'automonique.platform',
              schema: 'automonique.platform/v1',
              transports: ['remote_https'],
              methods: [
                'capabilities',
                'list_sessions',
                'attach',
                'session_history_page',
                'session_history_snapshot',
                'get_receipt',
                'session_command_state',
                'session_follow_up',
                'session_run_stop',
                'session_approval_decision',
              ],
            },
          };
        case 'list_sessions':
          return {
            kind: 'sessions',
            value: {
              cursor,
              sessions: [
                {
                  session: sessionRecord,
                  run: runCoordinate,
                  attachable: true,
                  controllable: true,
                },
              ],
            },
          };
        case 'session_command_state':
          return {
            kind: 'session_command_state',
            value: {
              session: sessionRecord,
              run: {
                target: runCoordinate,
                revision: PlatformRevision(9_007_199_254_740_994n),
              },
              pending_approvals: [
                {
                  target: approvalCoordinate,
                  revision: PlatformRevision(9_007_199_254_740_997n),
                },
              ],
            },
          };
        case 'attach':
          return {
            kind: 'attached',
            value: {
              client: ClientId(CREDENTIAL_ID),
              cursor,
              session: sessionCoordinate,
            },
          };
        case 'session_history_snapshot':
          return {
            kind: 'session_history',
            value: {
              session: sessionCoordinate,
              requested_limit: SessionHistoryLimit(100n),
              applied_limit: SessionHistoryLimit(2n),
              from_cursor: SessionHistoryCursor(0n),
              terminal_cursor: SessionHistoryCursor(2n),
              has_more: true,
              events: [
                {
                  kind: 'message',
                  at: PlatformEpochMillis(1_777_000_000_010n),
                  cursor: SessionHistoryCursor(1n),
                  evidence: 'authoritative',
                  role: 'user',
                  text: SessionHistoryText('Investigate'),
                  truncated: false,
                },
                {
                  kind: 'tool_state',
                  at: PlatformEpochMillis(1_777_000_000_011n),
                  cursor: SessionHistoryCursor(2n),
                  evidence: 'synthetic',
                  label: SessionHistoryText('Search'),
                  state: 'in_progress',
                  truncated: false,
                },
              ],
            },
          };
        case 'session_history_page':
          return {
            kind: 'session_history',
            value: {
              session: sessionCoordinate,
              requested_limit: SessionHistoryLimit(100n),
              applied_limit: SessionHistoryLimit(2n),
              from_cursor: SessionHistoryCursor(2n),
              terminal_cursor: SessionHistoryCursor(3n),
              has_more: false,
              events: [
                {
                  kind: 'unknown',
                  at: PlatformEpochMillis(1_777_000_000_012n),
                  cursor: SessionHistoryCursor(3n),
                  source: 'adapter_event',
                },
              ],
            },
          };
        case 'session_follow_up':
          return {
            kind: 'receipt',
            value: {
              id: ReceiptId('receipt-1'),
              action: 'follow_up',
              target: request.request.session,
              revision: PlatformRevision(9_007_199_254_740_996n),
              outcome: 'completed',
              explanation: PlatformText('done'),
              recorded_at: PlatformEpochMillis(1_777_000_000_002n),
            },
          };
        case 'session_run_stop':
          return {
            kind: 'receipt',
            value: {
              id: ReceiptId('receipt-1'),
              action: 'stop_run',
              target: request.request.run,
              revision: PlatformRevision(9_007_199_254_740_996n),
              outcome: 'completed',
              explanation: PlatformText('done'),
              recorded_at: PlatformEpochMillis(1_777_000_000_002n),
            },
          };
        case 'session_approval_decision':
          return {
            kind: 'receipt',
            value: {
              id: ReceiptId('receipt-1'),
              action: 'decide_approval',
              target: request.request.approval,
              revision: PlatformRevision(9_007_199_254_740_996n),
              outcome: 'completed',
              explanation: PlatformText('done'),
              recorded_at: PlatformEpochMillis(1_777_000_000_002n),
            },
          };
        case 'get_receipt':
          return {
            kind: 'receipt',
            value: {
              id: ReceiptId('receipt-1'),
              action: 'follow_up',
              target: sessionCoordinate,
              revision: PlatformRevision(9_007_199_254_740_996n),
              outcome: 'completed',
              explanation: null,
              recorded_at: PlatformEpochMillis(1_777_000_000_002n),
            },
          };
        default:
          throw new Error(`unexpected_${request.method}`);
      }
    },
  };
  return { client: new PlatformClient(transport), requests, transport };
}

function gateway(
  scripted: ReturnType<typeof adapter>,
  allowedActions?: readonly MobileAction[],
) {
  const admitted = authorization(allowedActions);
  return createSdkMobileGateway({
    authorization: admitted,
    client: scripted.client,
    sessionClient: new MobileSessionClient(
      scripted.transport,
      admitted,
      SERVER_IDENTITY,
      () => NOW,
    ),
    expectedServerIdentity: SERVER_IDENTITY,
    now: NOW,
  });
}

test('canonical SDK bootstrap preserves exact revisions and drives attachment', async () => {
  const scripted = adapter();
  const mobile = gateway(scripted);
  const snapshot = await mobile.bootstrap();

  expect(snapshot.sessions[0]?.target.revision).toBe('9007199254740993');
  expect(snapshot.sessions[0]?.run?.revision).toBe('9007199254740994');
  expect(snapshot.sessions[0]?.followUpAllowed).toBe(true);
  expect(snapshot.approvals).toMatchObject([
    {
      session: { revision: '9007199254740993' },
      target: {
        coordinate: approvalCoordinate,
        revision: '9007199254740997',
      },
    },
  ]);
  expect(snapshot.connection.synthetic).toBe(false);

  const attachment = await mobile.attach(snapshot.sessions[0]!.target, null);
  const pages = [];
  for await (const page of attachment.events()) pages.push(page);
  expect(pages).toHaveLength(2);
  expect(pages.flatMap((page) => page.events)).toMatchObject([
    { kind: 'message', text: 'Investigate', provenance: 'authoritative' },
    { kind: 'tool', state: 'in_progress', provenance: 'synthetic' },
    { kind: 'unknown', eventType: 'adapter_event' },
  ]);
  expect(scripted.requests.map((request) => request.method)).toEqual([
    'capabilities',
    'list_sessions',
    'session_command_state',
    'attach',
    'session_history_snapshot',
    'session_history_page',
  ]);
});

test('attach-only bootstrap stays read-only without requesting command state', async () => {
  const scripted = adapter();
  const snapshot = await gateway(scripted, ['attach']).bootstrap();

  expect(snapshot.connection.mutationsAllowed).toBe(false);
  expect(snapshot.sessions[0]?.run).toBeNull();
  expect(snapshot.approvals).toEqual([]);
  expect(scripted.requests.map((request) => request.method)).toEqual([
    'capabilities',
    'list_sessions',
  ]);
});

test('session scope rejects leaked reads and local mutations before transport', async () => {
  const leakedCoordinate: ResourceCoordinate = {
    authority: 'automonique',
    kind: 'session',
    id: ResourceId('session-2'),
  };
  const leaked = adapter((request) =>
    request.method === 'list_sessions'
      ? {
          kind: 'sessions',
          value: {
            cursor,
            sessions: [
              {
                session: { ...sessionRecord, resource: leakedCoordinate },
                run: null,
                attachable: true,
                controllable: true,
              },
            ],
          },
        }
      : undefined,
  );
  await expect(gateway(leaked).bootstrap()).rejects.toThrow(
    'sdk_session_identity_invalid',
  );

  const local = adapter();
  const mobile = gateway(local);
  const target = {
    coordinate: {
      authority: 'automonique' as const,
      kind: 'session' as const,
      id: 'session-2',
    },
    revision: decimalRevision('1'),
  };
  await expect(mobile.attach(target, null)).rejects.toThrow(
    'mobile_session_unauthorized',
  );
  await expect(
    mobile.followUp({
      session: target,
      text: 'No',
      idempotencyKey: 'key-scope',
    }),
  ).rejects.toThrow('mobile_session_unauthorized');
  expect(local.requests).toHaveLength(0);
});

test('follow-up sends the exact target, revision, parameter, and key', async () => {
  const scripted = adapter();
  const mobile = gateway(scripted);
  const target = {
    coordinate: {
      authority: 'automonique' as const,
      kind: 'session' as const,
      id: 'session-1',
    },
    revision: decimalRevision('9007199254740993'),
  };
  const receipt = await mobile.followUp({
    session: target,
    text: 'Proceed carefully',
    idempotencyKey: 'key-1',
  });
  const followUp = scripted.requests.find(
    (
      request,
    ): request is Extract<PlatformRequest, { method: 'session_follow_up' }> =>
      request.method === 'session_follow_up',
  );

  expect(followUp?.request).toMatchObject({
    expected_session_revision: 9_007_199_254_740_993n,
    idempotency_key: IdempotencyKey('key-1'),
    session: sessionCoordinate,
    text: 'Proceed carefully',
  });
  expect(receipt).toMatchObject({
    id: 'receipt-1',
    outcome: 'completed',
    revision: '9007199254740996',
  });
});

test('approval, stop, and reconciliation stay session-bound', async () => {
  const scripted = adapter();
  const mobile = gateway(scripted);
  const session = {
    coordinate: sessionCoordinate,
    revision: decimalRevision('9007199254740993'),
  };
  const approval = {
    coordinate: approvalCoordinate,
    revision: decimalRevision('9007199254740997'),
  };
  const run = {
    coordinate: runCoordinate,
    revision: decimalRevision('9007199254740994'),
  };

  await mobile.decideApproval({
    session,
    approval,
    decision: 'deny',
    idempotencyKey: 'key-approval',
  });
  await mobile.stopRun({ session, run, idempotencyKey: 'key-stop' });
  await mobile.reconcile({
    action: 'follow_up',
    session,
    target: session,
    idempotencyKey: 'key-follow',
  });

  expect(scripted.requests).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        method: 'session_approval_decision',
        request: expect.objectContaining({
          session: sessionCoordinate,
          expected_session_revision: 9_007_199_254_740_993n,
          approval: approvalCoordinate,
          expected_approval_revision: 9_007_199_254_740_997n,
        }),
      }),
      expect.objectContaining({
        method: 'session_run_stop',
        request: expect.objectContaining({
          session: sessionCoordinate,
          expected_session_revision: 9_007_199_254_740_993n,
          run: runCoordinate,
          expected_run_revision: 9_007_199_254_740_994n,
        }),
      }),
      expect.objectContaining({
        method: 'get_receipt',
        request: expect.objectContaining({
          idempotency_key: IdempotencyKey('key-follow'),
        }),
      }),
    ]),
  );
  expect(
    scripted.requests.some(
      (request) =>
        request.method === 'execute' || request.method === 'snapshot',
    ),
  ).toBe(false);
});

test('typed refusals and unauthorized actions fail closed', async () => {
  const refused = adapter((request) =>
    request.method === 'session_follow_up'
      ? { kind: 'refused', outcome: 'rejected', explanation: 'policy denied' }
      : undefined,
  );
  const target = {
    coordinate: {
      authority: 'automonique' as const,
      kind: 'session' as const,
      id: 'session-1',
    },
    revision: decimalRevision('1'),
  };
  await expect(
    gateway(refused).followUp({
      session: target,
      text: 'Proceed',
      idempotencyKey: 'key-2',
    }),
  ).rejects.toThrow('remote_refusal');

  const unauthorized = adapter();
  await expect(
    gateway(unauthorized, ['attach'] as const).followUp({
      session: target,
      text: 'Proceed',
      idempotencyKey: 'key-3',
    }),
  ).rejects.toThrow('mobile_action_unauthorized');
  expect(unauthorized.requests).toHaveLength(0);
});

test('capability mismatches fail closed before session discovery', async () => {
  const scripted = adapter((request) =>
    request.method === 'capabilities'
      ? {
          kind: 'capabilities',
          value: {
            protocol: 'automonique.platform',
            schema: 'automonique.platform/v1',
            transports: ['remote_https'],
            methods: ['capabilities'],
          },
        }
      : undefined,
  );
  await expect(gateway(scripted).bootstrap()).rejects.toThrow(
    'sdk_capabilities_incompatible',
  );
  expect(scripted.requests).toHaveLength(1);
});

test('attachment identity and history resume scope are checked before paging', async () => {
  const mismatched = adapter((request) =>
    request.method === 'attach'
      ? {
          kind: 'attached',
          value: {
            client: ClientId('different-client'),
            cursor,
            session: sessionCoordinate,
          },
        }
      : undefined,
  );
  const target = {
    coordinate: {
      authority: 'automonique' as const,
      kind: 'session' as const,
      id: 'session-1',
    },
    revision: decimalRevision('1'),
  };
  await expect(gateway(mismatched).attach(target, null)).rejects.toThrow(
    'sdk_attachment_target_mismatch',
  );

  const ahead = adapter();
  await expect(
    gateway(ahead).attach(
      target,
      JSON.stringify(['history', 'session-2', '3']),
    ),
  ).rejects.toThrow('history_cursor_invalid');
  expect(ahead.requests.map((request) => request.method)).toEqual(['attach']);
});

test('retention expiry becomes a typed resync with no partial page', async () => {
  const stale = adapter((request) =>
    request.method === 'session_history_page'
      ? {
          kind: 'session_history_resync',
          session: sessionCoordinate,
          snapshotFrom: SessionHistoryCursor(9n),
          snapshotTo: SessionHistoryCursor(13n),
        }
      : undefined,
  );
  const target = {
    coordinate: {
      authority: 'automonique' as const,
      kind: 'session' as const,
      id: 'session-1',
    },
    revision: decimalRevision('1'),
  };
  const attachment = await gateway(stale).attach(
    target,
    JSON.stringify(['history', 'session-1', '1']),
  );
  const consume = async () => {
    for await (const page of attachment.events()) {
      throw new Error(`partial_page_was_yielded:${page.events.length}`);
    }
  };
  await expect(consume()).rejects.toMatchObject({
    outcome: 'resync_required',
  });
});

test('history projection strips every untyped opaque payload field', async () => {
  const sentinel = 'FORBIDDEN_RAW_PROVIDER_PAYLOAD';
  const sanitized = adapter((request) =>
    request.method === 'session_history_snapshot'
      ? ({
          kind: 'session_history',
          value: {
            session: sessionCoordinate,
            requested_limit: SessionHistoryLimit(100n),
            applied_limit: SessionHistoryLimit(1n),
            from_cursor: SessionHistoryCursor(0n),
            terminal_cursor: SessionHistoryCursor(1n),
            has_more: false,
            events: [
              {
                kind: 'unknown',
                at: PlatformEpochMillis(1_777_000_000_012n),
                cursor: SessionHistoryCursor(1n),
                source: 'adapter_event',
                raw_payload: sentinel,
              },
            ],
          },
        } as unknown as PlatformClientResponse)
      : undefined,
  );
  const mobile = gateway(sanitized);
  const snapshot = await mobile.bootstrap();
  const attachment = await mobile.attach(snapshot.sessions[0]!.target, null);
  const pages = [];
  for await (const page of attachment.events()) pages.push(page);

  expect(JSON.stringify(pages)).not.toContain(sentinel);
  expect(pages[0]?.events[0]).toEqual(
    expect.objectContaining({ kind: 'unknown', eventType: 'adapter_event' }),
  );
});
