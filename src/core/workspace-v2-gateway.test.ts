// SPDX-License-Identifier: Elastic-2.0

import {
  CheckoutId,
  HostSetupId,
  IdempotencyKey,
  MutationApprovalId,
  MutationPreviewId,
  PLATFORM_NEGOTIATION_SCHEMA_V1,
  PLATFORM_SCHEMA_V1,
  PLATFORM_SCHEMA_V2,
  PlatformV2Client,
  ProjectId,
  ReceiptId,
  ResourceId,
  SupportedPlatformVersionNumber,
  UserWorkspaceId,
  WorkContextLabel,
  WorkContextPageLimit,
  WorkContextRequestDigest,
  WorkContextRevision,
  WorkspaceIntentId,
  lifecycleRequestDigest,
  mutationPreviewDigest,
  toCanonicalBytes,
  type JsonValue,
  type MutationApproval,
  type MutationPreview,
  type WorkContextMutationIntent,
  type WorkContextRecord,
} from '@automonique/sdk';
import { DeterministicPlatformV2Adapter } from '@automonique/sdk/testing';
import { fireEvent, render } from '@testing-library/react-native';
import { createElement } from 'react';

import { WorkspaceMutationConfirmation } from '@/components/workspace-mutation-confirmation';
import {
  WorkspaceV2GatewayError,
  createAuthorizedWorkspaceV2Gateway,
  createWorkspaceV2Gateway,
} from './workspace-v2-gateway';

const project = ProjectId('project-mobile');
const projectIdentity = { kind: 'project' as const, id: project };
const checkoutIdentity = {
  kind: 'checkout' as const,
  id: CheckoutId('checkout-mobile'),
};
const hostIdentity = {
  kind: 'host_setup' as const,
  id: HostSetupId('host-mobile'),
};
const repositoryIdentity = {
  kind: 'repository' as const,
  resource: {
    authority: 'github' as const,
    kind: 'repository' as const,
    id: ResourceId('bext-stack/automonique-mobile'),
  },
};
const userWorkspaceIdentity = {
  kind: 'user_workspace' as const,
  id: UserWorkspaceId('workspace-mobile'),
};
const emptyAuthority = {
  credentials: [],
  filesystem: [],
  models: [],
  network: [],
  providers: [],
  tools: [],
} as const;

const negotiatedV2 = {
  kind: 'negotiated' as const,
  negotiated: {
    schema: PLATFORM_SCHEMA_V2,
    version: SupportedPlatformVersionNumber(2n),
    work_context: 'v2_structured' as const,
  },
} as const;

function record(
  identity: WorkContextRecord['identity'],
  label: string,
  revision = 1n,
): WorkContextRecord {
  const common = {
    attributes: { checkout: null, host_setup: null },
    identity,
    label: WorkContextLabel(label),
    lifecycle: 'active' as const,
    revision: WorkContextRevision(revision),
  };
  if (identity.kind === 'project') {
    return {
      ...common,
      relations: [{ kind: 'project_repository', target: repositoryIdentity }],
    };
  }
  if (identity.kind === 'host_setup') {
    return {
      ...common,
      attributes: { checkout: null, host_setup: 'local' },
      relations: [{ kind: 'host_setup_project', target: projectIdentity }],
    };
  }
  if (identity.kind === 'checkout') {
    return {
      ...common,
      attributes: { checkout: 'git_worktree', host_setup: null },
      relations: [
        { kind: 'checkout_project', target: projectIdentity },
        { kind: 'checkout_host_setup', target: hostIdentity },
        { kind: 'checkout_repository', target: repositoryIdentity },
      ],
    };
  }
  if (identity.kind === 'user_workspace') {
    return {
      ...common,
      relations: [
        { kind: 'user_workspace_project', target: projectIdentity },
        { kind: 'user_workspace_checkout', target: checkoutIdentity },
      ],
    };
  }
  return { ...common, relations: [] };
}

function gatewayFor(
  steps: ConstructorParameters<typeof DeterministicPlatformV2Adapter>[0],
  now = 1_500,
) {
  const adapter = new DeterministicPlatformV2Adapter(steps);
  const gateway = createWorkspaceV2Gateway({
    client: new PlatformV2Client(adapter),
    now: () => now,
  });
  return { adapter, gateway };
}

async function negotiate(gateway: ReturnType<typeof gatewayFor>['gateway']) {
  await gateway.negotiate();
}

function createIntent(): Extract<
  WorkContextMutationIntent,
  { readonly kind: 'create_user_workspace' }
