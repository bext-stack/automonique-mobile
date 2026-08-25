// SPDX-License-Identifier: Elastic-2.0

import {
  ClientId,
  CursorTopic,
  HttpsPlatformTransport,
  IdempotencyKey,
  PlatformClient,
  PlatformParameter,
  PlatformRevision,
  ResourceId,
  decodeResourceAuthority,
  type ActionReceipt,
  type PlatformClientResponse,
  type PlatformCursor,
  type PlatformMethod,
  type ResourceCoordinate,
  type ResourceRecord,
} from '@automonique/sdk';

import {
  admitMobileAuthorization,
  type MobileAuthorization,
} from './negotiation';
import { normalizeEndpoint } from './network-policy';
import {
  decimalRevision,
  type AttachmentHandle,
  type Coordinate,
  type MobileAction,
  type MobileAutomoniqueGateway,
  type MobileSnapshot,
  type Receipt,
  type SessionEvent,
  type VersionedTarget,
} from './types';

export class MobileGatewayError extends Error {
  constructor(
    readonly category: string,
    readonly outcome?: Receipt['outcome'],
  ) {
    super(category);
    this.name = 'MobileGatewayError';
  }
}

export interface SdkGatewayOptions {
  readonly authorization: MobileAuthorization;
  readonly client: PlatformClient;
  readonly clientId: string;
  readonly expectedServerIdentity: string;
}

export interface AuthorizedHttpsGatewayOptions extends Omit<
  SdkGatewayOptions,
  'client'
> {
  readonly endpoint: string;
  readonly fetcher?: typeof fetch;
  readonly token: () => string | Promise<string>;
}

function sdkCoordinate(value: Coordinate): ResourceCoordinate {
  return {
    authority: value.authority,
    id: ResourceId(value.id),
    kind: value.kind,
  };
}

function mobileCoordinate(value: ResourceCoordinate): Coordinate {
  return { authority: value.authority, id: value.id, kind: value.kind };
}

function sameCoordinate(left: ResourceCoordinate, right: Coordinate): boolean {
  return (
    left.authority === right.authority &&
    left.kind === right.kind &&
    left.id === right.id
  );
}

function cursorToken(cursor: PlatformCursor): string {
  return JSON.stringify([
    cursor.authority,
    cursor.topic,
    cursor.sequence.toString(),
  ]);
}

function parseCursorToken(value: string): PlatformCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new MobileGatewayError('cursor_invalid');
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 3 ||
    parsed.some((entry) => typeof entry !== 'string')
  ) {
    throw new MobileGatewayError('cursor_invalid');
  }
  try {
    return {
      authority: decodeResourceAuthority(parsed[0] as string),
      topic: CursorTopic(parsed[1] as string),
      sequence: PlatformRevision(BigInt(parsed[2] as string)),
    };
  } catch {
    throw new MobileGatewayError('cursor_invalid');
  }
}

function observedAt(value: bigint): string {
  const number = Number(value);
  if (
    Number.isSafeInteger(number) &&
    Math.abs(number) <= 8_640_000_000_000_000
  ) {
    return new Date(number).toISOString();
  }
  return value.toString();
}

function versionedResource(record: ResourceRecord): VersionedTarget {
  return {
    coordinate: mobileCoordinate(record.resource),
    revision: decimalRevision(record.freshness.revision.toString()),
  };
}

function readValue<T extends PlatformClientResponse['kind']>(
  response: PlatformClientResponse,
  kind: T,
): Extract<PlatformClientResponse, { readonly kind: T }> {
  if (response.kind === 'refused') {
    throw new MobileGatewayError(response.explanation, response.outcome);
  }
  if (response.kind !== kind) {
    throw new MobileGatewayError('sdk_response_kind_mismatch');
  }
  return response as Extract<PlatformClientResponse, { readonly kind: T }>;
}

function projectReceipt(value: ActionReceipt, idempotencyKey: string): Receipt {
  return {
    id: value.id,
    idempotencyKey,
    action: value.action as Receipt['action'],
    target: mobileCoordinate(value.target),
    revision: decimalRevision(value.revision.toString()),
    outcome: value.outcome,
    explanation: value.explanation,
  };
}

function refusedReceipt(
  response: Extract<PlatformClientResponse, { readonly kind: 'refused' }>,
  action: Receipt['action'],
  target: VersionedTarget,
  idempotencyKey: string,
): Receipt {
  return {
    id: null,
    idempotencyKey,
    action,
    target: target.coordinate,
    revision: target.revision,
    outcome: response.outcome,
    explanation: response.explanation,
  };
}

