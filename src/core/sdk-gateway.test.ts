// SPDX-License-Identifier: Elastic-2.0

import {
  ClientId,
  CursorTopic,
  IdempotencyKey,
  PlatformClient,
  PlatformEpochMillis,
  PlatformRevision,
  PlatformText,
  ReceiptId,
  ResourceId,
  type PlatformAdapter,
  type PlatformClientResponse,
  type PlatformRequest,
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
const sessionRecord: ResourceRecord = {
  resource: sessionCoordinate,
  summary: PlatformText('Production incident'),
  freshness: {
    observed_at: PlatformEpochMillis(1_777_000_000_000n),
    revision: PlatformRevision(9_007_199_254_740_993n),
    state: 'fresh',
  },
};
const runRecord: ResourceRecord = {
  resource: runCoordinate,
  summary: PlatformText('Active run'),
  freshness: {
    observed_at: PlatformEpochMillis(1_777_000_000_001n),
    revision: PlatformRevision(9_007_199_254_740_994n),
    state: 'fresh',
  },
};
const cursor = {
  authority: 'automonique' as const,
  topic: CursorTopic('sessions'),
  sequence: PlatformRevision(9_007_199_254_740_995n),
};

function authorization(
  allowedActions: readonly MobileAction[] = [
    'attach',
    'follow_up',
    'decide_approval',
    'stop_run',
  ],
) {
  return {
    protocol: 'automonique.platform' as const,
    schema: 'automonique.platform/v1' as const,
    serverIdentity: 'server-1',
    actor: 'operator-1',
    sessionAuthority: 'automonique' as const,
    allowedActions,
    limits: { maxPageEvents: 100, maxFollowUpBytes: 4_096 },
  };
}

function adapter(
  override?: (request: PlatformRequest) => PlatformClientResponse | undefined,
): { client: PlatformClient; requests: PlatformRequest[] } {
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
                'snapshot',
                'attach',
                'subscribe',
                'execute',
                'get_receipt',
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
        case 'snapshot':
          return {
            kind: 'snapshot',
            value: { cursor, resources: [runRecord] },
          };
        case 'attach':
          return {
            kind: 'attached',
            value: {
              client: ClientId('mobile-1'),
              cursor,
              session: sessionCoordinate,
            },
          };
        case 'subscribe':
          return { kind: 'subscription', value: { cursor, events: [] } };
        case 'execute':
          return {
            kind: 'receipt',
            value: {
              id: ReceiptId('receipt-1'),
              action: request.request.action,
              target: request.request.target,
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
  return { client: new PlatformClient(transport), requests };
}

function gateway(
  client: PlatformClient,
  allowedActions?: readonly MobileAction[],
) {
  return createSdkMobileGateway({
    authorization: authorization(allowedActions),
    client,
    clientId: 'mobile-1',
    expectedServerIdentity: 'server-1',
  });
}

test('canonical SDK bootstrap preserves exact revisions and drives attachment', async () => {
  const scripted = adapter();
  const mobile = gateway(scripted.client);
  const snapshot = await mobile.bootstrap();

  expect(snapshot.sessions[0]?.target.revision).toBe('9007199254740993');
  expect(snapshot.sessions[0]?.run?.revision).toBe('9007199254740994');
  expect(snapshot.sessions[0]?.followUpAllowed).toBe(true);
  expect(snapshot.connection.synthetic).toBe(false);

  const attachment = await mobile.attach(snapshot.sessions[0]!.target, null);
  const pages = [];
  for await (const page of attachment.events()) pages.push(page);
  expect(pages).toHaveLength(1);
  expect(scripted.requests.map((request) => request.method)).toEqual([
    'capabilities',
    'list_sessions',
    'snapshot',
    'attach',
    'subscribe',
  ]);
});

test('follow-up sends the exact target, revision, parameter, and key', async () => {
  const scripted = adapter();
  const mobile = gateway(scripted.client);
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
  const execute = scripted.requests.find(
    (request): request is Extract<PlatformRequest, { method: 'execute' }> =>
      request.method === 'execute',
  );

  expect(execute?.request).toMatchObject({
    action: 'follow_up',
    expected_revision: 9_007_199_254_740_993n,
    idempotency_key: IdempotencyKey('key-1'),
    parameter: 'Proceed carefully',
    target: sessionCoordinate,
  });
  expect(receipt).toMatchObject({
    id: 'receipt-1',
    outcome: 'completed',
    revision: '9007199254740996',
  });
});

test('typed refusals remain non-success receipts and unauthorized actions fail locally', async () => {
  const refused = adapter((request) =>
    request.method === 'execute'
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
    gateway(refused.client).followUp({
      session: target,
      text: 'Proceed',
      idempotencyKey: 'key-2',
    }),
  ).resolves.toMatchObject({ id: null, outcome: 'rejected' });

  const unauthorized = adapter();
  await expect(
    gateway(unauthorized.client, ['attach'] as const).followUp({
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
  await expect(gateway(scripted.client).bootstrap()).rejects.toThrow(
    'sdk_capabilities_incompatible',
  );
  expect(scripted.requests).toHaveLength(1);
});

test('attachment identity and resume scope are checked before subscription', async () => {
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
  await expect(gateway(mismatched.client).attach(target, null)).rejects.toThrow(
    'sdk_attachment_target_mismatch',
  );

  const ahead = adapter();
  await expect(
    gateway(ahead.client).attach(
      target,
      JSON.stringify(['automonique', 'sessions', '9007199254740996']),
    ),
  ).rejects.toThrow('sdk_cursor_scope_mismatch');
  expect(ahead.requests.map((request) => request.method)).toEqual(['attach']);
});
