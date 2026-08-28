// SPDX-License-Identifier: Elastic-2.0

import type {
  LineageProjection,
  ReviewSnapshot,
  WorkContextRecord,
} from '@automonique/sdk';

import { decimalRevision } from './types';
import {
  projectReviewRenderSemantics,
  type MobileReviewRenderSemantics,
} from './review-render-semantics';
import {
  MAX_WORKSPACES,
  MAX_WORKSPACE_HOSTS,
  MAX_WORKSPACE_PROJECTS,
  MAX_WORKSPACE_SESSIONS,
  MAX_WORKSPACE_UNREAD,
  type AuthorizedHost,
  type AuthorizedProject,
  type CompanionFreshness,
  type CompanionWorkspace,
  type ScopedServerProfile,
  type ServerIdentity,
} from './workspace-companion';
import type { ReadOnlyWorkspaceV2Gateway } from './workspace-v2-gateway';

export const MAX_WORKSPACE_DETAIL_READS = 32;
export const MAX_WORKSPACE_DETAIL_CONCURRENCY = 2;
export const MAX_WORKSPACE_PROJECT_CONCURRENCY = 2;
export const WORKSPACE_DETAIL_TIMEOUT_MS = 8_000;

export interface WorkspaceReviewFileProjection {
  readonly id: string;
  readonly path: string;
  readonly change: string;
  readonly worktree: string;
  readonly conflict: string;
  readonly previewKind: ReviewSnapshot['files'][number]['preview']['kind'];
  readonly sanitized: boolean;
  readonly hunks: readonly {
    readonly id: string;
    readonly oldStart: string;
    readonly oldLines: string;
    readonly newStart: string;
    readonly newLines: string;
    readonly preview: string;
  }[];
}

export interface WorkspaceReviewProjection {
  readonly snapshot: ReviewSnapshot;
  readonly semantics: MobileReviewRenderSemantics;
  readonly revision: string;
  readonly attentionState: ReviewSnapshot['attention']['state'];
  readonly unread: number;
  readonly files: readonly WorkspaceReviewFileProjection[];
  readonly pullRequestState: ReviewSnapshot['pull_request']['state'];
  readonly pullRequestId: string | null;
  readonly reviewDecision: ReviewSnapshot['review']['decision'];
  readonly deliveryState: ReviewSnapshot['delivery']['state'];
  readonly attentionReason: string | null;
  readonly comments: ReviewSnapshot['comments'];
  readonly checks: ReviewSnapshot['checks'];
  readonly proposals: ReviewSnapshot['proposals'];
  readonly reviewAuthority: ReviewSnapshot['review']['authority'];
  readonly reviewFreshness: ReviewSnapshot['review']['freshness'];
  readonly pullRequest: ReviewSnapshot['pull_request'];
  readonly delivery: ReviewSnapshot['delivery'];
}

export interface WorkspaceCatalogDetail {
  readonly serverIdentity: ServerIdentity;
  readonly workspaceId: string;
  readonly workspaceRevision: string;
  readonly lineageAvailable: boolean;
  readonly lineage: LineageProjection | null;
  /** Exact live binding from a lineage work-session origin to its retained target. */
  readonly sessionBindings: readonly {
    readonly workSessionId: string;
    readonly retainedSessionId: string;
  }[];
  readonly review: WorkspaceReviewProjection | null;
}

export interface WorkspaceCatalogBuildResult {
  readonly profile: ScopedServerProfile;
  readonly details: readonly WorkspaceCatalogDetail[];
  readonly coverage: 'complete' | 'partial';
  readonly omittedDetailCount: number;
  readonly omittedProjectCount: number;
  readonly omittedHostCount: number;
  readonly omittedWorkspaceCount: number;
  readonly omittedSessionCount: number;
  readonly failedProjectCount: number;
  readonly failedDetailCount: number;
  readonly successfulProjectIds: readonly string[];
  readonly failedProjectIds: readonly string[];
}