> {
  return {
    kind: 'create_user_workspace',
    checkout: {
      identity: checkoutIdentity,
      revision: WorkContextRevision(2n),
    },
    label: WorkContextLabel('Issue 34'),
    project: { identity: projectIdentity, revision: WorkContextRevision(1n) },
  };
}

function preview(
  intent: ReturnType<typeof createIntent>,
  key = IdempotencyKey('workspace-create-1'),
  approval: MutationPreview['approval'] = 'required',
): MutationPreview {
  const proposalInput = {
    actor: { id: 'operator-1', tenant: 'tenant-1' },
    actor_authority: emptyAuthority,
    authority: 'automonique' as const,
    idempotency_key: key,
    intent,
  };
  return {
    approval,
    current: null,
    effective_authority: emptyAuthority,
    expires_at_ms: 2_000n,
    inherited_authority: emptyAuthority,
    issued_at_ms: 1_000n,
    preview: {
      id: MutationPreviewId('preview-workspace-1'),
      revision: WorkContextRevision(1n),
    },
    proposal: {
      ...proposalInput,
      request_digest: lifecycleRequestDigest(proposalInput),
      schema: PLATFORM_SCHEMA_V2,
    },
    resolved_parents: [
      { kind: 'work_context', record: record(projectIdentity, 'Mobile') },
      {
        kind: 'work_context',
        record: {
          ...record(checkoutIdentity, 'Mobile checkout', 2n),
          relations: record(checkoutIdentity, 'Mobile checkout', 2n).relations,
        },
      },
    ],
    resulting: record(userWorkspaceIdentity, 'Issue 34'),
    schema: PLATFORM_SCHEMA_V2,
  };
}

function approvalDocument(
  value: MutationPreview,
  decision: 'granted' | 'denied',
) {
  const approval: MutationApproval = {
    decided_at_ms: 1_600n,
    decided_by: { id: 'operator-1', tenant: 'tenant-1' },
    decision,
    expires_at_ms: 1_900n,
    id: MutationApprovalId('approval-workspace-1'),
    idempotency_key: value.proposal.idempotency_key,
    preview: value.preview,
    preview_digest: mutationPreviewDigest(value),
    request_digest: value.proposal.request_digest,
  };
  const body: JsonValue = {
    kind: 'object',
    entries: [
      [
        'approval',
        {
          kind: 'object',
          entries: Object.entries(approval).map(([key, entry]) => [
            key,
            json(entry),
          ]),
        },
      ],
      ['schema', { kind: 'string', value: PLATFORM_SCHEMA_V2 }],
    ],
  };
  return { approval, canonical: toCanonicalBytes(body) };
}

function json(value: unknown): JsonValue {
  if (value === null) return { kind: 'null' };
  if (typeof value === 'string') return { kind: 'string', value };
  if (typeof value === 'bigint') return { kind: 'integer', value };
  if (typeof value === 'boolean') return { kind: 'bool', value };
  if (Array.isArray(value)) return { kind: 'array', items: value.map(json) };
  return {
    kind: 'object',
    entries: Object.entries(value as Record<string, unknown>).map(
      ([key, entry]) => [key, json(entry)] as const,
    ),
  };
}

function rawReceipt(value: MutationPreview): Uint8Array {
  return toCanonicalBytes(
    json({
      approval_id: null,
      id: ReceiptId('receipt-workspace-1'),
      idempotency_key: value.proposal.idempotency_key,
      outcome: 'accepted',
      preview: value.preview,
      preview_digest: mutationPreviewDigest(value),
      recorded_at_ms: 1_700n,
      request_digest: value.proposal.request_digest,
      resulting_revision: null,
      schema: PLATFORM_SCHEMA_V2,
    }),
  );
}

test('negotiates v2 and consumes a bounded exact project snapshot', async () => {
  const firstCursor = 'page-1' as never;
  const query = (after: null | typeof firstCursor) =>
    ({
      after,
      kinds: [
        'project',
        'host_setup',
        'checkout',
        'user_workspace',
        'attempt_workspace',
        'session',
        'pane',
      ] as const,
      lifecycles: [],
      limit: WorkContextPageLimit(128n),
      parent: null,
      project,
      schema: PLATFORM_SCHEMA_V2,
    }) as const;
  const { adapter, gateway } = gatewayFor([
    { lane: 'negotiation', result: negotiatedV2 },
    {
      lane: 'v2',
      request: { kind: 'query_work_contexts', query: query(null) },
      result: {
        kind: 'work_context_page',
        page: {
          after: null,
          has_more: true,
          items: [
            record(projectIdentity, 'Mobile'),
            record(hostIdentity, 'Mobile host'),
            record(checkoutIdentity, 'Mobile checkout'),
          ],
          next_cursor: firstCursor,
          requested_limit: WorkContextPageLimit(128n),
          schema: PLATFORM_SCHEMA_V2,
        },
      },
    },
    {
      lane: 'v2',
      request: { kind: 'query_work_contexts', query: query(firstCursor) },
      result: {
        kind: 'work_context_page',
        page: {
          after: firstCursor,
          has_more: false,
          items: [record(userWorkspaceIdentity, 'Issue 34')],
          next_cursor: null,
          requested_limit: WorkContextPageLimit(128n),
          schema: PLATFORM_SCHEMA_V2,
        },
      },
    },
  ]);
  await negotiate(gateway);
  await expect(gateway.loadProject(project)).resolves.toHaveLength(4);
  expect(adapter.pendingSteps).toBe(0);
});

