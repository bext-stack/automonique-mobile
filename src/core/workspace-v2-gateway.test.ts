// SPDX-License-Identifier: Elastic-2.0

import {
  AttemptWorkspaceId,
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
  ReviewConfirmationDigest,
  ReviewReceiptCorrelationDigest,
  ResourceId,
  SupportedPlatformVersionNumber,
  WorkSessionId,
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
  type ReviewSnapshot,
  type WorkContextMutationIntent,
  type WorkContextRecord,
} from '@automonique/sdk';
import { DeterministicPlatformV2Adapter } from '@automonique/sdk/testing';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render } from '@testing-library/react-native';
import { createElement } from 'react';

import { WorkspaceMutationConfirmation } from '@/components/workspace-mutation-confirmation';
import {
  MOBILE_V2_ACTIONS,
  MOBILE_V2_AUTHORIZATION_SCHEMA,
  type DelegatedMobileV2Authorization,
} from './mobile-v2-authorization';
import {
  WorkspaceV2GatewayError,
  createAuthorizedWorkspaceV2Gateway,
  createWorkspaceV2Gateway,
  type WorkspaceV2OperationGuard,
} from './workspace-v2-gateway';
import {
  WORKSPACE_V2_RECEIPT_HANDLE_SCHEMA,
  type WorkspaceV2ReceiptHandle,
  type WorkspaceV2ReceiptStore,
} from './workspace-v2-receipts';
import {
  createWorkspaceV2ReceiptStore,
  migrateLegacyWorkspaceV2Receipts,
} from './workspace-v2-receipt-storage';
import {
  REVIEW_V2_RECEIPT_HANDLE_SCHEMA,
  type ReviewV2ReceiptHandle,
  type ReviewV2ReceiptStore,
} from './review-v2-receipts';
import {
  MOBILE_DIRECT_REVIEW_EFFECT_KINDS,
  MOBILE_SUPPORTED_REVIEW_EFFECT_KINDS,
  MOBILE_UNAVAILABLE_REVIEW_EFFECT_CATEGORIES,
  unavailableReviewEffectCategory,
  type MobileDirectReviewAction,
  type MobileSupportedReviewAction,
  type MobileSupportedReviewEffectKind,
} from './mobile-review-effects';

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('expo-crypto', () => {
  const crypto =
    jest.requireActual<typeof import('node:crypto')>('node:crypto');
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    digestStringAsync: async (_algorithm: string, value: string) =>
      crypto.createHash('sha256').update(value).digest('hex'),
  };
});
type ReceiptStore = WorkspaceV2ReceiptStore & {
  readonly handles: WorkspaceV2ReceiptHandle[];
};
type ReviewReceiptStore = ReviewV2ReceiptStore & {
  readonly handles: ReviewV2ReceiptHandle[];
};

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
const authorizationDigest = `sha256:${'c'.repeat(64)}`;
const rerunReceiptCorrelationDigest = ReviewReceiptCorrelationDigest(
  'cd'.repeat(32),
);

function correlatedRerunHandle(
  overrides: Partial<ReviewV2ReceiptHandle> = {},
): ReviewV2ReceiptHandle {
  return {
    schema: REVIEW_V2_RECEIPT_HANDLE_SCHEMA,
    authorization_digest: authorizationDigest,
    project,
    workspace_kind: 'user_workspace',
    workspace_id: userWorkspaceIdentity.id,
    expected_revision: '7',
    authority_kind: 'ci',
    authority_id: 'ci-github-actions',
    actor_id: 'operator-mobile',
    action_kind: 'rerun_check',
    action_digest: `sha256:${'e'.repeat(64)}`,
    idempotency_key: 'mobile-check-rerun-recovery',
    created_at_ms: '1500',
    expected_workspace_revision: '9',
    receipt_correlation_digest: rerunReceiptCorrelationDigest,
    ...overrides,
  };
}

function delegatedAuthorization(now = 1_500): DelegatedMobileV2Authorization {
  return {
    schema: MOBILE_V2_AUTHORIZATION_SCHEMA,
    server_identity: `sha256:${'a'.repeat(64)}`,
    credential_id: 'credential-mobile',
    credential_revision: 1n,
    authorization_revision: 1n,
    principal_generation: 1n,
    delegation_id: 'delegation-mobile',
    tenant_id: 'tenant-mobile',
    actor_id: 'operator-mobile',
    issued_at_ms: BigInt(now - 1),
    expires_at_ms: BigInt(now + 60_000),
    project_roots: [project],
    actions: MOBILE_V2_ACTIONS,
  };
}

function memoryReceiptStore(): ReceiptStore {
  const handles: WorkspaceV2ReceiptHandle[] = [];
  return {
    handles,
    async list() {
      return [...handles];
    },
    async put(handle) {
      const index = handles.findIndex(
        (candidate) => candidate.idempotency_key === handle.idempotency_key,
      );
      if (index === -1) {
        handles.push(handle);
        return true;
      }
      handles[index] = handle;
      return false;
    },
    async remove(idempotencyKey) {
      const index = handles.findIndex(
        (candidate) => candidate.idempotency_key === idempotencyKey,
      );
      if (index !== -1) handles.splice(index, 1);
    },
  };
}

function memoryReviewReceiptStore(): ReviewReceiptStore {
  const handles: ReviewV2ReceiptHandle[] = [];
  return {
    handles,
    async list() {
      return [...handles];
    },
    async put(handle) {
      const existing = handles.find(
        (candidate) => candidate.idempotency_key === handle.idempotency_key,
      );
      if (existing !== undefined) {
        if (JSON.stringify(existing) !== JSON.stringify(handle)) {
          throw new Error('review_receipt_handle_collision');
        }
        return false;
      }
      handles.push(handle);
      return true;
    },
    async remove(idempotencyKey) {
      const index = handles.findIndex(
        (candidate) => candidate.idempotency_key === idempotencyKey,
      );
      if (index !== -1) handles.splice(index, 1);
    },
  };
}

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

function gatewayFor<T extends WorkspaceV2ReceiptStore = ReceiptStore>(
  steps: ConstructorParameters<typeof DeterministicPlatformV2Adapter>[0],
  now = 1_500,
  receiptStore: T = memoryReceiptStore() as unknown as T,
  authorization = delegatedAuthorization(now),
  operationGuard?: WorkspaceV2OperationGuard,
  digest = authorizationDigest,
  reviewReceiptStore?: ReviewV2ReceiptStore,
) {
  const adapter = new DeterministicPlatformV2Adapter(steps);
  const gateway = createWorkspaceV2Gateway({
    authorization,
    authorizationDigest: async () => digest,
    client: new PlatformV2Client(adapter),
    now: () => now,
    ...(operationGuard === undefined ? {} : { operationGuard }),
    receiptStore,
    ...(reviewReceiptStore === undefined ? {} : { reviewReceiptStore }),
  });
  return { adapter, gateway, receiptStore };
}

function projectSnapshotStep(workspaceRevision = 9n) {
  return {
    lane: 'v2' as const,
    request: {
      kind: 'query_work_contexts' as const,
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
        ] as const,
        lifecycles: [],
        limit: WorkContextPageLimit(128n),
        parent: null,
        project,
        schema: PLATFORM_SCHEMA_V2 as typeof PLATFORM_SCHEMA_V2,
      },
    },
    result: {
      kind: 'work_context_page' as const,
      page: {
        after: null,
        has_more: false,
        items: [
          record(projectIdentity, 'Mobile'),
          record(hostIdentity, 'Mobile host'),
          record(checkoutIdentity, 'Mobile checkout', 2n),
          record(userWorkspaceIdentity, 'Issue 34', workspaceRevision),
        ],
        next_cursor: null,
        requested_limit: WorkContextPageLimit(128n),
        schema: PLATFORM_SCHEMA_V2 as typeof PLATFORM_SCHEMA_V2,
      },
    },
  };
}

async function negotiate(gateway: ReturnType<typeof gatewayFor>['gateway']) {
  await gateway.negotiate();
}

function reviewSnapshot(): ReviewSnapshot {
  return {
    schema: 'automonique.platform/review/v2',
    platform_version: 2n as const,
    revision: 7n,
    workspace: userWorkspaceIdentity,
    attention: {
      reason: 'approval_required',
      source_revision: 3n,
      state: 'needs_you',
      unread: 1n,
    },
    attention_events: [
      {
        id: 'attention-approval-1',
        origin: {
          authority: { kind: 'review', id: 'review-local' },
          id: null,
          kind: 'review',
          revision: 3n,
        },
        reason: 'approval_required',
        unread: 1n,
      },
    ],
    files: [],
    checks: [],
    comments: [],
    proposals: [],
    review: {
      authority: { kind: 'review', id: 'review-local' },
      decision: 'pending',
      freshness: {
        observed_at_ms: 1_500n,
        observed_revision: 3n,
        state: 'fresh',
      },
    },
    pull_request: {
      authority: { kind: 'pull_request', id: 'pull-request-local' },
      freshness: {
        observed_at_ms: 1_500n,
        observed_revision: 1n,
        state: 'fresh',
      },
      head_revision: null,
      id: null,
      readiness: 'unknown',
      state: 'absent',
    },
    delivery: {
      authority: { kind: 'delivery', id: 'delivery-local' },
      freshness: {
        observed_at_ms: 1_500n,
        observed_revision: 1n,
        state: 'fresh',
      },
      id: null,
      state: 'not_delivered',
    },
  } as ReviewSnapshot;
}

function reviewSnapshotWithAgentComment(): ReviewSnapshot {
  return {
    ...reviewSnapshot(),
    files: [
      {
        id: 'file-1',
        path: 'src/exact.ts',
        change: 'modified',
        conflict: 'none',
        worktree: 'unstaged',
        preview: {
          byte_size: 12n,
          height: null,
          kind: 'text',
          media_type: 'text/plain',
          sanitized: true,
          width: null,
        },
        hunks: [
          {
            id: 'hunk-1',
            old_start: 1n,
            old_lines: 1n,
            new_start: 1n,
            new_lines: 1n,
            preview: '-old +new',
          },
        ],
      },
    ],
    comments: [
      {
        actor: 'operator-mobile',
        agent_state: 'not_sent',
        anchor: {
          file_id: 'file-1',
          hunk_id: 'hunk-1',
          line: 1n,
          side: 'new',
        },
        body: 'Please address this exact finding.',
        id: 'comment-1',
        revision: 4n,
        unread: false,
      },
    ],
  } as ReviewSnapshot;
}