interface BuildOptions {
  readonly gateway: ReadOnlyWorkspaceV2Gateway;
  readonly origin: string;
  readonly serverLabel: string;
  readonly signal?: AbortSignal;
  readonly now?: () => number;
}

type IdentityKind = WorkContextRecord['identity']['kind'];

function relation(
  record: WorkContextRecord,
  kind: WorkContextRecord['relations'][number]['kind'],
  targetKind: IdentityKind,
): WorkContextRecord['relations'][number]['target'] | null {
  const target = record.relations.find(
    (candidate) =>
      candidate.kind === kind && candidate.target.kind === targetKind,
  )?.target;
  return target ?? null;
}

function recordId(record: WorkContextRecord): string {
  if (
    record.identity.kind === 'platform_session' ||
    record.identity.kind === 'repository'
  ) {
    return record.identity.resource.id;
  }
  return record.identity.id;
}

function timestamp(milliseconds: bigint | number): string | null {
  const numeric = Number(milliseconds);
  if (!Number.isFinite(numeric) || Math.abs(numeric) > 8_640_000_000_000_000) {
    return null;
  }
  return new Date(numeric).toISOString();
}

function unknownFreshness(now: number): CompanionFreshness {
  return {
    state: 'unknown',
    observedAt: timestamp(now) ?? '1970-01-01T00:00:00.000Z',
  };
}

function lineageFreshness(
  lineage: LineageProjection | null,
  now: number,
): CompanionFreshness {
  const values = [
    ...(lineage?.external_work_items.map((item) => item.freshness) ?? []),
    ...(lineage?.orchestration.map((item) => item.freshness) ?? []),
  ];
  if (values.length === 0) return unknownFreshness(now);
  const latest = values.reduce((left, right) =>
    right.observed_at_ms > left.observed_at_ms ? right : left,
  );
  const observedAt = timestamp(latest.observed_at_ms);
  if (observedAt === null) return unknownFreshness(now);
  return {
    state: latest.state === 'fresh' ? 'fresh' : 'delayed',
    observedAt,
  };
}

function hostState(
  lifecycle: WorkContextRecord['lifecycle'],
): AuthorizedHost['state'] {
  if (lifecycle === 'active' || lifecycle === 'running') return 'ready';
  if (lifecycle === 'hibernated' || lifecycle === 'closed') return 'offline';
  return 'unknown';
}

function attemptState(
  lifecycle: WorkContextRecord['lifecycle'],
): NonNullable<CompanionWorkspace['attempt']>['state'] {
  if (lifecycle === 'preparing') return 'queued';
  if (lifecycle === 'active' || lifecycle === 'running') return 'running';
  if (lifecycle === 'hibernated') return 'waiting';
  if (['archived', 'closed', 'completed'].includes(lifecycle))
    return 'completed';
  return 'unknown';
}

function sessionState(
  lifecycle: WorkContextRecord['lifecycle'],
): CompanionWorkspace['sessions'][number]['state'] {
  if (lifecycle === 'active' || lifecycle === 'running') return 'active';
  if (lifecycle === 'preparing' || lifecycle === 'hibernated') return 'waiting';
  if (['archived', 'closed', 'completed'].includes(lifecycle))
    return 'completed';
  if (lifecycle === 'failed' || lifecycle === 'cancelled') return 'lost';
  return 'unknown';
}

function lifecycleStatus(
  lifecycle: WorkContextRecord['lifecycle'],
): CompanionWorkspace['orchestrationStatus'] {
  if (lifecycle === 'preparing') return 'planned';
  if (lifecycle === 'active') return 'idle';
  if (lifecycle === 'running') return 'running';
  if (lifecycle === 'hibernated') return 'waiting';
  if (['archived', 'closed', 'completed'].includes(lifecycle))
    return 'succeeded';
  if (lifecycle === 'failed') return 'failed';
  if (lifecycle === 'cancelled') return 'cancelled';
  return 'unknown';
}