test('fails closed on downgrade, explicit refusal, and cursor resync', async () => {
  const downgraded = gatewayFor([
    {
      lane: 'negotiation',
      result: {
        kind: 'negotiated',
        negotiated: {
          schema: PLATFORM_SCHEMA_V1,
          version: SupportedPlatformVersionNumber(1n),
          work_context: 'v1_existing_resources_only',
        },
      },
    },
  ]).gateway;
  await expect(downgraded.negotiate()).rejects.toMatchObject({
    category: 'platform_v2_not_negotiated',
  });

  const refused = gatewayFor([
    {
      lane: 'negotiation',
      result: {
        kind: 'platform_v2_refused',
        refusal: {
          category: 'unsupported',
          explanation: 'future-only server',
          schema: PLATFORM_SCHEMA_V2,
        },
      },
    },
  ]).gateway;
  await expect(refused.negotiate()).rejects.toMatchObject({
    category: 'unsupported',
  });

  const expired = 'expired-cursor' as never;
  const { gateway } = gatewayFor([
    { lane: 'negotiation', result: negotiatedV2 },
    {
      lane: 'v2',
      request: {
        kind: 'query_work_contexts',
        query: {
          after: null,
          kinds: [
            'project',
            'host_setup',
            'checkout',
            'user_workspace',
            'attempt_workspace',
            'session',
            'pane',
          ],
          lifecycles: [],
          limit: WorkContextPageLimit(128n),
          parent: null,
          project,
          schema: PLATFORM_SCHEMA_V2,
        },
      },
      result: {
        kind: 'work_context_page',
        page: {
          after: null,
          has_more: true,
          items: [record(projectIdentity, 'Mobile')],
          next_cursor: expired,
          requested_limit: WorkContextPageLimit(128n),
          schema: PLATFORM_SCHEMA_V2,
        },
      },
    },
    {
      lane: 'v2',
      request: {
        kind: 'query_work_contexts',
        query: {
          after: expired,
          kinds: [
            'project',
            'host_setup',
            'checkout',
            'user_workspace',
            'attempt_workspace',
            'session',
            'pane',
          ],
          lifecycles: [],
          limit: WorkContextPageLimit(128n),
          parent: null,
          project,
          schema: PLATFORM_SCHEMA_V2,
        },
      },
      result: {
        kind: 'work_context_resync',
        resync: {
          expired_after: expired,
          outcome: 'resync_required',
          schema: PLATFORM_SCHEMA_V2,
        },
      },
    },
  ]);
  await negotiate(gateway);
  await expect(gateway.loadProject(project)).rejects.toMatchObject({
    category: 'workspace_v2_resync_required',
  });
});

test('rejects a canonical page whose graph crosses the requested project', async () => {
  const crossProject = ProjectId('project-other');
  const { gateway } = gatewayFor([
    { lane: 'negotiation', result: negotiatedV2 },
    {
      lane: 'v2',
      request: {
        kind: 'query_work_contexts',
        query: {
          after: null,
          kinds: [
            'project',
            'host_setup',
            'checkout',
            'user_workspace',
            'attempt_workspace',
            'session',
            'pane',
          ],
          lifecycles: [],
          limit: WorkContextPageLimit(128n),
          parent: null,
          project,
          schema: PLATFORM_SCHEMA_V2,
        },
      },
      result: {
        kind: 'work_context_page',
        page: {
          after: null,
          has_more: false,
          items: [
            record(projectIdentity, 'Mobile'),
            {
              ...record(hostIdentity, 'Cross-scoped host'),
              relations: [
                {
                  kind: 'host_setup_project',
                  target: { kind: 'project', id: crossProject },
                },
              ],
            },
          ],
          next_cursor: null,
          requested_limit: WorkContextPageLimit(128n),
          schema: PLATFORM_SCHEMA_V2,
        },
      },
    },
  ]);
  await negotiate(gateway);
  await expect(gateway.loadProject(project)).rejects.toMatchObject({
    category: 'workspace_project_graph_cross_scope',
  });
});