function reviewSnapshotWithFailedCheck(): ReviewSnapshot {
  return {
    ...reviewSnapshot(),
    checks: [
      {
        authority: { kind: 'ci', id: 'ci-github-actions' },
        freshness: {
          observed_at_ms: 1_500n,
          observed_revision: 5n,
          state: 'fresh',
        },
        id: 'check-1',
        required: true,
        state: 'failed',
      },
    ],
  } as ReviewSnapshot;
}

function reviewAuthorization(now = 1_500): DelegatedMobileV2Authorization {
  return delegatedAuthorization(now);
}

test('executes and durably reconciles an authority-bound review action', async () => {
  const snapshot = reviewSnapshot();
  const action = {
    kind: 'approve_review' as const,
    payload: { expected_review_revision: 3n },
  };
  const idempotencyKey = IdempotencyKey('mobile-review-action-1');
  const reviewStore = memoryReviewReceiptStore();
  const { gateway, adapter } = gatewayFor(
    [
      { lane: 'negotiation', result: negotiatedV2 },
      projectSnapshotStep(),
      {
        lane: 'v2',
        request: {
          kind: 'get_review',
          request: { project, workspace: userWorkspaceIdentity },
        },
        result: { kind: 'review_result', review: snapshot },
      },
      {
        lane: 'v2',
        request: {
          kind: 'execute_review_action',
          request: {
            workspace: userWorkspaceIdentity,
            expected_revision: WorkContextRevision(7n),
            action,
            idempotency_key: idempotencyKey,
          },
        },
        result: {
          kind: 'review_receipt',
          receipt: {
            schema: 'automonique.platform/review/v1',
            platform_version: 2n,
            receipt_id: 'review-receipt-1',
            action_id: 'review-action-1',
            actor: 'operator-mobile',
            idempotency_key: idempotencyKey,
            outcome: 'accepted',
            reconciliation: 'poll_receipt',
            revision: null,
            current_revision: null,
          },
        },
      },
      {
        lane: 'v2',
        request: {
          kind: 'get_review_receipt',
          lookup: {
            project,
            workspace: userWorkspaceIdentity,
            idempotency_key: idempotencyKey,
          },
        },
        result: {
          kind: 'review_receipt',
          receipt: {
            schema: 'automonique.platform/review/v1',
            platform_version: 2n,
            receipt_id: 'review-receipt-1',
            action_id: 'review-action-1',
            actor: 'operator-mobile',
            idempotency_key: idempotencyKey,
            outcome: 'completed',
            reconciliation: 'final',
            revision: 8n,
            current_revision: null,
          },
        },
      },
    ],
    1_500,
    memoryReceiptStore(),
    reviewAuthorization(),
    undefined,
    authorizationDigest,
    reviewStore,
  );
  await negotiate(gateway);
  expect(gateway.reviewEffectKinds).toEqual([
    'add_comment',
    'approve_review',
    'send_comment_to_agent',
    'batch_send_comments_to_agent',
    'rerun_check',
  ]);
  expect(Object.isFrozen(gateway.reviewEffectKinds)).toBe(true);
  await gateway.loadProject(project);
  await gateway.loadReview(project, userWorkspaceIdentity);

  await expect(
    gateway.executeReviewAction(
      project,
      userWorkspaceIdentity,
      7n,
      snapshot.review.authority,
      action,
      idempotencyKey,
    ),
  ).resolves.toMatchObject({
    kind: 'submitted',
    receipt: { outcome: 'accepted' },
  });
  expect(reviewStore.handles).toHaveLength(1);
  expect(reviewStore.handles[0]).toMatchObject({
    expected_revision: '7',
    authority_kind: 'review',
    authority_id: 'review-local',
    actor_id: 'operator-mobile',
    action_kind: 'approve_review',
    expected_workspace_revision: null,
    receipt_correlation_digest: null,
  });
  await expect(gateway.pendingReviewReceipts()).resolves.toHaveLength(1);
  await expect(
    gateway.reconcileReviewAction(idempotencyKey),
  ).resolves.toMatchObject({
    receipt: { outcome: 'completed', revision: 8n },
    projectionRefreshRequired: true,
  });
  expect(reviewStore.handles).toEqual([]);
  expect(adapter.pendingSteps).toBe(0);
});

test('retains and reconciles an exact comment-to-agent delivery without storing its body', async () => {
  const snapshot = reviewSnapshotWithAgentComment();
  const action = {
    kind: 'send_comment_to_agent' as const,
    payload: { comment_id: 'comment-1', expected_comment_revision: 4n },
  };
  const idempotencyKey = IdempotencyKey('mobile-agent-delivery-1');
  const reviewStore = memoryReviewReceiptStore();
  const { gateway, adapter } = gatewayFor(
    [
      { lane: 'negotiation', result: negotiatedV2 },
      projectSnapshotStep(),
      {
        lane: 'v2',
        request: {
          kind: 'get_review',
          request: { project, workspace: userWorkspaceIdentity },
        },
        result: { kind: 'review_result', review: snapshot },
      },
      {
        lane: 'v2',
        request: {
          kind: 'execute_review_action',
          request: {
            workspace: userWorkspaceIdentity,
            expected_revision: WorkContextRevision(7n),
            action,
            idempotency_key: idempotencyKey,
          },
        },
        result: {
          kind: 'review_receipt',
          receipt: {
            schema: 'automonique.platform/review/v1',
            platform_version: 2n,
            receipt_id: 'agent-delivery-receipt-1',
            action_id: 'agent-delivery-action-1',
            actor: 'operator-mobile',
            idempotency_key: idempotencyKey,
            outcome: 'accepted',
            reconciliation: 'poll_receipt',
            revision: null,
            current_revision: null,
          },
        },
      },
      {
        lane: 'v2',
        request: {
          kind: 'get_review_receipt',
          lookup: {
            project,
            workspace: userWorkspaceIdentity,
            idempotency_key: idempotencyKey,
          },
        },
        result: {
          kind: 'review_receipt',
          receipt: {
            schema: 'automonique.platform/review/v1',
            platform_version: 2n,
            receipt_id: 'agent-delivery-receipt-1',
            action_id: 'agent-delivery-action-1',
            actor: 'operator-mobile',
            idempotency_key: idempotencyKey,
            outcome: 'completed',
            reconciliation: 'final',
            revision: 8n,
            current_revision: null,
          },
        },
      },
    ],
    1_500,
    memoryReceiptStore(),
    reviewAuthorization(),
    undefined,
    authorizationDigest,
    reviewStore,
  );
  await negotiate(gateway);
  await gateway.loadProject(project);
  await gateway.loadReview(project, userWorkspaceIdentity);
  await expect(
    gateway.executeReviewAction(
      project,
      userWorkspaceIdentity,
      7n,
      snapshot.review.authority,
      action,
      idempotencyKey,
    ),
  ).resolves.toMatchObject({
    kind: 'submitted',
    receipt: { outcome: 'accepted' },
  });
  expect(reviewStore.handles).toEqual([
    expect.objectContaining({
      action_kind: 'send_comment_to_agent',
      expected_revision: '7',
      authority_kind: 'review',
      authority_id: 'review-local',
      actor_id: 'operator-mobile',
      idempotency_key: idempotencyKey,
    }),
  ]);
  expect(JSON.stringify(reviewStore.handles)).not.toContain(
    'Please address this exact finding.',
  );
  await expect(
    gateway.reconcileReviewAction(idempotencyKey),
  ).resolves.toMatchObject({
    receipt: { outcome: 'completed', revision: 8n },
    projectionRefreshRequired: true,
  });
  expect(reviewStore.handles).toEqual([]);
  expect(adapter.pendingSteps).toBe(0);
});

test('batch agent delivery persists before dispatch and reconciles ambiguity without replay', async () => {
  const base = reviewSnapshotWithAgentComment();
  const snapshot: ReviewSnapshot = {
    ...base,
    comments: [
      ...base.comments,
      {
        ...base.comments[0]!,
        id: 'comment-2',
        revision: 5n,
        agent_state: 'refused',
        body: 'Second exact persisted finding.',
      },
    ],
  };
  const action = {
    kind: 'batch_send_comments_to_agent' as const,
    payload: {
      comments: [
        { comment_id: 'comment-1', expected_comment_revision: 4n },
        { comment_id: 'comment-2', expected_comment_revision: 5n },
      ],
    },
  };
  const idempotencyKey = IdempotencyKey('mobile-agent-batch-1');
  const reviewStore = memoryReviewReceiptStore();
  const first = gatewayFor(
    [
      { lane: 'negotiation', result: negotiatedV2 },
      projectSnapshotStep(),
      {
        lane: 'v2',
        request: {
          kind: 'get_review',
          request: { project, workspace: userWorkspaceIdentity },
        },
        result: { kind: 'review_result', review: snapshot },
      },
      {
        lane: 'v2',
        request: {
          kind: 'execute_review_action',
          request: {
            workspace: userWorkspaceIdentity,
            expected_revision: WorkContextRevision(7n),
            action,
            idempotency_key: idempotencyKey,
          },
        },
        result: Promise.reject(new Error('response_lost')),
      },
    ],
    1_500,
    memoryReceiptStore(),
    reviewAuthorization(),
    undefined,
    authorizationDigest,
    reviewStore,
  );
  await negotiate(first.gateway);
  await first.gateway.loadProject(project);
  await first.gateway.loadReview(project, userWorkspaceIdentity);
  await expect(
    first.gateway.executeReviewAction(
      project,
      userWorkspaceIdentity,
      7n,
      snapshot.review.authority,
      action,
      idempotencyKey,
    ),
  ).resolves.toEqual({
    kind: 'ambiguous',
    idempotencyKey,
    receipt: null,
    projectionRefreshRequired: true,
  });
  expect(reviewStore.handles).toEqual([
    expect.objectContaining({
      action_kind: 'batch_send_comments_to_agent',
      idempotency_key: idempotencyKey,
      expected_revision: '7',
    }),
  ]);
  expect(JSON.stringify(reviewStore.handles)).not.toContain(
    'Second exact persisted finding.',
  );
  expect(first.adapter.pendingSteps).toBe(0);

  const reloaded = gatewayFor(
    [
      { lane: 'negotiation', result: negotiatedV2 },
      projectSnapshotStep(),
      {
        lane: 'v2',
        request: {
          kind: 'get_review',
          request: { project, workspace: userWorkspaceIdentity },
        },
        result: { kind: 'review_result', review: snapshot },
      },
      {
        lane: 'v2',
        request: {
          kind: 'get_review_receipt',
          lookup: {
            project,
            workspace: userWorkspaceIdentity,
            idempotency_key: idempotencyKey,
          },
        },
        result: {
          kind: 'review_receipt',
          receipt: {
            schema: 'automonique.platform/review/v1',
            platform_version: 2n,
            receipt_id: 'agent-batch-receipt-1',
            action_id: 'agent-batch-action-1',
            actor: 'operator-mobile',
            idempotency_key: idempotencyKey,
            outcome: 'completed',
            reconciliation: 'final',
            revision: 8n,
            current_revision: null,
          },
        },
      },
    ],
    1_500,
    memoryReceiptStore(),
    reviewAuthorization(),
    undefined,
    authorizationDigest,
    reviewStore,
  );
  await negotiate(reloaded.gateway);
  await reloaded.gateway.loadProject(project);
  await reloaded.gateway.loadReview(project, userWorkspaceIdentity);
  await expect(
    reloaded.gateway.executeReviewAction(
      project,
      userWorkspaceIdentity,
      7n,
      snapshot.review.authority,
      action,
      idempotencyKey,
    ),
  ).resolves.toEqual({
    kind: 'ambiguous',
    idempotencyKey,
    receipt: null,
    projectionRefreshRequired: true,
  });
  await expect(
    reloaded.gateway.reconcileReviewAction(idempotencyKey),
  ).resolves.toMatchObject({
    receipt: { outcome: 'completed', revision: 8n },
    projectionRefreshRequired: true,
  });
  expect(reviewStore.handles).toEqual([]);
  expect(reloaded.adapter.pendingSteps).toBe(0);
});

