// SPDX-License-Identifier: Elastic-2.0

import {
  HttpsPlatformTransport,
  MobileSessionClient,
  MobileServerIdentity,
  PlatformClient,
  ResourceId,
  SessionHistoryResyncError,
  mobilePlatformClientId,
  type ActionReceipt,
  type PlatformClientResponse,
  type PlatformCursor,
  type PlatformMethod,
  type ResourceCoordinate,
  type ResourceRecord,
  type SessionCommandState,
  type SessionHistoryEvent as SdkSessionHistoryEvent,
  type SessionHistoryPage as SdkSessionHistoryPage,
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
  readonly sessionClient: MobileSessionClient;
  readonly expectedServerIdentity: string;
  readonly now?: number;
}

export interface AuthorizedHttpsGatewayOptions extends Omit<
  SdkGatewayOptions,
  'client' | 'sessionClient'
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

function historyCursorToken(sessionId: string, cursor: bigint): string {
  return JSON.stringify(['history', sessionId, cursor.toString()]);
}

function parseHistoryCursorToken(value: string, sessionId: string): bigint {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new MobileGatewayError('history_cursor_invalid');
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 3 ||
    parsed[0] !== 'history' ||
    parsed[1] !== sessionId ||
    typeof parsed[2] !== 'string' ||
    !/^(0|[1-9][0-9]*)$/.test(parsed[2])
  ) {
    throw new MobileGatewayError('history_cursor_invalid');
  }
  const cursor = BigInt(parsed[2]);
  if (cursor > 9_223_372_036_854_775_807n) {
    throw new MobileGatewayError('history_cursor_invalid');
  }
  return cursor;
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

function historyEvent(
  sessionId: string,
  event: SdkSessionHistoryEvent,
): SessionEvent {
  const base = {
    id: `history:${sessionId}:${event.cursor}`,
    cursor: historyCursorToken(sessionId, event.cursor),
    sequence: decimalRevision(event.cursor.toString()),
    createdAt: observedAt(event.at),
  } as const;
  switch (event.kind) {
    case 'message':
      return {
        ...base,
        provenance: event.evidence,
        kind: 'message',
        role: event.role,
        text: event.text,
      };
    case 'tool_state':
      return {
        ...base,
        provenance: event.evidence,
        kind: 'tool',
        name: event.label ?? 'Tool activity',
        state: event.state,
        publicText: null,
      };
    case 'run_state':
      return {
        ...base,
        provenance: 'authoritative',
        kind: 'run_state',
        state: event.state,
      };
    case 'unknown':
      return {
        ...base,
        provenance: 'authoritative',
        kind: 'unknown',
        eventType: event.source,
      };
  }
}