function orchestrationStatus(
  workspace: WorkContextRecord,
  lineage: LineageProjection | null,
): CompanionWorkspace['orchestrationStatus'] {
  const typed =
    lineage?.orchestration.find((item) => item.identity.kind === 'task') ??
    lineage?.orchestration[0];
  if (typed === undefined) return lifecycleStatus(workspace.lifecycle);
  if (typed.status.kind === 'working') return 'running';
  if (typed.status.kind === 'waiting') return 'waiting';
  if (typed.status.kind === 'blocked') return 'blocked';
  return 'succeeded';
}

function externalWorkItem(
  lineage: LineageProjection | null,
): CompanionWorkspace['externalWorkItem'] {
  const item = lineage?.external_work_items[0];
  if (item === undefined) return null;
  return {
    provider: item.identity.provider,
    key: item.identity.key,
    // Platform v2 currently has no external-work title field. Do not relabel
    // latest_useful_message as a title or parse a display label for one.
    title: item.identity.key,
    status:
      item.state === 'open'
        ? 'open'
        : item.state === 'closed'
          ? 'done'
          : 'cancelled',
  };
}

function boundedUnread(value: bigint): number {
  return Number(
    value > BigInt(MAX_WORKSPACE_UNREAD) ? MAX_WORKSPACE_UNREAD : value,
  );
}

function reviewProjection(
  review: ReviewSnapshot,
): WorkspaceReviewProjection | null {
  const semantics = projectReviewRenderSemantics(review);
  if (semantics === null) return null;
  return {
    snapshot: review,
    semantics,
    revision: review.revision.toString(),
    attentionState: review.attention.state,
    unread: boundedUnread(review.attention.unread),
    files: review.files.map((file) => ({
      id: file.id,
      path: file.path,
      change: file.change,
      worktree: file.worktree,
      conflict: file.conflict,
      previewKind: file.preview.kind,
      sanitized: file.preview.sanitized,
      hunks: file.hunks.map((hunk) => ({
        id: hunk.id,
        oldStart: hunk.old_start.toString(),
        oldLines: hunk.old_lines.toString(),
        newStart: hunk.new_start.toString(),
        newLines: hunk.new_lines.toString(),
        preview: hunk.preview,
      })),
    })),
    pullRequestState: review.pull_request.state,
    pullRequestId: review.pull_request.id,
    reviewDecision: review.review.decision,
    deliveryState: review.delivery.state,
    attentionReason: review.attention.reason,
    comments: review.comments,
    checks: review.checks,
    proposals: review.proposals,
    reviewAuthority: review.review.authority,
    reviewFreshness: review.review.freshness,
    pullRequest: review.pull_request,
    delivery: review.delivery,
  };
}

async function timed<T>(
  signal: AbortSignal | undefined,
  operation: (combined: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const abort = () =>
    controller.abort(signal?.reason ?? 'workspace_catalog_aborted');
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(
    () => controller.abort('workspace_detail_timeout'),
    WORKSPACE_DETAIL_TIMEOUT_MS,
  );
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    if (!controller.signal.aborted)
      controller.abort('workspace_detail_complete');
  }
}

interface WorkspaceGraph {
  readonly project: WorkContextRecord;
  readonly host: WorkContextRecord;
  readonly checkout: WorkContextRecord;
  readonly workspace: WorkContextRecord;
  readonly attempt: WorkContextRecord | null;
  readonly sessions: readonly RetainedSession[];
  readonly repositoryId: string | null;
}

interface RetainedSession {
  readonly record: WorkContextRecord;
  readonly target: Extract<
    WorkContextRecord['relations'][number]['target'],
    { readonly kind: 'platform_session' }
  >['resource'];
}