test('refuses stale review revisions, mismatched authorities, and undelegated effects before transport', async () => {
  const snapshot = reviewSnapshot();
  const reviewStore = memoryReviewReceiptStore();
  const authorized = gatewayFor(
    [
      { lane: 'negotiation', result: negotiatedV2 },
      projectSnapshotStep(),
      {
        lane: 'v2',
        request: {
          kind: 'get_review',
          request: { project, workspace: userWorkspaceIdentity },
        },
        result: { kind: 'review_result', review: snapshot },
      },
    ],
    1_500,
    memoryReceiptStore(),
    reviewAuthorization(),
    undefined,
    authorizationDigest,
    reviewStore,
  );
  await negotiate(authorized.gateway);
  await authorized.gateway.loadProject(project);
  await authorized.gateway.loadReview(project, userWorkspaceIdentity);
  const action = {
    kind: 'approve_review' as const,
    payload: { expected_review_revision: 3n },
  };
  await expect(
    authorized.gateway.executeReviewAction(
      project,
      userWorkspaceIdentity,
      6n,
      snapshot.review.authority,
      action,
      'stale-review-action',
    ),
  ).rejects.toMatchObject({ category: 'review_target_revision_stale' });
  await expect(
    authorized.gateway.executeReviewAction(
      project,
      userWorkspaceIdentity,
      7n,
      { kind: 'review', id: 'review-foreign' },
      action,
      'foreign-review-action',
    ),
  ).rejects.toMatchObject({ category: 'review_target_revision_stale' });
  expect(reviewStore.handles).toEqual([]);
  expect(authorized.adapter.pendingSteps).toBe(0);

  const undelegatedAuthorization: DelegatedMobileV2Authorization = {
    ...delegatedAuthorization(),
    actions: MOBILE_V2_ACTIONS.filter(
      (delegatedAction) => delegatedAction !== 'execute_review_action',
    ),
  };
  const undelegated = gatewayFor(
    [],
    1_500,
    memoryReceiptStore(),
    undelegatedAuthorization,
  ).gateway;
  await expect(
    undelegated.executeReviewAction(
      project,
      userWorkspaceIdentity,
      7n,
      snapshot.review.authority,
      action,
      'undelegated-review-action',
    ),
  ).rejects.toMatchObject({ category: 'mobile_v2_action_unauthorized' });
});

test('fetches an inert exact rerun capability and persists custody before the separate confirmation', async () => {
  const snapshot = reviewSnapshotWithFailedCheck();
  const check = snapshot.checks[0]!;
  const confirmationDigest = ReviewConfirmationDigest('ab'.repeat(32));
  const receiptCorrelationDigest = rerunReceiptCorrelationDigest;
  const idempotencyKey = IdempotencyKey('mobile-check-rerun-1');
  const action = {
    kind: 'rerun_check' as const,
    payload: {
      check_id: check.id,
      expected_check_revision: check.freshness.observed_revision,
    },
  };
  const reviewStore = memoryReviewReceiptStore();
  const { gateway, adapter } = gatewayFor(
    [
      { lane: 'negotiation', result: negotiatedV2 },
      projectSnapshotStep(9n),
      {
        lane: 'v2',
        request: {
          kind: 'get_review',
          request: { project, workspace: userWorkspaceIdentity },
        },
        result: { kind: 'review_result', review: snapshot },
      },
      {
        lane: 'v2',
        request: {
          kind: 'get_review_capabilities',
          request: { project, workspace: userWorkspaceIdentity },
        },
        result: {
          kind: 'review_capabilities',
          capabilities: {
            schema: PLATFORM_SCHEMA_V2,
            project,
            workspace: userWorkspaceIdentity,
            snapshot_revision: WorkContextRevision(7n),
            workspace_revision: WorkContextRevision(9n),
            rerunnable_checks: [
              {
                authority: check.authority,
                check_id: check.id,
                confirmation_digest: confirmationDigest,
                receipt_correlation_digest: receiptCorrelationDigest,
                expected_check_revision: WorkContextRevision(
                  check.freshness.observed_revision,
                ),
              },
            ],
            agent_deliverable_comments: [],
            open_pull_request: null,
            update_pull_request: null,
            merge_pull_request: null,
          },
        },
      },
      {
        lane: 'v2',
        request: {
          kind: 'execute_review_action',
          request: {
            workspace: userWorkspaceIdentity,
            expected_revision: WorkContextRevision(7n),
            action,
            confirmation_digest: confirmationDigest,
            expected_workspace_revision: WorkContextRevision(9n),
            receipt_correlation_digest: receiptCorrelationDigest,
            idempotency_key: idempotencyKey,
          },
        },
        result: {
          kind: 'review_receipt',
          receipt: {
            schema: 'automonique.platform/review/v1',
            platform_version: 2n,
            receipt_id: 'check-rerun-receipt-1',
            action_id: 'check-rerun-action-1',
            actor: 'operator-mobile',
            idempotency_key: idempotencyKey,
            outcome: 'accepted',
            reconciliation: 'poll_receipt',
            revision: null,
            current_revision: null,
          },
        },
      },
      {
        lane: 'v2',
        request: {
          kind: 'get_review_receipt',
          lookup: {
            project,
            workspace: userWorkspaceIdentity,
            idempotency_key: idempotencyKey,
            receipt_correlation_digest: receiptCorrelationDigest,
          },
        },
        result: {
          kind: 'review_receipt',
          receipt: {
            schema: 'automonique.platform/review/v1',
            platform_version: 2n,
            receipt_id: 'check-rerun-receipt-1',
            action_id: 'check-rerun-action-1',
            actor: 'operator-mobile',
            idempotency_key: idempotencyKey,
            outcome: 'completed',
            reconciliation: 'final',
            revision: 8n,
            current_revision: null,
          },
        },
      },
    ],
    1_500,
    memoryReceiptStore(),
    reviewAuthorization(),
    undefined,
    authorizationDigest,
    reviewStore,
  );
  await negotiate(gateway);
  expect(gateway.reviewEffectKinds).toContain('rerun_check');
  await gateway.loadProject(project);
  await gateway.loadReview(project, userWorkspaceIdentity);

  const preview = await gateway.previewCheckRerun(
    project,
    userWorkspaceIdentity,
    9n,
    7n,
    check.id,
    check.freshness.observed_revision,
  );
  expect(preview).toMatchObject({
    project,
    workspaceRevision: 9n,
    snapshotRevision: 7n,
    authority: check.authority,
    action,
    confirmationDigest,
    receiptCorrelationDigest,
  });
  expect(Object.isFrozen(preview)).toBe(true);
  expect(reviewStore.handles).toEqual([]);

  await expect(
    gateway.confirmCheckRerun(preview, idempotencyKey),
  ).resolves.toMatchObject({
    kind: 'submitted',
    receipt: { outcome: 'accepted' },
  });
  expect(reviewStore.handles).toEqual([
    expect.objectContaining({
      expected_revision: '7',
      authority_kind: 'ci',
      authority_id: 'ci-github-actions',
      action_kind: 'rerun_check',
      idempotency_key: idempotencyKey,
      expected_workspace_revision: '9',
      receipt_correlation_digest: receiptCorrelationDigest,
    }),
  ]);
  expect(JSON.stringify(reviewStore.handles)).not.toContain(confirmationDigest);
  await expect(
    gateway.confirmCheckRerun(preview, 'mobile-check-rerun-replay'),
  ).rejects.toMatchObject({
    category: 'review_confirmation_missing_or_replayed',
  });
  await expect(
    gateway.reconcileReviewAction(idempotencyKey),
  ).resolves.toMatchObject({
    receipt: { outcome: 'completed', revision: 8n },
    projectionRefreshRequired: true,
  });
  expect(reviewStore.handles).toEqual([]);
  expect(adapter.pendingSteps).toBe(0);
});