test('requires an ephemeral exact preview and never invents mutation success', async () => {
  const intent = createIntent();
  const value = preview(intent, undefined, 'not_required');
  const digest = mutationPreviewDigest(value);
  const { gateway } = gatewayFor([
    { lane: 'negotiation', result: negotiatedV2 },
    {
      lane: 'v2',
      request: {
        kind: 'prepare_mutation',
        request: {
          idempotency_key: value.proposal.idempotency_key,
          intent,
        },
      },
      result: { kind: 'mutation_preview', preview: value },
    },
    {
      lane: 'v2',
      request: {
        kind: 'submit_mutation',
        request: {
          approval_id: null,
          preview: value.preview,
          preview_digest: digest,
        },
      },
      result: {
        kind: 'mutation_receipt',
        receipt: { canonical: rawReceipt(value) },
      },
    },
  ]);
  await negotiate(gateway);
  const prepared = await gateway.prepareMutation(
    project,
    intent,
    value.proposal.idempotency_key,
  );
  await expect(gateway.confirmMutation(prepared, 'grant')).resolves.toEqual({
    kind: 'submitted',
    idempotencyKey: value.proposal.idempotency_key,
    projectionRefreshRequired: true,
  });
  await expect(
    gateway.confirmMutation(prepared, 'grant'),
  ).rejects.toMatchObject({
    category: 'workspace_confirmation_missing_or_replayed',
  });
});

test('records a server denial and drops previews across app reload', async () => {
  const intent = createIntent();
  const value = preview(intent);
  const denied = approvalDocument(value, 'denied');
  const first = gatewayFor([
    { lane: 'negotiation', result: negotiatedV2 },
    {
      lane: 'v2',
      request: {
        kind: 'prepare_mutation',
        request: {
          idempotency_key: value.proposal.idempotency_key,
          intent,
        },
      },
      result: { kind: 'mutation_preview', preview: value },
    },
    {
      lane: 'v2',
      request: {
        kind: 'decide_mutation',
        request: {
          decision: 'denied',
          preview: value.preview,
          preview_digest: mutationPreviewDigest(value),
        },
      },
      result: {
        kind: 'mutation_approval',
        approval: { canonical: denied.canonical },
      },
    },
  ]);
  await negotiate(first.gateway);
  const prepared = await first.gateway.prepareMutation(
    project,
    intent,
    value.proposal.idempotency_key,
  );
  await expect(
    first.gateway.confirmMutation(prepared, 'deny'),
  ).resolves.toMatchObject({
    kind: 'denied',
    approval: { decision: 'denied' },
  });

  const reloaded = gatewayFor([]).gateway;
  await expect(
    reloaded.confirmMutation(prepared, 'grant'),
  ).rejects.toMatchObject({
    category: 'workspace_confirmation_missing_or_replayed',
  });
});

test('cancels only an exact lineage intent revision and rejects self-targeting', async () => {
  const cancelId = WorkspaceIntentId('cancel-intent');
  const targetId = WorkspaceIntentId('create-intent');
  const { gateway } = gatewayFor([
    { lane: 'negotiation', result: negotiatedV2 },
    {
      lane: 'v2',
      request: {
        kind: 'submit_workspace_intent',
        request: {
          project,
          intent: {
            kind: 'cancel',
            request: {
              expected_revision: WorkContextRevision(9n),
              intent_id: cancelId,
              target_intent_id: targetId,
              workspace: userWorkspaceIdentity.id,
            },
          },
        },
      },
      result: {
        kind: 'workspace_intent_result',
        result: { kind: 'cancelled', target_intent_id: targetId },
      },
    },
  ]);
  await negotiate(gateway);
  await expect(
    gateway.cancelWorkspaceIntent(
      project,
      userWorkspaceIdentity.id,
      9n,
      cancelId,
      targetId,
    ),
  ).resolves.toEqual({ kind: 'cancelled', target_intent_id: targetId });
  await expect(
    gateway.cancelWorkspaceIntent(
      project,
      userWorkspaceIdentity.id,
      9n,
      cancelId,
      cancelId,
    ),
  ).rejects.toMatchObject({ category: 'workspace_cancel_target_invalid' });

  const reloaded = gatewayFor([
    { lane: 'negotiation', result: negotiatedV2 },
    {
      lane: 'v2',
      request: {
        kind: 'get_workspace_intent',
        lookup: { project, intent_id: targetId },
      },
      result: {
        kind: 'workspace_intent_result',
        result: { kind: 'cancelled', target_intent_id: targetId },
      },
    },
  ]).gateway;
  await negotiate(reloaded);
  await expect(reloaded.getWorkspaceIntent(project, targetId)).resolves.toEqual(
    { kind: 'cancelled', target_intent_id: targetId },
  );
});