function requireHistoryPage(
  page: SdkSessionHistoryPage,
  session: Coordinate,
): void {
  if (
    !sameCoordinate(page.session, session) ||
    page.applied_limit > page.requested_limit ||
    page.events.length > Number(page.applied_limit)
  ) {
    throw new MobileGatewayError('sdk_history_page_invalid');
  }
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

function requiredMethods(
  actions: readonly MobileAction[],
): Set<PlatformMethod> {
  const methods = new Set<PlatformMethod>(['capabilities', 'list_sessions']);
  if (actions.includes('attach')) {
    methods.add('attach');
    methods.add('session_history_page');
    methods.add('session_history_snapshot');
  }
  if (actions.some((action) => action !== 'attach')) {
    methods.add('session_command_state');
    methods.add('get_receipt');
  }
  if (actions.includes('follow_up')) methods.add('session_follow_up');
  if (actions.includes('stop_run')) methods.add('session_run_stop');
  if (actions.includes('decide_approval')) {
    methods.add('session_approval_decision');
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

function versionedCommandTarget(
  value: NonNullable<SessionCommandState['run']>,
): VersionedTarget {
  return {
    coordinate: mobileCoordinate(value.target),
    revision: decimalRevision(value.revision.toString()),
  };
}

export function createSdkMobileGateway(
  options: SdkGatewayOptions,
): MobileAutomoniqueGateway {
  const authorization = admitMobileAuthorization(
    options.authorization,
    options.expectedServerIdentity,
    options.now,
  );
  const clientId = mobilePlatformClientId(authorization);
  const sessionScope = new Set<string>(authorization.session_scope);

  function requireAction(action: MobileAction): void {
    if (!authorization.actions.includes(action)) {
      throw new MobileGatewayError('mobile_action_unauthorized');
    }
  }

  function requireSessionScope(sessionId: string): void {
    if (!sessionScope.has(sessionId)) {
      throw new MobileGatewayError('mobile_session_unauthorized');
    }
  }

  return {
    async bootstrap(signal) {
      const capabilityResponse = readValue(
        await options.client.capabilities(signal),
        'capabilities',
      ).value;
      const advertised = new Set(capabilityResponse.methods);
      if (
        capabilityResponse.protocol !== 'automonique.platform' ||
        capabilityResponse.schema !== 'automonique.platform/v1' ||
        !capabilityResponse.transports.includes('remote_https') ||
        [...requiredMethods(authorization.actions)].some(
          (method) => !advertised.has(method),
        )
      ) {
        throw new MobileGatewayError('sdk_capabilities_incompatible');
      }

      const sessionsResult = readValue(
        await options.client.listSessions('automonique', null, signal),
        'sessions',
      ).value;
      const sessionIds = new Set<string>();
      for (const session of sessionsResult.sessions) {
        if (
          session.session.resource.authority !== 'automonique' ||
          session.session.resource.kind !== 'session' ||
          !sessionScope.has(session.session.resource.id) ||
          sessionIds.has(session.session.resource.id) ||
          (session.run !== null && session.run.kind !== 'run')
        ) {
          throw new MobileGatewayError('sdk_session_identity_invalid');
        }
        sessionIds.add(session.session.resource.id);
      }
      const mutationsAllowed = authorization.actions.some(
        (action) => action !== 'attach',
      );
      const commandStates = mutationsAllowed
        ? await Promise.all(
            sessionsResult.sessions.map((session) =>
              options.sessionClient.commandState(
                session.session.resource,
                signal,
              ),
            ),
          )
        : sessionsResult.sessions.map(() => null);
      const approvals: MobileSnapshot['approvals'][number][] = [];
      const approvalTargets = new Set<string>();
      const sessions = sessionsResult.sessions.map((session, index) => {
        const commandState = commandStates[index] ?? null;
        const sessionRecord = commandState?.session ?? session.session;
        if (!sameCoordinate(sessionRecord.resource, session.session.resource)) {
          throw new MobileGatewayError('sdk_command_state_session_mismatch');
        }
        const target = versionedResource(sessionRecord);
        if (commandState) {
          for (const pending of commandState.pending_approvals) {
            const key = coordinateKey(pending.target);
            if (approvalTargets.has(key)) {
              throw new MobileGatewayError('sdk_approval_target_duplicate');
            }
            approvalTargets.add(key);
            approvals.push({
              session: target,
              target: versionedCommandTarget(pending),
              approvalType: 'automonique',
              title: 'Approval required',
              detail: 'Review this pending session approval before deciding.',
              impact: 'The effect is determined by the authoritative session.',
              requester: authorization.actor,
              expiresAt: null,
            });
          }
        }
        return {
          target,
          title: sessionRecord.summary,
          run:
            commandState?.run === null || commandState === null
              ? null
              : versionedCommandTarget(commandState.run),
          state:
            sessionRecord.freshness.state === 'fresh'
              ? ('active' as const)
              : ('lost' as const),
          attachable: session.attachable,
          followUpAllowed:
            session.controllable && authorization.actions.includes('follow_up'),
          followUpFenceRevision: null,
          observedAt: observedAt(sessionRecord.freshness.observed_at),
          lastCursor: cursorToken(sessionsResult.cursor),
        };
      });

      return {
        schema: 'automonique.mobile-snapshot/v1',
        connection: {
          phase: 'live',
          label: `${authorization.actor} · ${authorization.server_identity}`,
          mutationsAllowed,
          synthetic: false,
          allowedActions: authorization.actions,
          limits: {
            maxPageEvents: Number(authorization.limits.max_page_events),
            maxFollowUpBytes: Number(authorization.limits.max_follow_up_bytes),
          },
        },
        sessions,
        timelines: {},
        approvals,
        receipts: [],
      } satisfies MobileSnapshot;
    },

    async attach(session, cursor, signal): Promise<AttachmentHandle> {
      requireAction('attach');
      requireSessionScope(session.coordinate.id);
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
      let prefetched: SdkSessionHistoryPage | null = null;
      let initialHistoryCursor: bigint;
      try {
        if (cursor === null) {
          prefetched = await options.client.sessionHistorySnapshot(
            sdkCoordinate(session.coordinate),
            authorization.limits.max_page_events,
            signal,
          );
          requireHistoryPage(prefetched, session.coordinate);
          initialHistoryCursor = prefetched.from_cursor;
        } else {
          initialHistoryCursor = parseHistoryCursorToken(
            cursor,
            session.coordinate.id,
          );
        }
      } catch (error) {
        if (error instanceof SessionHistoryResyncError) {
          throw new MobileGatewayError(
            'session_history_resync_required',
            'resync_required',
          );
        }
        throw error;
      }
      const initialCursor = historyCursorToken(
        session.coordinate.id,
        initialHistoryCursor,
      );
      return {
        session,
        cursor: initialCursor,
        sequence:
          initialHistoryCursor === 0n
            ? null
            : decimalRevision(initialHistoryCursor.toString()),
        async *events(eventSignal) {
          let page = prefetched;
          let after = initialHistoryCursor;
          for (;;) {
            try {
              page ??= await options.client.sessionHistoryPage(
                sdkCoordinate(session.coordinate),
                after,
                authorization.limits.max_page_events,
                eventSignal,
              );
            } catch (error) {
              if (error instanceof SessionHistoryResyncError) {
                throw new MobileGatewayError(
                  'session_history_resync_required',
                  'resync_required',
                );
              }
              throw error;
            }
            requireHistoryPage(page, session.coordinate);
            if (page.from_cursor !== after) {
              throw new MobileGatewayError('sdk_history_cursor_mismatch');
            }
            yield {
              sessionId: session.coordinate.id,
              afterCursor: historyCursorToken(
                session.coordinate.id,
                page.from_cursor,
              ),
              cursor: historyCursorToken(
                session.coordinate.id,
                page.terminal_cursor,
              ),
              events: page.events.map((event) =>
                historyEvent(session.coordinate.id, event),
              ),
            };
            if (!page.has_more) break;
            after = page.terminal_cursor;
            page = null;
          }
        },
      };
    },

    async followUp(command, signal) {
      requireAction('follow_up');
      requireSessionScope(command.session.coordinate.id);
      if (!command.text.trim()) throw new MobileGatewayError('follow_up_empty');
      if (
        new TextEncoder().encode(command.text).byteLength >
        authorization.limits.max_follow_up_bytes
      ) {
        throw new MobileGatewayError('follow_up_too_large');
      }
      requireMutationTarget('follow_up', command.session);
      const receipt = await options.sessionClient.followUp(
        {
          session: sdkCoordinate(command.session.coordinate),
          expectedSessionRevision: BigInt(command.session.revision),
          idempotencyKey: command.idempotencyKey,
          text: command.text,
        },
        signal,
      );
      return projectReceipt(receipt, command.idempotencyKey);
    },

    async decideApproval(command, signal) {
      requireAction('decide_approval');
      requireSessionScope(command.session.coordinate.id);
      requireMutationTarget('decide_approval', command.approval);
      const receipt = await options.sessionClient.decideApproval(
        {
          session: sdkCoordinate(command.session.coordinate),
          expectedSessionRevision: BigInt(command.session.revision),
          approval: sdkCoordinate(command.approval.coordinate),
          expectedApprovalRevision: BigInt(command.approval.revision),
          idempotencyKey: command.idempotencyKey,
          decision: command.decision,
        },
        signal,
      );
      return projectReceipt(receipt, command.idempotencyKey);
    },

    async stopRun(command, signal) {
      requireAction('stop_run');
      requireSessionScope(command.session.coordinate.id);
      requireMutationTarget('stop_run', command.run);
      const receipt = await options.sessionClient.stopRun(
        {
          session: sdkCoordinate(command.session.coordinate),
          expectedSessionRevision: BigInt(command.session.revision),
          run: sdkCoordinate(command.run.coordinate),
          expectedRunRevision: BigInt(command.run.revision),
          idempotencyKey: command.idempotencyKey,
        },
        signal,
      );
      return projectReceipt(receipt, command.idempotencyKey);
    },

    async reconcile(request, signal) {
      requireAction(request.action);
      requireSessionScope(request.session.coordinate.id);
      requireMutationTarget(request.action, request.target);
      const receipt = await options.sessionClient.reconcileReceipt(
        {
          session: sdkCoordinate(request.session.coordinate),
          expectedAction: request.action,
          expectedTarget: sdkCoordinate(request.target.coordinate),
          idempotencyKey: request.idempotencyKey,
        },
        signal,
      );
      return projectReceipt(receipt, request.idempotencyKey);
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
    sessionClient: new MobileSessionClient(
      transport,
      options.authorization,
      MobileServerIdentity(options.expectedServerIdentity),
      () => options.now ?? Date.now(),
    ),
  });
}