test('restart recovery keeps accepted rerun custody correlated until terminal completion without replay', async () => {
  const handle = correlatedRerunHandle();
  const reviewStore = memoryReviewReceiptStore();
  reviewStore.handles.push(handle);
  const acceptedReceipt = {
    schema: 'automonique.platform/review/v1' as const,
    platform_version: 2n as const,
    receipt_id: 'check-rerun-receipt-recovery',
    action_id: 'check-rerun-action-recovery',
    actor: handle.actor_id,
    idempotency_key: IdempotencyKey(handle.idempotency_key),
    outcome: 'accepted' as const,
    reconciliation: 'poll_receipt' as const,
    revision: null,
    current_revision: null,
  };
  const { gateway, adapter } = gatewayFor(
    [
      { lane: 'negotiation', result: negotiatedV2 },
      {
        lane: 'v2',
        request: {
          kind: 'get_review_receipt',
          lookup: {
            project,
            workspace: userWorkspaceIdentity,
            idempotency_key: IdempotencyKey(handle.idempotency_key),
            receipt_correlation_digest: rerunReceiptCorrelationDigest,
          },
        },
        result: { kind: 'review_receipt', receipt: acceptedReceipt },
      },
      {
        lane: 'v2',
        request: {
          kind: 'get_review_receipt',
          lookup: {
            project,
            workspace: userWorkspaceIdentity,
            idempotency_key: IdempotencyKey(handle.idempotency_key),
            receipt_correlation_digest: rerunReceiptCorrelationDigest,
          },
        },
        result: {
          kind: 'review_receipt',
          receipt: {
            ...acceptedReceipt,
            outcome: 'completed',
            reconciliation: 'final',
            revision: 8n,
          },
        },
      },
    ],
    1_500,
    memoryReceiptStore(),
    reviewAuthorization(),
    undefined,
    authorizationDigest,
    reviewStore,
  );
  await negotiate(gateway);
  await expect(
    gateway.reconcileReviewAction(handle.idempotency_key),
  ).resolves.toMatchObject({
    receipt: { outcome: 'accepted' },
    projectionRefreshRequired: false,
  });
  expect(reviewStore.handles).toEqual([handle]);
  await expect(
    gateway.reconcileReviewAction(handle.idempotency_key),
  ).resolves.toMatchObject({
    receipt: { outcome: 'completed', revision: 8n },
    projectionRefreshRequired: true,
  });
  expect(reviewStore.handles).toEqual([]);
  expect(adapter.requests).toHaveLength(2);
  expect(
    adapter.requests.every(
      (request) =>
        request.kind === 'get_review_receipt' &&
        request.lookup.receipt_correlation_digest ===
          rerunReceiptCorrelationDigest,
    ),
  ).toBe(true);
  expect(
    adapter.requests.some(
      (request) => request.kind === 'execute_review_action',
    ),
  ).toBe(false);
  expect(adapter.pendingSteps).toBe(0);
});

test('partial correlated rerun handles fail before transport and never fall back to generic lookup', async () => {
  const reviewStore = memoryReviewReceiptStore();
  reviewStore.handles.push(
    correlatedRerunHandle({ receipt_correlation_digest: null }),
  );
  const { gateway, adapter } = gatewayFor(
    [],
    1_500,
    memoryReceiptStore(),
    reviewAuthorization(),
    undefined,
    authorizationDigest,
    reviewStore,
  );
  await expect(
    gateway.reconcileReviewAction('mobile-check-rerun-recovery'),
  ).rejects.toThrow('review_receipt_handle_invalid');
  expect(adapter.requests).toEqual([]);
  expect(adapter.pendingSteps).toBe(0);
});

test('refuses stale or ambiguous rerun capabilities before durable custody', async () => {
  const snapshot = reviewSnapshotWithFailedCheck();
  const check = snapshot.checks[0]!;
  const reviewStore = memoryReviewReceiptStore();
  const { gateway, adapter } = gatewayFor(
    [
      { lane: 'negotiation', result: negotiatedV2 },
      projectSnapshotStep(9n),
      {
        lane: 'v2',
        request: {
          kind: 'get_review',
          request: { project, workspace: userWorkspaceIdentity },
        },
        result: { kind: 'review_result', review: snapshot },
      },
      {
        lane: 'v2',
        request: {
          kind: 'get_review_capabilities',
          request: { project, workspace: userWorkspaceIdentity },
        },
        result: {
          kind: 'review_capabilities',
          capabilities: {
            schema: PLATFORM_SCHEMA_V2,
            project,
            workspace: userWorkspaceIdentity,
            snapshot_revision: WorkContextRevision(7n),
            workspace_revision: WorkContextRevision(8n),
            rerunnable_checks: [
              {
                authority: check.authority,
                check_id: check.id,
                confirmation_digest: ReviewConfirmationDigest('ab'.repeat(32)),
                receipt_correlation_digest: rerunReceiptCorrelationDigest,
                expected_check_revision: WorkContextRevision(
                  check.freshness.observed_revision,
                ),
              },
            ],
            agent_deliverable_comments: [],
            open_pull_request: null,
            update_pull_request: null,
            merge_pull_request: null,
          },
        },
      },
    ],
    1_500,
    memoryReceiptStore(),
    reviewAuthorization(),
    undefined,
    authorizationDigest,
    reviewStore,
  );
  await negotiate(gateway);
  await gateway.loadProject(project);
  await gateway.loadReview(project, userWorkspaceIdentity);
  await expect(
    gateway.previewCheckRerun(
      project,
      userWorkspaceIdentity,
      9n,
      7n,
      check.id,
      check.freshness.observed_revision,
    ),
  ).rejects.toMatchObject({ category: 'review_rerun_capability_stale' });
  expect(reviewStore.handles).toEqual([]);
  expect(adapter.pendingSteps).toBe(0);
});

test('rerun persistence failure is known never-started and invokes no provider mutation', async () => {
  const snapshot = reviewSnapshotWithFailedCheck();
  const check = snapshot.checks[0]!;
  const put = jest.fn().mockRejectedValue(new Error('receipt_store_failed'));
  const remove = jest.fn().mockResolvedValue(undefined);
  const reviewStore: ReviewV2ReceiptStore = {
    list: async () => [],
    put,
    remove,
  };
  const { gateway, adapter } = gatewayFor(
    [
      { lane: 'negotiation', result: negotiatedV2 },
      projectSnapshotStep(9n),
      {
        lane: 'v2',
        request: {
          kind: 'get_review',
          request: { project, workspace: userWorkspaceIdentity },
        },
        result: { kind: 'review_result', review: snapshot },
      },
      {
        lane: 'v2',
        request: {
          kind: 'get_review_capabilities',
          request: { project, workspace: userWorkspaceIdentity },
        },
        result: {
          kind: 'review_capabilities',
          capabilities: {
            schema: PLATFORM_SCHEMA_V2,
            project,
            workspace: userWorkspaceIdentity,
            snapshot_revision: WorkContextRevision(7n),
            workspace_revision: WorkContextRevision(9n),
            rerunnable_checks: [
              {
                authority: check.authority,
                check_id: check.id,
                confirmation_digest: ReviewConfirmationDigest('ab'.repeat(32)),
                receipt_correlation_digest: rerunReceiptCorrelationDigest,
                expected_check_revision: WorkContextRevision(
                  check.freshness.observed_revision,
                ),
              },
            ],
            agent_deliverable_comments: [],
            open_pull_request: null,
            update_pull_request: null,
            merge_pull_request: null,
          },
        },
      },
    ],
    1_500,
    memoryReceiptStore(),
    reviewAuthorization(),
    undefined,
    authorizationDigest,
    reviewStore,
  );
  await negotiate(gateway);
  await gateway.loadProject(project);
  await gateway.loadReview(project, userWorkspaceIdentity);
  const prepared = await gateway.previewCheckRerun(
    project,
    userWorkspaceIdentity,
    9n,
    7n,
    check.id,
    check.freshness.observed_revision,
  );
  await expect(
    gateway.confirmCheckRerun(prepared, 'mobile-rerun-never-started'),
  ).rejects.toMatchObject({ category: 'review_action_not_submitted' });
  expect(put).toHaveBeenCalledTimes(1);
  expect(remove).not.toHaveBeenCalled();
  expect(
    adapter.requests.some(
      (request) => request.kind === 'execute_review_action',
    ),
  ).toBe(false);
  expect(adapter.pendingSteps).toBe(0);
});

test('keeps check rerun behind its three grants without widening direct review execution', async () => {
  const legacyReviewAuthorization: DelegatedMobileV2Authorization = {
    ...reviewAuthorization(),
    actions: MOBILE_V2_ACTIONS.filter(
      (action) =>
        action !== 'get_review_capabilities' && action !== 'rerun_check',
    ),
  };
  const legacy = gatewayFor(
    [],
    1_500,
    memoryReceiptStore(),
    legacyReviewAuthorization,
    undefined,
    authorizationDigest,
    memoryReviewReceiptStore(),
  );
  expect(legacy.gateway.reviewEffectKinds).toEqual(
    MOBILE_DIRECT_REVIEW_EFFECT_KINDS,
  );
  await expect(
    legacy.gateway.previewCheckRerun(
      project,
      userWorkspaceIdentity,
      9n,
      7n,
      'check-1',
      5n,
    ),
  ).rejects.toMatchObject({ category: 'mobile_v2_action_unauthorized' });
  expect(legacy.adapter.pendingSteps).toBe(0);

  const rerunOnlyAuthorization: DelegatedMobileV2Authorization = {
    ...reviewAuthorization(),
    actions: MOBILE_V2_ACTIONS.filter(
      (action) => action !== 'execute_review_action',
    ),
  };
  expect(
    gatewayFor(
      [],
      1_500,
      memoryReceiptStore(),
      rerunOnlyAuthorization,
      undefined,
      authorizationDigest,
      memoryReviewReceiptStore(),
    ).gateway.reviewEffectKinds,
  ).toEqual(['rerun_check']);

  const noReceiptAuthorization: DelegatedMobileV2Authorization = {
    ...reviewAuthorization(),
    actions: MOBILE_V2_ACTIONS.filter(
      (action) => action !== 'get_review_receipt',
    ),
  };
  expect(
    gatewayFor(
      [],
      1_500,
      memoryReceiptStore(),
      noReceiptAuthorization,
      undefined,
      authorizationDigest,
      memoryReviewReceiptStore(),
    ).gateway.reviewEffectKinds,
  ).toEqual([]);
});