test('authenticated transport fails closed on auth loss, malformed input, and abort', async () => {
  let tokenCalls = 0;
  const unauthorized = createAuthorizedWorkspaceV2Gateway({
    endpoint: 'https://ops.example.test/api/platform/v2',
    token: () => {
      tokenCalls += 1;
      return 'scoped-token';
    },
    fetcher: async () =>
      new Response('', {
        status: 401,
        headers: {
          'cache-control': 'no-store',
          'content-type':
            'application/vnd.automonique.platform.negotiation.v1+json',
        },
      }),
  });
  await expect(unauthorized.negotiate()).rejects.toMatchObject({
    category: 'unauthorized',
  });
  expect(tokenCalls).toBe(1);

  const malformed = createAuthorizedWorkspaceV2Gateway({
    endpoint: 'https://ops.example.test/api/platform/v2',
    token: () => 'scoped-token',
    fetcher: async () =>
      new Response('{"future":true}', {
        status: 200,
        headers: {
          'cache-control': 'no-store',
          'content-type':
            'application/vnd.automonique.platform.negotiation.v1+json',
        },
      }),
  });
  await expect(malformed.negotiate()).rejects.toBeInstanceOf(Error);

  const never = createAuthorizedWorkspaceV2Gateway({
    endpoint: 'https://ops.example.test/api/platform/v2',
    token: () => {
      tokenCalls += 1;
      return 'scoped-token';
    },
    fetcher: async () => {
      throw new Error('fetch must not run');
    },
  });
  const controller = new AbortController();
  controller.abort('app-backgrounded');
  await expect(never.negotiate(controller.signal)).rejects.toMatchObject({
    category: 'aborted',
  });
  expect(tokenCalls).toBe(1);
});

test('stale previews and cross-project create coordinates are refused before submit', async () => {
  const intent = createIntent();
  const stale = preview(intent);
  const staleGateway = gatewayFor(
    [
      { lane: 'negotiation', result: negotiatedV2 },
      {
        lane: 'v2',
        request: {
          kind: 'prepare_mutation',
          request: {
            idempotency_key: stale.proposal.idempotency_key,
            intent,
          },
        },
        result: { kind: 'mutation_preview', preview: stale },
      },
    ],
    2_000,
  ).gateway;
  await negotiate(staleGateway);
  await expect(
    staleGateway.prepareMutation(
      project,
      intent,
      stale.proposal.idempotency_key,
    ),
  ).rejects.toMatchObject({ category: 'preview_expired' });

  const empty = gatewayFor([]).gateway;
  await expect(
    empty.prepareMutation(
      'another-project',
      intent,
      IdempotencyKey('wrong-project'),
    ),
  ).rejects.toMatchObject({ category: 'workspace_project_mismatch' });
});

test('error category remains a stable typed boundary', () => {
  expect(new WorkspaceV2GatewayError('example')).toMatchObject({
    name: 'WorkspaceV2GatewayError',
    category: 'example',
    message: 'example',
  });
  expect(PLATFORM_NEGOTIATION_SCHEMA_V1).toBe(
    'automonique.platform/negotiation/v1',
  );
  expect(WorkContextRequestDigest).toBeDefined();
});

test('confirmation UX exposes the exact preview and separate grant or deny actions', async () => {
  const value = preview(createIntent(), undefined, 'not_required');
  const onConfirm = jest.fn();
  const onDeny = jest.fn();
  const view = await render(
    createElement(WorkspaceMutationConfirmation, {
      prepared: {
        project,
        preview: value,
        previewDigest: mutationPreviewDigest(value),
      },
      onConfirm,
      onDeny,
    }),
  );
  expect(view.getByText('Action · create user workspace')).toBeTruthy();
  expect(view.getByText('Preview revision · 1')).toBeTruthy();
  expect(view.getByText('No authority grants requested.')).toBeTruthy();
  await fireEvent.press(view.getByLabelText('Confirm exact workspace change'));
  await fireEvent.press(view.getByLabelText('Deny workspace change'));
  expect(onConfirm).toHaveBeenCalledTimes(1);
  expect(onDeny).toHaveBeenCalledTimes(1);
});