function graphs(
  records: readonly WorkContextRecord[],
): readonly WorkspaceGraph[] {
  const keyed = new Map<string, WorkContextRecord>();
  const workspaceRecords: WorkContextRecord[] = [];
  const latestAttemptByWorkspace = new Map<string, WorkContextRecord>();
  const sessionsByAttempt = new Map<string, WorkContextRecord[]>();
  for (const record of records) {
    keyed.set(`${record.identity.kind}:${recordId(record)}`, record);
    if (record.identity.kind === 'user_workspace') {
      workspaceRecords.push(record);
    } else if (record.identity.kind === 'attempt_workspace') {
      const target = relation(
        record,
        'attempt_user_workspace',
        'user_workspace',
      );
      if (target?.kind === 'user_workspace') {
        const current = latestAttemptByWorkspace.get(target.id);
        if (
          current === undefined ||
          record.revision > current.revision ||
          (record.revision === current.revision &&
            recordId(record).localeCompare(recordId(current)) < 0)
        ) {
          latestAttemptByWorkspace.set(target.id, record);
        }
      }
    } else if (record.identity.kind === 'session') {
      const target = relation(
        record,
        'session_attempt_workspace',
        'attempt_workspace',
      );
      if (target?.kind === 'attempt_workspace') {
        const values = sessionsByAttempt.get(target.id) ?? [];
        values.push(record);
        sessionsByAttempt.set(target.id, values);
      }
    }
  }
  const result: WorkspaceGraph[] = [];
  for (const workspace of workspaceRecords) {
    if (workspace.identity.kind !== 'user_workspace') continue;
    const workspaceIdentity = workspace.identity;
    const projectTarget = relation(
      workspace,
      'user_workspace_project',
      'project',
    );
    const checkoutTarget = relation(
      workspace,
      'user_workspace_checkout',
      'checkout',
    );
    if (
      projectTarget?.kind !== 'project' ||
      checkoutTarget?.kind !== 'checkout'
    )
      continue;
    const project = keyed.get(`project:${projectTarget.id}`);
    const checkout = keyed.get(`checkout:${checkoutTarget.id}`);
    if (project === undefined || checkout === undefined) continue;
    const hostTarget = relation(checkout, 'checkout_host_setup', 'host_setup');
    if (hostTarget?.kind !== 'host_setup') continue;
    const host = keyed.get(`host_setup:${hostTarget.id}`);
    if (host === undefined) continue;
    const attempt = latestAttemptByWorkspace.get(workspaceIdentity.id) ?? null;
    const sessions: RetainedSession[] = [];
    const retainedIds = new Set<string>();
    for (const session of attempt === null
      ? []
      : (sessionsByAttempt.get(recordId(attempt)) ?? [])) {
      const target = relation(
        session,
        'session_platform_session',
        'platform_session',
      );
      if (
        target?.kind !== 'platform_session' ||
        retainedIds.has(target.resource.id)
      )
        continue;
      retainedIds.add(target.resource.id);
      sessions.push({ record: session, target: target.resource });
    }
    const repository = relation(checkout, 'checkout_repository', 'repository');
    result.push({
      project,
      host,
      checkout,
      workspace,
      attempt,
      sessions,
      repositoryId:
        repository?.kind === 'repository' ? repository.resource.id : null,
    });
  }
  return result;
}

interface DetailRead {
  readonly lineage: LineageProjection | null;
  readonly review: ReviewSnapshot | null;
  readonly failures: number;
}

async function readDetail(
  gateway: ReadOnlyWorkspaceV2Gateway,
  project: string,
  workspace: WorkContextRecord,
  signal: AbortSignal | undefined,
): Promise<DetailRead> {
  if (workspace.identity.kind !== 'user_workspace') {
    return { lineage: null, review: null, failures: 2 };
  }
  const workspaceIdentity = workspace.identity;
  const [lineageResult, reviewResult] = await Promise.allSettled([
    gateway.authorizationScope.actions.includes('get_lineage')
      ? timed(signal, (combined) =>
          gateway.loadLineage(project, workspaceIdentity.id, combined),
        )
      : Promise.reject(new Error('lineage_not_granted')),
    gateway.authorizationScope.actions.includes('get_review')
      ? timed(signal, (combined) =>
          gateway.loadReview(project, workspaceIdentity, combined),
        )
      : Promise.reject(new Error('review_not_granted')),
  ]);
  return {
    lineage: lineageResult.status === 'fulfilled' ? lineageResult.value : null,
    review: reviewResult.status === 'fulfilled' ? reviewResult.value : null,
    failures:
      Number(lineageResult.status === 'rejected') +
      Number(reviewResult.status === 'rejected'),
  };
}