test('every unsupported review family refuses before a request or durable handle', async () => {
  const snapshot = reviewSnapshot();
  const reviewStore = memoryReviewReceiptStore();
  const authorized = gatewayFor(
    [
      { lane: 'negotiation', result: negotiatedV2 },
      projectSnapshotStep(),
      {
        lane: 'v2',
        request: {
          kind: 'get_review',
          request: { project, workspace: userWorkspaceIdentity },
        },
        result: { kind: 'review_result', review: snapshot },
      },
    ],
    1_500,
    memoryReceiptStore(),
    reviewAuthorization(),
    undefined,
    authorizationDigest,
    reviewStore,
  );
  await negotiate(authorized.gateway);
  await authorized.gateway.loadProject(project);
  await authorized.gateway.loadReview(project, userWorkspaceIdentity);
  const actions = [
    { kind: 'stage', payload: { proposal_id: 'proposal-1' } },
    { kind: 'unstage', payload: { proposal_id: 'proposal-1' } },
    { kind: 'commit', payload: { proposal_id: 'proposal-1' } },
    {
      kind: 'resolve_conflict',
      payload: {
        file_id: 'file-1',
        proposal_id: 'proposal-1',
        resolution: 'keep_current',
      },
    },
    {
      kind: 'open_pull_request',
      payload: { expected_pull_request_revision: 1n, title: 'Exact title' },
    },
    {
      kind: 'update_pull_request',
      payload: {
        expected_pull_request_revision: 1n,
        pull_request_id: 'pr-1',
        title: 'Exact title',
      },
    },
    {
      kind: 'merge_pull_request',
      payload: {
        expected_head_revision: 'head-1',
        expected_pull_request_revision: 1n,
        pull_request_id: 'pr-1',
      },
    },
  ] as const;
  for (const [index, action] of actions.entries()) {
    await expect(
      authorized.gateway.executeReviewAction(
        project,
        userWorkspaceIdentity,
        7n,
        snapshot.review.authority,
        action as never,
        `unsupported-review-${index}`,
      ),
    ).rejects.toMatchObject({
      category: MOBILE_UNAVAILABLE_REVIEW_EFFECT_CATEGORIES[action.kind],
    });
    expect(unavailableReviewEffectCategory(action.kind)).toBe(
      MOBILE_UNAVAILABLE_REVIEW_EFFECT_CATEGORIES[action.kind],
    );
  }
  expect(reviewStore.handles).toEqual([]);
  expect(authorized.adapter.pendingSteps).toBe(0);
});

test('exposes only immutable non-secret coordinates for catalog projection', () => {
  const { gateway } = gatewayFor([]);
  expect(gateway.authorizationScope).toMatchObject({
    serverIdentity: `sha256:${'a'.repeat(64)}`,
    tenantId: 'tenant-mobile',
    authorizationRevision: 1n,
    projectRoots: [project],
  });
  expect(Object.isFrozen(gateway.authorizationScope)).toBe(true);
  expect(Object.isFrozen(gateway.authorizationScope.projectRoots)).toBe(true);
  expect(gateway.reviewEffectKinds).toEqual([]);
  expect(Object.isFrozen(gateway.reviewEffectKinds)).toBe(true);
  expect(gateway.authorizationScope).not.toHaveProperty('token');
  expect(gateway.authorizationScope).not.toHaveProperty('actorId');
});

test('an expired delegated generation refuses catalog reads before transport', async () => {
  const { gateway, adapter } = gatewayFor(
    [],
    70_000,
    memoryReceiptStore(),
    delegatedAuthorization(1_500),
  );
  await expect(gateway.negotiate()).rejects.toMatchObject({
    category: 'mobile_v2_authorization_expired',
  });
  expect(adapter.pendingSteps).toBe(0);
});

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

function rawReceipt(
  value: MutationPreview,
  options: {
    readonly approvalId?: MutationApproval['id'] | null;
    readonly outcome?: 'accepted' | 'completed' | 'conflict' | 'rejected';
    readonly idempotencyKey?: string;
  } = {},
): Uint8Array {
  const outcome = options.outcome ?? 'accepted';
  return toCanonicalBytes(
    json({
      approval_id: options.approvalId ?? null,
      id: ReceiptId('receipt-workspace-1'),
      idempotency_key: options.idempotencyKey ?? value.proposal.idempotency_key,
      outcome,
      preview: value.preview,
      preview_digest: mutationPreviewDigest(value),
      recorded_at_ms: 1_700n,
      request_digest: value.proposal.request_digest,
      resulting_revision:
        outcome === 'completed' ? value.resulting.revision : null,
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
    projectSnapshotStep(),
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
  await gateway.loadProject(project);
  const prepared = await gateway.prepareMutation(
    project,
    intent,
    value.proposal.idempotency_key,
  );
  await expect(
    gateway.confirmMutation(prepared, 'grant'),
  ).resolves.toMatchObject({
    kind: 'submitted',
    idempotencyKey: value.proposal.idempotency_key,
    receipt: {
      idempotency_key: value.proposal.idempotency_key,
      outcome: 'accepted',
    },
    projectionRefreshRequired: true,
  });
  await expect(
    gateway.confirmMutation(prepared, 'grant'),
  ).rejects.toMatchObject({
    category: 'workspace_confirmation_missing_or_replayed',
  });
});

test('persists a receipt lookup before submit and reconciles ambiguity across reload without replay', async () => {
  const intent = createIntent();
  const value = preview(intent, undefined, 'not_required');
  const receiptStore = memoryReceiptStore();
  const order: string[] = [];
  const originalPut = receiptStore.put;
  receiptStore.put = async (handle) => {
    order.push('persist');
    return originalPut(handle);
  };
  const first = gatewayFor(
    [
      { lane: 'negotiation', result: negotiatedV2 },
      projectSnapshotStep(),
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
            preview_digest: mutationPreviewDigest(value),
          },
        },
        result: Promise.reject(new Error('response_lost')),
      },
    ],
    1_500,
    receiptStore,
  );
  await negotiate(first.gateway);
  await first.gateway.loadProject(project);
  const prepared = await first.gateway.prepareMutation(
    project,
    intent,
    value.proposal.idempotency_key,
  );
  await expect(
    first.gateway.confirmMutation(prepared, 'grant'),
  ).resolves.toEqual({
    kind: 'ambiguous',
    idempotencyKey: value.proposal.idempotency_key,
    projectionRefreshRequired: true,
  });
  expect(order).toEqual(['persist']);
  await expect(first.gateway.pendingMutationReceipts()).resolves.toHaveLength(
    1,
  );

  const accepted = gatewayFor(
    [
      { lane: 'negotiation', result: negotiatedV2 },
      {
        lane: 'v2',
        request: {
          kind: 'get_mutation_receipt',
          lookup: {
            project,
            idempotency_key: value.proposal.idempotency_key,
          },
        },
        result: {
          kind: 'mutation_receipt',
          receipt: { canonical: rawReceipt(value) },
        },
      },
    ],
    1_500,
    receiptStore,
  );
  await negotiate(accepted.gateway);
  await expect(
    accepted.gateway.reconcileMutation(value.proposal.idempotency_key),
  ).resolves.toMatchObject({
    kind: 'accepted',
    receipt: { outcome: 'accepted' },
  });
  expect(accepted.adapter.pendingSteps).toBe(0);
  await expect(
    accepted.gateway.pendingMutationReceipts(),
  ).resolves.toHaveLength(1);

  const completed = gatewayFor(
    [
      { lane: 'negotiation', result: negotiatedV2 },
      {
        lane: 'v2',
        request: {
          kind: 'get_mutation_receipt',
          lookup: {
            project,
            idempotency_key: value.proposal.idempotency_key,
          },
        },
        result: {
          kind: 'mutation_receipt',
          receipt: {
            canonical: rawReceipt(value, { outcome: 'completed' }),
          },
        },
      },
    ],
    1_500,
    receiptStore,
  );
  await negotiate(completed.gateway);
  await expect(
    completed.gateway.reconcileMutation(value.proposal.idempotency_key),
  ).resolves.toMatchObject({
    kind: 'settled',
    receipt: { outcome: 'completed' },
    projectionRefreshRequired: true,
  });
  await expect(completed.gateway.pendingMutationReceipts()).resolves.toEqual(
    [],
  );
});

test('an identical durable handle requires reconciliation and never replays submit', async () => {
  const intent = createIntent();
  const value = preview(intent, undefined, 'not_required');
  const receiptStore = memoryReceiptStore();
  await receiptStore.put({
    schema: WORKSPACE_V2_RECEIPT_HANDLE_SCHEMA,
    authorization_digest: authorizationDigest,
    project,
    idempotency_key: value.proposal.idempotency_key,
    preview_id: value.preview.id,
    preview_revision: value.preview.revision.toString(),
    preview_digest: mutationPreviewDigest(value),
    request_digest: value.proposal.request_digest,
    approval_id: null,
    expected_resulting_revision: value.resulting.revision.toString(),
    created_at_ms: '1500',
  });
  const replay = gatewayFor(
    [
      { lane: 'negotiation', result: negotiatedV2 },
      projectSnapshotStep(),
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
    ],
    1_500,
    receiptStore,
  );
  await negotiate(replay.gateway);
  await replay.gateway.loadProject(project);
  const prepared = await replay.gateway.prepareMutation(
    project,
    intent,
    value.proposal.idempotency_key,
  );

  await expect(
    replay.gateway.confirmMutation(prepared, 'grant'),
  ).resolves.toEqual({
    kind: 'ambiguous',
    idempotencyKey: value.proposal.idempotency_key,
    projectionRefreshRequired: true,
  });
  expect(replay.adapter.pendingSteps).toBe(0);
  await expect(replay.gateway.pendingMutationReceipts()).resolves.toHaveLength(
    1,
  );
});