function requiredMethods(
  actions: readonly MobileAction[],
): Set<PlatformMethod> {
  const methods = new Set<PlatformMethod>([
    'capabilities',
    'list_sessions',
    'snapshot',
  ]);
  if (actions.includes('attach')) {
    methods.add('attach');
    methods.add('subscribe');
  }
  if (actions.some((action) => action !== 'attach')) {
    methods.add('execute');
    methods.add('get_receipt');
  }
  return methods;
}

function requireMutationTarget(
  action: Receipt['action'],
  target: VersionedTarget,
): void {
  const expectedKind =
    action === 'follow_up'
      ? 'session'
      : action === 'decide_approval'
        ? 'approval'
        : 'run';
  if (
    target.coordinate.authority !== 'automonique' ||
    target.coordinate.kind !== expectedKind
  ) {
    throw new MobileGatewayError('sdk_mutation_target_invalid');
  }
}

function coordinateKey(value: ResourceCoordinate): string {
  return `${value.authority}\u0000${value.kind}\u0000${value.id}`;
}

export function createSdkMobileGateway(
  options: SdkGatewayOptions,
): MobileAutomoniqueGateway {
  const authorization = admitMobileAuthorization(
    options.authorization,
    options.expectedServerIdentity,
  );
  const clientId = ClientId(options.clientId);

  function requireAction(action: MobileAction): void {
    if (!authorization.allowedActions.includes(action)) {
      throw new MobileGatewayError('mobile_action_unauthorized');
    }
  }

  async function mutate(
    action: Receipt['action'],
    target: VersionedTarget,
    idempotencyKey: string,
    parameter: string | null,
    signal?: AbortSignal,
  ): Promise<Receipt> {
    requireMutationTarget(action, target);
    const response = await options.client.execute(
      {
        action,
        expected_revision: PlatformRevision(BigInt(target.revision)),
        idempotency_key: IdempotencyKey(idempotencyKey),
        parameter: parameter === null ? null : PlatformParameter(parameter),
        target: sdkCoordinate(target.coordinate),
      },
      signal,
    );
    if (response.kind === 'refused') {
      return refusedReceipt(response, action, target, idempotencyKey);
    }
    const receipt = readValue(response, 'receipt').value;
    if (
      receipt.action !== action ||
      !sameCoordinate(receipt.target, target.coordinate)
    ) {
      throw new MobileGatewayError('sdk_receipt_target_mismatch');
    }
    return projectReceipt(receipt, idempotencyKey);
  }

  return {
    async bootstrap(signal) {
      const capabilityResponse = readValue(
        await options.client.capabilities(signal),
        'capabilities',
      ).value;
      const advertised = new Set(capabilityResponse.methods);
      if (
        capabilityResponse.protocol !== authorization.protocol ||
        capabilityResponse.schema !== authorization.schema ||
        !capabilityResponse.transports.includes('remote_https') ||
        [...requiredMethods(authorization.allowedActions)].some(
          (method) => !advertised.has(method),
        )
      ) {
        throw new MobileGatewayError('sdk_capabilities_incompatible');
      }

      const sessionsResult = readValue(
        await options.client.listSessions(
          authorization.sessionAuthority,
          null,
          signal,
        ),
        'sessions',
      ).value;
      const sessionIds = new Set<string>();
      for (const session of sessionsResult.sessions) {
        if (
          session.session.resource.authority !==
            authorization.sessionAuthority ||
          session.session.resource.kind !== 'session' ||
          sessionIds.has(session.session.resource.id) ||
          (session.run !== null && session.run.kind !== 'run')
        ) {
          throw new MobileGatewayError('sdk_session_identity_invalid');
        }
        sessionIds.add(session.session.resource.id);
      }
      const runCoordinates = sessionsResult.sessions.flatMap((session) =>
        session.run === null ? [] : [session.run],
      );
      const runRecords = new Map<string, ResourceRecord>();
      if (runCoordinates.length > 0) {
        const snapshot = readValue(
          await options.client.snapshot(runCoordinates, signal),
          'snapshot',
        ).value;
        for (const record of snapshot.resources) {
          const key = coordinateKey(record.resource);
          if (runRecords.has(key)) {
            throw new MobileGatewayError('sdk_snapshot_duplicate_resource');
          }
          runRecords.set(key, record);
        }
        if (
          runCoordinates.some(
            (coordinate) => !runRecords.has(coordinateKey(coordinate)),
          )
        ) {
          throw new MobileGatewayError('sdk_snapshot_incomplete');
        }
      }

      const sessions = sessionsResult.sessions.map((session) => {
        const runRecord =
          session.run === null
            ? undefined
            : runRecords.get(coordinateKey(session.run));
        return {
          target: versionedResource(session.session),
          title: session.session.summary,
          run: runRecord === undefined ? null : versionedResource(runRecord),
          state:
            session.session.freshness.state === 'fresh'
              ? ('active' as const)
              : ('lost' as const),
          attachable: session.attachable,
          followUpAllowed:
            session.controllable &&
            authorization.allowedActions.includes('follow_up'),
          observedAt: observedAt(session.session.freshness.observed_at),
          lastCursor: cursorToken(sessionsResult.cursor),
        };
      });

      return {
        schema: 'automonique.mobile-snapshot/v1',
        connection: {
          phase: 'live',
          label: `${authorization.actor} · ${authorization.serverIdentity}`,
          mutationsAllowed: authorization.allowedActions.some(
            (action) => action !== 'attach',
          ),
          synthetic: false,
          allowedActions: authorization.allowedActions,
          limits: authorization.limits,
        },
        sessions,
        timelines: {},
        approvals: [],
        receipts: [],
      } satisfies MobileSnapshot;
    },

    async attach(session, cursor, signal): Promise<AttachmentHandle> {
      requireAction('attach');
      const attached = readValue(
        await options.client.attach(
          sdkCoordinate(session.coordinate),
          clientId,
          signal,
        ),
        'attached',
      ).value;
      if (
        !sameCoordinate(attached.session, session.coordinate) ||
        attached.client !== clientId
      ) {
        throw new MobileGatewayError('sdk_attachment_target_mismatch');
      }
      const initialCursor =
        cursor === null ? attached.cursor : parseCursorToken(cursor);
      if (
        initialCursor.authority !== attached.cursor.authority ||
        initialCursor.topic !== attached.cursor.topic ||
        initialCursor.sequence > attached.cursor.sequence
      ) {
        throw new MobileGatewayError('sdk_cursor_scope_mismatch');
      }
      return {
        session,
        cursor: cursorToken(initialCursor),
        sequence: decimalRevision(initialCursor.sequence.toString()),
        async *events(eventSignal) {
          const page = readValue(
            await options.client.subscribe(initialCursor, eventSignal),
            'subscription',
          ).value;
          const events: SessionEvent[] = page.events.map((event, index) => ({
            id: `${event.resource.resource.authority}:${event.resource.resource.id}:${event.cursor.sequence}:${index}`,
            cursor: cursorToken(event.cursor),
            sequence: decimalRevision(event.cursor.sequence.toString()),
            createdAt: observedAt(event.resource.freshness.observed_at),
            provenance: 'authoritative',
            kind: 'unknown',
            eventType: `resource_update:${event.resource.resource.kind}`,
          }));
          yield {
            sessionId: session.coordinate.id,
            afterCursor: cursorToken(initialCursor),
            cursor: cursorToken(page.cursor),
            events,
          };
        },
      };
    },

    async followUp(command, signal) {
      requireAction('follow_up');
      if (!command.text.trim()) throw new MobileGatewayError('follow_up_empty');
      if (
        new TextEncoder().encode(command.text).byteLength >
        authorization.limits.maxFollowUpBytes
      ) {
        throw new MobileGatewayError('follow_up_too_large');
      }
      return mutate(
        'follow_up',
        command.session,
        command.idempotencyKey,
        command.text,
        signal,
      );
    },

    decideApproval(command, signal) {
      requireAction('decide_approval');
      return mutate(
        'decide_approval',
        command.approval,
        command.idempotencyKey,
        command.decision,
        signal,
      );
    },

    stopRun(command, signal) {
      requireAction('stop_run');
      return mutate(
        'stop_run',
        command.run,
        command.idempotencyKey,
        null,
        signal,
      );
    },

    async reconcile(idempotencyKey, signal) {
      const response = await options.client.getReceipt(
        { id: null, idempotency_key: IdempotencyKey(idempotencyKey) },
        signal,
      );
      return projectReceipt(
        readValue(response, 'receipt').value,
        idempotencyKey,
      );
    },
  };
}

export function createAuthorizedHttpsGateway(
  options: AuthorizedHttpsGatewayOptions,
): MobileAutomoniqueGateway {
  const endpoint = normalizeEndpoint(options.endpoint, false);
  const transport = new HttpsPlatformTransport(
    endpoint,
    options.token,
    options.fetcher,
  );
  return createSdkMobileGateway({
    ...options,
    client: new PlatformClient(transport),
  });
}