/**
 * Project snapshots and all joins remain typed. Labels are presentation only
 * and are never parsed for identity, status, repository, branch, or authority.
 */
export async function buildWorkspaceServerCatalog(
  options: BuildOptions,
): Promise<WorkspaceCatalogBuildResult> {
  const now = options.now ?? Date.now;
  const scope = options.gateway.authorizationScope;
  if (!scope.actions.includes('query_work_contexts')) {
    throw new Error('workspace_catalog_read_not_granted');
  }
  await options.gateway.negotiate(options.signal);
  const admittedProjectRoots = scope.projectRoots.slice(
    0,
    MAX_WORKSPACE_PROJECTS,
  );
  const omittedRootCount =
    scope.projectRoots.length - admittedProjectRoots.length;
  const snapshots: {
    readonly projectId: string;
    readonly records: readonly WorkContextRecord[];
  }[] = [];
  const successfulProjectIds: string[] = [];
  const failedProjectIds: string[] = [];
  for (
    let index = 0;
    index < admittedProjectRoots.length;
    index += MAX_WORKSPACE_PROJECT_CONCURRENCY
  ) {
    const batch = admittedProjectRoots.slice(
      index,
      index + MAX_WORKSPACE_PROJECT_CONCURRENCY,
    );
    const reads = await Promise.allSettled(
      batch.map((project) =>
        timed(options.signal, (combined) =>
          options.gateway.loadProject(project, combined),
        ),
      ),
    );
    for (let offset = 0; offset < reads.length; offset += 1) {
      const read = reads[offset]!;
      const project = batch[offset]!;
      if (read.status === 'fulfilled') {
        snapshots.push({ projectId: project, records: read.value });
        successfulProjectIds.push(project);
      } else {
        failedProjectIds.push(project);
      }
    }
  }
  const failedProjectCount = failedProjectIds.length;
  if (snapshots.length === 0 && failedProjectCount > 0) {
    throw new Error('workspace_catalog_projects_unavailable');
  }

  const inventories = snapshots.map((snapshot) => {
    const project = snapshot.records.find(
      (candidate) =>
        candidate.identity.kind === 'project' &&
        recordId(candidate) === snapshot.projectId,
    );
    if (project === undefined) {
      throw new Error('workspace_catalog_project_graph_invalid');
    }
    const workspaceGraphs = graphs(snapshot.records);
    const hostRecords = new Map<string, WorkContextRecord>();
    // Hosts that back a visible workspace are selected before idle hosts. This
    // remains a linear, project-root/record-order selection and maximizes the
    // coherent workspace projection within the fixed global host ceiling.
    for (const graph of workspaceGraphs) {
      hostRecords.set(recordId(graph.host), graph.host);
    }
    for (const candidate of snapshot.records) {
      if (candidate.identity.kind !== 'host_setup') continue;
      const target = relation(candidate, 'host_setup_project', 'project');
      if (target?.kind === 'project' && target.id === snapshot.projectId) {
        hostRecords.set(recordId(candidate), candidate);
      }
    }
    return {
      projectId: snapshot.projectId,
      project,
      hosts: [...hostRecords.values()],
      graphs: workspaceGraphs,
    };
  });

  const admittedHostRecords: WorkContextRecord[] = [];
  const admittedHostOwners = new Map<string, string>();
  let hostCandidateCount = 0;
  for (const inventory of inventories) {
    for (const host of inventory.hosts) {
      hostCandidateCount += 1;
      const hostId = recordId(host);
      if (
        admittedHostRecords.length >= MAX_WORKSPACE_HOSTS ||
        admittedHostOwners.has(hostId)
      )
        continue;
      admittedHostOwners.set(hostId, inventory.projectId);
      admittedHostRecords.push(host);
    }
  }
  const omittedHostCount = hostCandidateCount - admittedHostRecords.length;
  const hosts: AuthorizedHost[] = admittedHostRecords.map((host) => ({
    id: recordId(host),
    label: host.label,
    state: hostState(host.lifecycle),
    freshness: unknownFreshness(now()),
  }));

  const projects: AuthorizedProject[] = [];
  const admittedProjectIds = new Set<string>();
  for (const inventory of inventories) {
    const hostIds = inventory.hosts
      .map(recordId)
      .filter(
        (hostId) => admittedHostOwners.get(hostId) === inventory.projectId,
      );
    if (hostIds.length === 0) continue;
    admittedProjectIds.add(inventory.projectId);
    projects.push({
      id: inventory.projectId,
      hostIds,
      label: inventory.project.label,
    });
  }
  const omittedProjectCount =
    omittedRootCount + inventories.length - projects.length;

  const workspaceGraphs: WorkspaceGraph[] = [];
  const admittedWorkspaceIds = new Set<string>();
  let omittedWorkspaceCount = 0;
  let omittedSessionCount = 0;
  let admittedSessionCount = 0;
  for (const inventory of inventories) {
    for (const graph of inventory.graphs) {
      const workspaceId = recordId(graph.workspace);
      const projectId = recordId(graph.project);
      const hostId = recordId(graph.host);
      if (
        !admittedProjectIds.has(projectId) ||
        admittedHostOwners.get(hostId) !== projectId ||
        admittedWorkspaceIds.has(workspaceId) ||
        workspaceGraphs.length >= MAX_WORKSPACES
      ) {
        omittedWorkspaceCount += 1;
        omittedSessionCount += graph.sessions.length;
        continue;
      }
      admittedWorkspaceIds.add(workspaceId);
      const sessions: RetainedSession[] = [];
      for (const session of graph.sessions) {
        if (admittedSessionCount >= MAX_WORKSPACE_SESSIONS) {
          omittedSessionCount += 1;
          continue;
        }
        sessions.push(session);
        admittedSessionCount += 1;
      }
      workspaceGraphs.push({ ...graph, sessions });
    }
  }
  const admittedDetailGraphs = workspaceGraphs.slice(
    0,
    MAX_WORKSPACE_DETAIL_READS,
  );
  const detailReads = new Map<string, DetailRead>();
  for (
    let index = 0;
    index < admittedDetailGraphs.length;
    index += MAX_WORKSPACE_DETAIL_CONCURRENCY
  ) {
    const batch = admittedDetailGraphs.slice(
      index,
      index + MAX_WORKSPACE_DETAIL_CONCURRENCY,
    );
    const values = await Promise.all(
      batch.map(async (graph) => ({
        key: `${recordId(graph.project)}\u0000${recordId(graph.workspace)}`,
        value: await readDetail(
          options.gateway,
          recordId(graph.project),
          graph.workspace,
          options.signal,
        ),
      })),
    );
    for (const value of values) detailReads.set(value.key, value.value);
  }

  let failedDetailCount = 0;
  const details: WorkspaceCatalogDetail[] = [];
  const workspaces = workspaceGraphs.map((graph): CompanionWorkspace => {
    const workspaceId = recordId(graph.workspace);
    const detail = detailReads.get(
      `${recordId(graph.project)}\u0000${workspaceId}`,
    );
    failedDetailCount += detail?.failures ?? 0;
    const review = detail?.review ?? null;
    const reviewRead = review === null ? null : reviewProjection(review);
    if (review !== null && reviewRead === null) failedDetailCount += 1;
    details.push({
      serverIdentity: scope.serverIdentity as ServerIdentity,
      workspaceId,
      workspaceRevision: graph.workspace.revision.toString(),
      lineageAvailable:
        detail?.lineage !== null && detail?.lineage !== undefined,
      lineage: detail?.lineage ?? null,
      sessionBindings: graph.sessions.map(({ record: session, target }) => ({
        workSessionId: recordId(session),
        retainedSessionId: target.id,
      })),
      review: reviewRead,
    });
    const navigation: CompanionWorkspace['navigation'] = [
      ...(graph.sessions.length > 0
        ? [
            {
              destination: 'chat' as const,
              revision: decimalRevision(graph.workspace.revision.toString()),
            },
          ]
        : []),
      ...(reviewRead === null
        ? []
        : [
            {
              destination: 'files' as const,
              revision: decimalRevision(graph.workspace.revision.toString()),
            },
            {
              destination: 'review' as const,
              revision: decimalRevision(graph.workspace.revision.toString()),
            },
          ]),
      ...(reviewRead?.files.some((file) => file.previewKind !== 'none')
        ? [
            {
              destination: 'preview' as const,
              revision: decimalRevision(graph.workspace.revision.toString()),
            },
          ]
        : []),
      ...(reviewRead !== null && reviewRead.pullRequestId !== null
        ? [
            {
              destination: 'source_control' as const,
              revision: decimalRevision(graph.workspace.revision.toString()),
            },
          ]
        : []),
    ];
    return {
      id: workspaceId,
      revision: decimalRevision(graph.workspace.revision.toString()),
      hostId: recordId(graph.host),
      projectId: recordId(graph.project),
      title: graph.workspace.label,
      externalWorkItem: externalWorkItem(detail?.lineage ?? null),
      orchestrationStatus: orchestrationStatus(
        graph.workspace,
        detail?.lineage ?? null,
      ),
      attempt:
        graph.attempt === null
          ? null
          : {
              id: recordId(graph.attempt),
              revision: decimalRevision(graph.attempt.revision.toString()),
              state: attemptState(graph.attempt.lifecycle),
            },
      sessions: graph.sessions.map(({ record: session, target }) => ({
        id: target.id,
        target,
        revision: decimalRevision(session.revision.toString()),
        title: session.label,
        state: sessionState(session.lifecycle),
        unreadAttention: reviewRead?.unread ?? 0,
      })),
      repository:
        graph.repositoryId === null
          ? null
          : { label: graph.repositoryId, webUrl: null },
      branch: null,
      freshness: lineageFreshness(detail?.lineage ?? null, now()),
      unreadAttention: reviewRead?.unread ?? 0,
      navigation,
    };
  });
  const omittedDetailCount =
    workspaceGraphs.length - admittedDetailGraphs.length;
  return {
    profile: {
      serverIdentity: scope.serverIdentity as ServerIdentity,
      label: options.serverLabel,
      origin: options.origin,
      tenantId: scope.tenantId,
      authorization: 'active',
      authorizationRevision: decimalRevision(
        scope.authorizationRevision.toString(),
      ),
      principalGeneration: decimalRevision(
        scope.principalGeneration.toString(),
      ),
      staleProjectIds: [],
      actions: ['workspace_read'],
      hosts,
      projects,
      workspaces,
    },
    details,
    coverage:
      failedProjectCount > 0 ||
      failedDetailCount > 0 ||
      omittedDetailCount > 0 ||
      omittedProjectCount > 0 ||
      omittedHostCount > 0 ||
      omittedWorkspaceCount > 0 ||
      omittedSessionCount > 0
        ? 'partial'
        : 'complete',
    omittedDetailCount,
    omittedProjectCount,
    omittedHostCount,
    omittedWorkspaceCount,
    omittedSessionCount,
    failedProjectCount,
    failedDetailCount,
    successfulProjectIds,
    failedProjectIds,
  };
}