test('rotation before first legacy load reloads and reconciles exactly once without replay or cross-family visibility', async () => {
  await AsyncStorage.clear();
  try {
    const intent = createIntent();
    const value = preview(intent, undefined, 'not_required');
    const oldDigest = authorizationDigest;
    const rotatedDigest = `sha256:${'d'.repeat(64)}`;
    const familyDigest = `sha256:${'f'.repeat(64)}`;
    const durableHandle: WorkspaceV2ReceiptHandle = {
      schema: WORKSPACE_V2_RECEIPT_HANDLE_SCHEMA,
      authorization_digest: oldDigest,
      project,
      idempotency_key: value.proposal.idempotency_key,
      preview_id: value.preview.id,
      preview_revision: value.preview.revision.toString(),
      preview_digest: mutationPreviewDigest(value),
      request_digest: value.proposal.request_digest,
      approval_id: null,
      expected_resulting_revision: value.resulting.revision.toString(),
      created_at_ms: '1500',
    };
    await AsyncStorage.setItem(
      `automonique.mobile.workspace-v2-receipts.v2.${oldDigest}`,
      JSON.stringify([durableHandle]),
    );

    // The credential lifecycle performs this exact, old-generation-bound step
    // before committing the rotated grant. The legacy store was never loaded.
    await migrateLegacyWorkspaceV2Receipts(
      async () => familyDigest,
      async () => oldDigest,
    );

    const reloadedStore = createWorkspaceV2ReceiptStore(
      async () => familyDigest,
      async () => rotatedDigest,
    );
    const rotatedAuthorization = {
      ...delegatedAuthorization(),
      credential_revision: 2n,
      principal_generation: 2n,
    };
    const reloaded = gatewayFor(
      [
        { lane: 'negotiation', result: negotiatedV2 },
        {
          lane: 'v2',
          request: {
            kind: 'get_mutation_receipt',
            lookup: {
              project,
              idempotency_key: value.proposal.idempotency_key,
            },
          },
          result: {
            kind: 'mutation_receipt',
            receipt: { canonical: rawReceipt(value) },
          },
        },
      ],
      1_500,
      reloadedStore,
      rotatedAuthorization,
      undefined,
      rotatedDigest,
    );
    await negotiate(reloaded.gateway);
    await expect(reloaded.gateway.pendingMutationReceipts()).resolves.toEqual([
      durableHandle,
    ]);
    await expect(
      reloaded.gateway.reconcileMutation(value.proposal.idempotency_key),
    ).resolves.toMatchObject({
      kind: 'accepted',
      handle: durableHandle,
      receipt: { outcome: 'accepted' },
    });
    expect(reloaded.adapter.pendingSteps).toBe(0);
    await expect(reloaded.gateway.pendingMutationReceipts()).resolves.toEqual([
      durableHandle,
    ]);

    const foreignFamily = createWorkspaceV2ReceiptStore(
      async () => `sha256:${'e'.repeat(64)}`,
      async () => rotatedDigest,
    );
    await expect(foreignFamily.list()).resolves.toEqual([]);
  } finally {
    await AsyncStorage.clear();
  }
});

test('receipt recovery never returns or queries a project outside the current grant', async () => {
  const receiptStore = memoryReceiptStore();
  const removedProject = ProjectId('project-removed');
  await receiptStore.put({
    schema: WORKSPACE_V2_RECEIPT_HANDLE_SCHEMA,
    authorization_digest: authorizationDigest,
    project: removedProject,
    idempotency_key: 'workspace-create-removed-project',
    preview_id: 'preview-removed-project',
    preview_revision: '1',
    preview_digest: `sha256:${'a'.repeat(64)}`,
    request_digest: `sha256:${'b'.repeat(64)}`,
    approval_id: null,
    expected_resulting_revision: '1',
    created_at_ms: '1500',
  });
  const { adapter, gateway } = gatewayFor(
    [],
    1_500,
    receiptStore,
    delegatedAuthorization(),
  );

  await expect(gateway.pendingMutationReceipts()).resolves.toEqual([]);
  await expect(
    gateway.reconcileMutation('workspace-create-removed-project'),
  ).rejects.toMatchObject({ category: 'mobile_v2_project_unauthorized' });
  expect(adapter.pendingSteps).toBe(0);
});

test('storage failure prevents submit and mismatched canonical receipts remain reconcilable', async () => {
  const intent = createIntent();
  const value = preview(intent, undefined, 'not_required');
  const failingStore = memoryReceiptStore();
  failingStore.put = async () => {
    throw new Error('receipt_store_failed');
  };
  const blocked = gatewayFor(
    [
      { lane: 'negotiation', result: negotiatedV2 },
      projectSnapshotStep(),
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
    ],
    1_500,
    failingStore,
  );
  await negotiate(blocked.gateway);
  await blocked.gateway.loadProject(project);
  const blockedPrepared = await blocked.gateway.prepareMutation(
    project,
    intent,
    value.proposal.idempotency_key,
  );
  await expect(
    blocked.gateway.confirmMutation(blockedPrepared, 'grant'),
  ).rejects.toMatchObject({ category: 'workspace_mutation_not_submitted' });
  expect(blocked.adapter.pendingSteps).toBe(0);

  const receiptStore = memoryReceiptStore();
  const mismatched = gatewayFor(
    [
      { lane: 'negotiation', result: negotiatedV2 },
      projectSnapshotStep(),
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
            preview_digest: mutationPreviewDigest(value),
          },
        },
        result: {
          kind: 'mutation_receipt',
          receipt: {
            canonical: rawReceipt(value, {
              idempotencyKey: 'different-key',
            }),
          },
        },
      },
    ],
    1_500,
    receiptStore,
  );
  await negotiate(mismatched.gateway);
  await mismatched.gateway.loadProject(project);
  const mismatchPrepared = await mismatched.gateway.prepareMutation(
    project,
    intent,
    value.proposal.idempotency_key,
  );
  await expect(
    mismatched.gateway.confirmMutation(mismatchPrepared, 'grant'),
  ).rejects.toThrow('workspace_receipt_mismatch');
  await expect(
    mismatched.gateway.pendingMutationReceipts(),
  ).resolves.toHaveLength(1);
});

test('generation loss during receipt persistence is known-unsent and never invokes submit', async () => {
  const intent = createIntent();
  const value = preview(intent, undefined, 'not_required');
  const receiptStore = memoryReceiptStore();
  const originalPut = receiptStore.put;
  let putStarted!: () => void;
  let releasePut!: () => void;
  const started = new Promise<void>((resolve) => {
    putStarted = resolve;
  });
  const held = new Promise<void>((resolve) => {
    releasePut = resolve;
  });
  receiptStore.put = async (handle) => {
    const inserted = await originalPut(handle);
    putStarted();
    await held;
    return inserted;
  };
  const lifecycle = new AbortController();
  const operationGuard: WorkspaceV2OperationGuard = {
    signal: lifecycle.signal,
    admit() {
      if (lifecycle.signal.aborted)
        throw new Error('gateway_generation_replaced');
    },
  };
  const { adapter, gateway } = gatewayFor(
    [
      { lane: 'negotiation', result: negotiatedV2 },
      projectSnapshotStep(),
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
            preview_digest: mutationPreviewDigest(value),
          },
        },
        result: {
          kind: 'mutation_receipt',
          receipt: { canonical: rawReceipt(value) },
        },
      },
    ],
    1_500,
    receiptStore,
    delegatedAuthorization(),
    operationGuard,
  );
  await negotiate(gateway);
  await gateway.loadProject(project);
  const prepared = await gateway.prepareMutation(
    project,
    intent,
    value.proposal.idempotency_key,
  );
  const confirmation = gateway.confirmMutation(prepared, 'grant');
  await started;
  lifecycle.abort('credential_rotated');
  releasePut();
  await expect(confirmation).rejects.toMatchObject({
    category: 'workspace_mutation_not_submitted',
  });
  expect(receiptStore.handles).toEqual([]);
  expect(adapter.pendingSteps).toBe(1);
});

test('generation loss fences delayed receipt reads and settled cleanup results', async () => {
  const readStore = memoryReceiptStore();
  const originalList = readStore.list;
  let listStarted!: () => void;
  let releaseList!: () => void;
  const listed = new Promise<void>((resolve) => {
    listStarted = resolve;
  });
  const heldList = new Promise<void>((resolve) => {
    releaseList = resolve;
  });
  readStore.list = async () => {
    listStarted();
    await heldList;
    return originalList();
  };
  const readLifecycle = new AbortController();
  const readGateway = gatewayFor(
    [],
    1_500,
    readStore,
    delegatedAuthorization(),
    {
      signal: readLifecycle.signal,
      admit() {
        if (readLifecycle.signal.aborted) {
          throw new Error('gateway_generation_replaced');
        }
      },
    },
  ).gateway;
  const pendingRead = readGateway.pendingMutationReceipts();
  await listed;
  readLifecycle.abort('credential_rotated');
  releaseList();
  await expect(pendingRead).rejects.toThrow('gateway_generation_replaced');

  const intent = createIntent();
  const value = preview(intent, undefined, 'not_required');
  const cleanupStore = memoryReceiptStore();
  await cleanupStore.put({
    schema: WORKSPACE_V2_RECEIPT_HANDLE_SCHEMA,
    authorization_digest: authorizationDigest,
    project,
    idempotency_key: value.proposal.idempotency_key,
    preview_id: value.preview.id,
    preview_revision: value.preview.revision.toString(),
    preview_digest: mutationPreviewDigest(value),
    request_digest: value.proposal.request_digest,
    approval_id: null,
    expected_resulting_revision: value.resulting.revision.toString(),
    created_at_ms: '1500',
  });
  const originalRemove = cleanupStore.remove;
  let removeStarted!: () => void;
  let releaseRemove!: () => void;
  const removing = new Promise<void>((resolve) => {
    removeStarted = resolve;
  });
  const heldRemove = new Promise<void>((resolve) => {
    releaseRemove = resolve;
  });
  cleanupStore.remove = async (key) => {
    await originalRemove(key);
    removeStarted();
    await heldRemove;
  };
  const cleanupLifecycle = new AbortController();
  const cleanupGateway = gatewayFor(
    [
      { lane: 'negotiation', result: negotiatedV2 },
      {
        lane: 'v2',
        request: {
          kind: 'get_mutation_receipt',
          lookup: {
            project,
            idempotency_key: value.proposal.idempotency_key,
          },
        },
        result: {
          kind: 'mutation_receipt',
          receipt: {
            canonical: rawReceipt(value, { outcome: 'completed' }),
          },
        },
      },
    ],
    1_500,
    cleanupStore,
    delegatedAuthorization(),
    {
      signal: cleanupLifecycle.signal,
      admit() {
        if (cleanupLifecycle.signal.aborted) {
          throw new Error('gateway_generation_replaced');
        }
      },
    },
  ).gateway;
  await negotiate(cleanupGateway);
  const reconciliation = cleanupGateway.reconcileMutation(
    value.proposal.idempotency_key,
  );
  await removing;
  cleanupLifecycle.abort('credential_rotated');
  releaseRemove();
  await expect(reconciliation).rejects.toThrow('gateway_generation_replaced');
});

test('records a server denial and drops previews across app reload', async () => {
  const intent = createIntent();
  const value = preview(intent);
  const denied = approvalDocument(value, 'denied');
  const first = gatewayFor([
    { lane: 'negotiation', result: negotiatedV2 },
    projectSnapshotStep(),
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
  await first.gateway.loadProject(project);
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

test('requires the decoded approval decision to equal the requested decision', async () => {
  const intent = createIntent();
  const value = preview(intent);
  const contradictory = approvalDocument(value, 'granted');
  const { adapter, gateway } = gatewayFor([
    { lane: 'negotiation', result: negotiatedV2 },
    projectSnapshotStep(),
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
        approval: { canonical: contradictory.canonical },
      },
    },
  ]);
  await negotiate(gateway);
  await gateway.loadProject(project);
  const prepared = await gateway.prepareMutation(
    project,
    intent,
    value.proposal.idempotency_key,
  );
  await expect(gateway.confirmMutation(prepared, 'deny')).rejects.toMatchObject(
    {
      // Canonical SDK bce4722 rejects before the redundant mobile equality
      // guard, so either layer can never proceed to submit.
      category: 'response_decision_mismatch',
    },
  );
  expect(adapter.pendingSteps).toBe(0);
});

test('cancels only an exact lineage intent revision and rejects self-targeting', async () => {
  const cancelId = WorkspaceIntentId('cancel-intent');
  const targetId = WorkspaceIntentId('create-intent');
  const { gateway } = gatewayFor([
    { lane: 'negotiation', result: negotiatedV2 },
    projectSnapshotStep(),
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
  await gateway.loadProject(project);
  await expect(
    gateway.cancelWorkspaceIntent(
      project,
      userWorkspaceIdentity.id,
      9n,
      cancelId,
      targetId,
    ),
  ).resolves.toEqual({
    project,
    intentId: cancelId,
    outcome: { kind: 'cancelled', target_intent_id: targetId },
  });
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
    {
      project,
      intentId: targetId,
      outcome: { kind: 'cancelled', target_intent_id: targetId },
    },
  );
});

test('lineage responses and cancellation outcomes remain bound to exact request coordinates', async () => {
  const wrongWorkspace = UserWorkspaceId('workspace-other');
  const exact = gatewayFor([
    { lane: 'negotiation', result: negotiatedV2 },
    projectSnapshotStep(),
    {
      lane: 'v2',
      request: {
        kind: 'get_lineage',
        request: { project, workspace: userWorkspaceIdentity.id },
      },
      result: {
        kind: 'lineage_result',
        lineage: {
          external_work_items: [],
          orchestration: [],
          schema: PLATFORM_SCHEMA_V2,
          workspace: userWorkspaceIdentity.id,
        },
      },
    },
  ]).gateway;
  await negotiate(exact);
  await exact.loadProject(project);
  await expect(
    exact.loadLineage(project, userWorkspaceIdentity.id),
  ).resolves.toMatchObject({ workspace: userWorkspaceIdentity.id });

  const mismatched = gatewayFor([
    { lane: 'negotiation', result: negotiatedV2 },
    projectSnapshotStep(),
    {
      lane: 'v2',
      request: {
        kind: 'get_lineage',
        request: { project, workspace: userWorkspaceIdentity.id },
      },
      result: {
        kind: 'lineage_result',
        lineage: {
          external_work_items: [],
          orchestration: [],
          schema: PLATFORM_SCHEMA_V2,
          workspace: wrongWorkspace,
        },
      },
    },
  ]).gateway;
  await negotiate(mismatched);
  await mismatched.loadProject(project);
  await expect(
    mismatched.loadLineage(project, userWorkspaceIdentity.id),
  ).rejects.toThrow();

  const cancelId = WorkspaceIntentId('cancel-coordinate-mismatch');
  const targetId = WorkspaceIntentId('target-coordinate-mismatch');
  const wrongTarget = WorkspaceIntentId('wrong-coordinate-target');
  const cancellation = gatewayFor([
    { lane: 'negotiation', result: negotiatedV2 },
    projectSnapshotStep(),
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
        result: { kind: 'cancelled', target_intent_id: wrongTarget },
      },
    },
  ]).gateway;
  await negotiate(cancellation);
  await cancellation.loadProject(project);
  await expect(
    cancellation.cancelWorkspaceIntent(
      project,
      userWorkspaceIdentity.id,
      9n,
      cancelId,
      targetId,
    ),
  ).rejects.toThrow();
});

test('authenticated transport fails closed on auth loss, malformed input, and abort', async () => {
  let tokenCalls = 0;
  const unauthorized = createAuthorizedWorkspaceV2Gateway({
    authorization: delegatedAuthorization(Date.now()),
    endpoint: 'https://ops.example.test/api/platform/v2',
    token: () => {
      tokenCalls += 1;
      return 'scoped-token';
    },
    receiptStore: memoryReceiptStore(),
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
    authorization: delegatedAuthorization(Date.now()),
    endpoint: 'https://ops.example.test/api/platform/v2',
    token: () => 'scoped-token',
    receiptStore: memoryReceiptStore(),
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
    authorization: delegatedAuthorization(Date.now()),
    endpoint: 'https://ops.example.test/api/platform/v2',
    token: () => {
      tokenCalls += 1;
      return 'scoped-token';
    },
    receiptStore: memoryReceiptStore(),
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

test('rejects a decoded response when the immutable lifecycle generation changes in flight', async () => {
  const snapshot = projectSnapshotStep();
  let release!: (value: typeof snapshot.result) => void;
  const delayed = new Promise<typeof snapshot.result>((resolve) => {
    release = resolve;
  });
  const adapter = new DeterministicPlatformV2Adapter([
    { lane: 'negotiation', result: negotiatedV2 },
    { ...snapshot, result: delayed },
  ]);
  let admitted = true;
  const lifecycle = new AbortController();
  const gateway = createWorkspaceV2Gateway({
    authorization: delegatedAuthorization(),
    authorizationDigest: async () => authorizationDigest,
    client: new PlatformV2Client(adapter),
    now: () => 1_500,
    receiptStore: memoryReceiptStore(),
    operationGuard: {
      signal: lifecycle.signal,
      admit() {
        if (!admitted) throw new Error('gateway_generation_replaced');
      },
    },
  });
  await negotiate(gateway);
  const pending = gateway.loadProject(project);
  admitted = false;
  release(snapshot.result);
  await expect(pending).rejects.toThrow('gateway_generation_replaced');
});

test('stale previews and cross-project create coordinates are refused before submit', async () => {
  const intent = createIntent();
  const stale = preview(intent);
  const staleGateway = gatewayFor(
    [
      { lane: 'negotiation', result: negotiatedV2 },
      projectSnapshotStep(),
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
  await staleGateway.loadProject(project);
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
  ).rejects.toMatchObject({ category: 'mobile_v2_project_unauthorized' });
});

test('project roots alone grant no operation and each gateway surface checks its action', async () => {
  const authorization = { ...delegatedAuthorization(), actions: [] };
  const gateway = gatewayFor(
    [],
    1_500,
    memoryReceiptStore(),
    authorization,
  ).gateway;
  const expected = { category: 'mobile_v2_action_unauthorized' };
  await expect(gateway.loadProject(project)).rejects.toMatchObject(expected);
  await expect(
    gateway.loadLineage(project, userWorkspaceIdentity.id),
  ).rejects.toMatchObject(expected);
  await expect(
    gateway.loadReview(project, userWorkspaceIdentity),
  ).rejects.toMatchObject(expected);
  await expect(
    gateway.prepareMutation(project, createIntent(), 'action-gate'),
  ).rejects.toMatchObject(expected);
  await expect(
    gateway.submitWorkspaceIntent(project, {} as never),
  ).rejects.toMatchObject(expected);
  await expect(
    gateway.getWorkspaceIntent(project, 'action-gate'),
  ).rejects.toMatchObject(expected);
  await expect(
    gateway.cancelWorkspaceIntent(
      project,
      userWorkspaceIdentity.id,
      9n,
      'cancel-action-gate',
      'target-action-gate',
    ),
  ).rejects.toMatchObject(expected);
  await expect(gateway.reconcileMutation('action-gate')).rejects.toMatchObject(
    expected,
  );
  await expect(gateway.pendingMutationReceipts()).rejects.toMatchObject(
    expected,
  );
});

test('decide and submit are independently gated after an admitted preview', async () => {
  const intent = createIntent();
  const required = preview(intent);
  const decideGateway = gatewayFor(
    [
      { lane: 'negotiation', result: negotiatedV2 },
      projectSnapshotStep(),
      {
        lane: 'v2',
        request: {
          kind: 'prepare_mutation',
          request: {
            idempotency_key: required.proposal.idempotency_key,
            intent,
          },
        },
        result: { kind: 'mutation_preview', preview: required },
      },
    ],
    1_500,
    memoryReceiptStore(),
    {
      ...delegatedAuthorization(),
      actions: ['query_work_contexts', 'prepare_mutation'],
    },
  ).gateway;
  await negotiate(decideGateway);
  await decideGateway.loadProject(project);
  const decidePrepared = await decideGateway.prepareMutation(
    project,
    intent,
    required.proposal.idempotency_key,
  );
  await expect(
    decideGateway.confirmMutation(decidePrepared, 'grant'),
  ).rejects.toMatchObject({ category: 'mobile_v2_action_unauthorized' });

  const notRequired = preview(
    intent,
    IdempotencyKey('submit-action-gate'),
    'not_required',
  );
  const submitGateway = gatewayFor(
    [
      { lane: 'negotiation', result: negotiatedV2 },
      projectSnapshotStep(),
      {
        lane: 'v2',
        request: {
          kind: 'prepare_mutation',
          request: {
            idempotency_key: notRequired.proposal.idempotency_key,
            intent,
          },
        },
        result: { kind: 'mutation_preview', preview: notRequired },
      },
    ],
    1_500,
    memoryReceiptStore(),
    {
      ...delegatedAuthorization(),
      actions: ['query_work_contexts', 'prepare_mutation'],
    },
  ).gateway;
  await negotiate(submitGateway);
  await submitGateway.loadProject(project);
  const submitPrepared = await submitGateway.prepareMutation(
    project,
    intent,
    notRequired.proposal.idempotency_key,
  );
  await expect(
    submitGateway.confirmMutation(submitPrepared, 'grant'),
  ).rejects.toMatchObject({ category: 'mobile_v2_action_unauthorized' });
});

test('every lifecycle mutation variant refuses an arbitrary authorized display project without its canonical snapshot', async () => {
  const otherProject = ProjectId('project-other');
  const authorization = {
    ...delegatedAuthorization(),
    project_roots: [project, otherProject],
  };
  const { adapter, gateway } = gatewayFor(
    [{ lane: 'negotiation', result: negotiatedV2 }, projectSnapshotStep()],
    1_500,
    memoryReceiptStore(),
    authorization,
  );
  await negotiate(gateway);
  await gateway.loadProject(project);
  const outside = { category: 'workspace_project_snapshot_required' };
  const intents = [
    createIntent(),
    {
      kind: 'create_attempt_workspace',
      label: WorkContextLabel('Attempt'),
      requested_authority: emptyAuthority,
      user_workspace: {
        identity: userWorkspaceIdentity,
        revision: WorkContextRevision(9n),
      },
    },
    {
      kind: 'resume_attempt_workspace',
      requested_authority: emptyAuthority,
      target: {
        identity: {
          kind: 'attempt_workspace',
          id: AttemptWorkspaceId('attempt-mobile'),
        },
        revision: WorkContextRevision(1n),
      },
    },
    {
      kind: 'resume_session',
      requested_authority: emptyAuthority,
      target: {
        identity: {
          kind: 'session',
          id: WorkSessionId('session-mobile'),
        },
        revision: WorkContextRevision(1n),
      },
    },
  ] as const;
  for (const [index, intent] of intents.entries()) {
    await expect(
      gateway.prepareMutation(
        otherProject,
        intent,
        IdempotencyKey(`cross-project-${index}`),
      ),
    ).rejects.toMatchObject(outside);
  }
  await expect(
    gateway.submitWorkspaceIntent(otherProject, {
      kind: 'create',
      request: {},
    } as never),
  ).rejects.toMatchObject(outside);
  expect(adapter.pendingSteps).toBe(0);
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
      authorityPreview: {
        serverIdentity:
          'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        projectId: project,
        workspaceId: 'workspace-mobile',
        workspaceRevision: '9',
        externalWorkItem: {
          provider: 'github',
          key: '#34',
          title: 'Mobile workspace companion',
        },
      },
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
  expect(
    view.getByText('Workspace · workspace-mobile revision 9'),
  ).toBeTruthy();
  expect(
    view.getByText('External task · github / #34 · Mobile workspace companion'),
  ).toBeTruthy();
  expect(view.getByText('No authority grants requested.')).toBeTruthy();
  await fireEvent.press(view.getByLabelText('Confirm exact workspace change'));
  await fireEvent.press(view.getByLabelText('Deny workspace change'));
  expect(onConfirm).toHaveBeenCalledTimes(1);
  expect(onDeny).toHaveBeenCalledTimes(1);
});

function supportedEffectSnapshot(): ReviewSnapshot {
  return {
    ...reviewSnapshotWithAgentComment(),
    checks: reviewSnapshotWithFailedCheck().checks,
  } as ReviewSnapshot;
}

const supportedEffectCommentBody = 'Exact bounded finding.';

function supportedEffectAction(
  kind: MobileSupportedReviewEffectKind,
): MobileSupportedReviewAction {
  switch (kind) {
    case 'add_comment':
      return {
        kind: 'add_comment',
        payload: {
          anchor: {
            file_id: 'file-1',
            hunk_id: 'hunk-1',
            line: 1n,
            side: 'new',
          },
          body: supportedEffectCommentBody,
          comment_id: 'comment-2',
        },
      };
    case 'approve_review':
      return {
        kind: 'approve_review',
        payload: { expected_review_revision: 3n },
      };
    case 'send_comment_to_agent':
      return {
        kind: 'send_comment_to_agent',
        payload: { comment_id: 'comment-1', expected_comment_revision: 4n },
      };
    case 'batch_send_comments_to_agent':
      return {
        kind: 'batch_send_comments_to_agent',
        payload: {
          comments: [
            { comment_id: 'comment-1', expected_comment_revision: 4n },
          ],
        },
      };
    case 'rerun_check':
      return {
        kind: 'rerun_check',
        payload: {
          check_id: 'check-1',
          expected_check_revision: WorkContextRevision(5n),
        },
      };
  }
}

/**
 * One enumerating fence over the whole supported effect family. Every mutation
 * mobile can perform must be actor-attributed, project-scoped, revision-bound,
 * durably recorded before its first transport, and reconciled exactly once by
 * idempotency key. Adding a kind to `MOBILE_SUPPORTED_REVIEW_EFFECT_KINDS`
 * without those properties fails here rather than in production.
 */
test.each([...MOBILE_SUPPORTED_REVIEW_EFFECT_KINDS])(
  'the %s effect is actor-attributed, scoped, revision-bound, and reconciled exactly once',
  async (kind) => {
    const snapshot = supportedEffectSnapshot();
    const action = supportedEffectAction(kind);
    const rerun = kind === 'rerun_check';
    const authority = rerun
      ? snapshot.checks[0]!.authority
      : snapshot.review.authority;
    const idempotencyKey = IdempotencyKey(`mobile-effect-${kind}`);
    const confirmationDigest = ReviewConfirmationDigest('ab'.repeat(32));
    const capabilityStep = {
      lane: 'v2' as const,
      request: {
        kind: 'get_review_capabilities' as const,
        request: { project, workspace: userWorkspaceIdentity },
      },
      result: {
        kind: 'review_capabilities' as const,
        capabilities: {
          schema: PLATFORM_SCHEMA_V2 as typeof PLATFORM_SCHEMA_V2,
          project,
          workspace: userWorkspaceIdentity,
          snapshot_revision: WorkContextRevision(7n),
          workspace_revision: WorkContextRevision(9n),
          rerunnable_checks: [
            {
              authority,
              check_id: 'check-1',
              confirmation_digest: confirmationDigest,
              receipt_correlation_digest: rerunReceiptCorrelationDigest,
              expected_check_revision: WorkContextRevision(5n),
            },
          ],
          agent_deliverable_comments: [],
          open_pull_request: null,
          update_pull_request: null,
          merge_pull_request: null,
        },
      },
    };
    const reviewStore = memoryReviewReceiptStore();
    const { gateway, adapter } = gatewayFor(
      [
        { lane: 'negotiation', result: negotiatedV2 },
        projectSnapshotStep(9n),
        {
          lane: 'v2',
          request: {
            kind: 'get_review',
            request: { project, workspace: userWorkspaceIdentity },
          },
          result: { kind: 'review_result', review: snapshot },
        },
        ...(rerun ? [capabilityStep] : []),
        {
          lane: 'v2',
          request: {
            kind: 'execute_review_action',
            request: {
              workspace: userWorkspaceIdentity,
              expected_revision: WorkContextRevision(7n),
              action,
              ...(rerun
                ? {
                    confirmation_digest: confirmationDigest,
                    expected_workspace_revision: WorkContextRevision(9n),
                    receipt_correlation_digest: rerunReceiptCorrelationDigest,
                  }
                : {}),
              idempotency_key: idempotencyKey,
            },
          },
          result: {
            kind: 'review_receipt',
            receipt: {
              schema: 'automonique.platform/review/v1',
              platform_version: 2n,
              receipt_id: `receipt-${kind}`,
              action_id: `action-${kind}`,
              actor: 'operator-mobile',
              idempotency_key: idempotencyKey,
              outcome: 'accepted',
              reconciliation: 'poll_receipt',
              revision: null,
              current_revision: null,
            },
          },
        },
        ...(rerun ? [capabilityStep] : []),
        // Any further transport consumes this sentinel, so a replay is visible
        // as a missing pending step rather than as an ambiguous outcome.
        {
          lane: 'error',
          error: new WorkspaceV2GatewayError('unexpected_effect_replay'),
        },
      ],
      1_500,
      memoryReceiptStore(),
      reviewAuthorization(),
      undefined,
      authorizationDigest,
      reviewStore,
    );
    await negotiate(gateway);
    await gateway.loadProject(project);
    await gateway.loadReview(project, userWorkspaceIdentity);

    const submit = async (key: string) => {
      if (!rerun) {
        return gateway.executeReviewAction(
          project,
          userWorkspaceIdentity,
          7n,
          authority,
          action as MobileDirectReviewAction,
          key,
        );
      }
      return gateway.confirmCheckRerun(
        await gateway.previewCheckRerun(
          project,
          userWorkspaceIdentity,
          9n,
          7n,
          'check-1',
          5n,
        ),
        key,
      );
    };

    await expect(submit(idempotencyKey)).resolves.toMatchObject({
      kind: 'submitted',
      idempotencyKey,
      receipt: { actor: 'operator-mobile', idempotency_key: idempotencyKey },
      projectionRefreshRequired: true,
    });
    expect(reviewStore.handles).toEqual([
      expect.objectContaining({
        schema: REVIEW_V2_RECEIPT_HANDLE_SCHEMA,
        project,
        workspace_kind: 'user_workspace',
        workspace_id: userWorkspaceIdentity.id,
        actor_id: 'operator-mobile',
        expected_revision: '7',
        authority_kind: rerun ? 'ci' : 'review',
        authority_id: authority.id,
        action_kind: kind,
        idempotency_key: idempotencyKey,
      }),
    ]);
    // The durable handle stays a lookup coordinate, never replayable content.
    expect(JSON.stringify(reviewStore.handles)).not.toContain(
      supportedEffectCommentBody,
    );
    expect(JSON.stringify(reviewStore.handles)).not.toContain(
      confirmationDigest,
    );

    // The same key never reaches transport twice. The ambiguous outcome alone
    // would not prove that, so the executed requests are counted directly.
    await expect(submit(idempotencyKey)).resolves.toMatchObject({
      kind: 'ambiguous',
      idempotencyKey,
      receipt: null,
      projectionRefreshRequired: true,
    });
    expect(reviewStore.handles).toHaveLength(1);
    expect(
      adapter.requests.filter(
        (request) => request.kind === 'execute_review_action',
      ),
    ).toHaveLength(1);

    // A project outside the delegated roots is refused before any transport.
    await expect(
      rerun
        ? gateway.previewCheckRerun(
            'project-foreign',
            userWorkspaceIdentity,
            9n,
            7n,
            'check-1',
            5n,
          )
        : gateway.executeReviewAction(
            'project-foreign',
            userWorkspaceIdentity,
            7n,
            authority,
            action as MobileDirectReviewAction,
            'mobile-effect-foreign',
          ),
    ).rejects.toMatchObject({ category: 'mobile_v2_project_unauthorized' });
    expect(adapter.pendingSteps).toBe(1);
  },
);
