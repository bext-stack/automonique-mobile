// SPDX-License-Identifier: Elastic-2.0

import type {
  AttentionSource,
  WorkContextIdentity,
  WorkContextRecord,
  WorkContextRelationKind,
} from '@automonique/sdk';

import {
  AttentionBoardError,
  MAX_ATTENTION_SOURCES_PER_WORKSPACE,
  type AttentionTarget,
} from './attention-source-board';

/**
 * The exact set of attention sources a workspace has, derived only from the
 * server's typed WorkContext graph. Mobile never infers a source from a label,
 * a composite key, or the mere presence of review state.
 *
 * This mirrors the desktop derivation, so both clients ask the same server for
 * the same sources and can be compared against one shared fixture.
 */

export const MAX_ATTENTION_INVENTORY_RECORDS = 512;

export type ReviewAttentionPresence = 'present' | 'absent';

/** The Platform session a provider source stays bound to. */
export interface ProviderSessionBinding {
  readonly authority: string;
  readonly kind: string;
  readonly id: string;
}

export interface AttentionSourceInventory {
  readonly target: AttentionTarget;
  readonly sources: readonly AttentionSource[];
  /**
   * The binding for each provider source. Retaining it means an item can never
   * redirect its source to another session that merely happens to be current.
   */
  readonly providerSessions: ReadonlyMap<string, ProviderSessionBinding>;
}

function identityKey(identity: WorkContextIdentity): string {
  return 'id' in identity
    ? `${identity.kind} ${identity.id}`
    : `${identity.kind} ${identity.resource.authority} ${identity.resource.kind} ${identity.resource.id}`;
}

/**
 * Exactly one edge of a kind, or nothing. An ambiguous graph is refused rather
 * than resolved by first match.
 */
function relationTarget(
  record: WorkContextRecord,
  kind: WorkContextRelationKind,
): WorkContextIdentity | null {
  const matches = record.relations.filter((relation) => relation.kind === kind);
  return matches.length === 1 ? matches[0]!.target : null;
}

function sourceKey(source: AttentionSource): string {
  return `${source.kind} ${source.id}`;
}

function targetsUserWorkspace(
  record: WorkContextRecord,
  kind: WorkContextRelationKind,
  userWorkspace: string,
): boolean {
  const target = relationTarget(record, kind);
  return (
    target !== null &&
    target.kind === 'user_workspace' &&
    target.id === userWorkspace
  );
}

export function deriveAttentionSourceInventory(
  target: AttentionTarget,
  records: readonly WorkContextRecord[],
  review: ReviewAttentionPresence,
): AttentionSourceInventory {
  if (records.length > MAX_ATTENTION_INVENTORY_RECORDS) {
    throw new AttentionBoardError('attention_inventory_too_large');
  }
  const identities = new Set<string>();
  for (const record of records) {
    const key = identityKey(record.identity);
    if (identities.has(key)) {
      throw new AttentionBoardError('attention_inventory_duplicate_record');
    }
    identities.add(key);
  }

  const workspaces = records.filter(
    (record) =>
      record.identity.kind === 'user_workspace' &&
      record.identity.id === target.userWorkspace,
  );
  if (workspaces.length !== 1) {
    throw new AttentionBoardError('attention_workspace_missing_or_ambiguous');
  }
  const workspaceProject = relationTarget(
    workspaces[0]!,
    'user_workspace_project',
  );
  if (
    workspaceProject === null ||
    workspaceProject.kind !== 'project' ||
    workspaceProject.id !== target.project
  ) {
    throw new AttentionBoardError('attention_workspace_project_mismatch');
  }

  const sources: AttentionSource[] = [];
  if (review === 'present') {
    sources.push({ id: target.userWorkspace, kind: 'review' });
  }
  sources.push({ id: target.userWorkspace, kind: 'orchestration' });

  const attempts = new Set(
    records
      .filter(
        (record) =>
          record.identity.kind === 'attempt_workspace' &&
          targetsUserWorkspace(
            record,
            'attempt_user_workspace',
            target.userWorkspace,
          ),
      )
      .map((record) => identityKey(record.identity)),
  );

  const providerSessions = new Map<string, ProviderSessionBinding>();
  const seen = new Set(sources.map(sourceKey));
  for (const record of records) {
    if (record.identity.kind !== 'session') continue;
    const attempt = relationTarget(record, 'session_attempt_workspace');
    if (attempt === null || !attempts.has(identityKey(attempt))) continue;
    const platformSession = relationTarget(record, 'session_platform_session');
    if (
      platformSession === null ||
      platformSession.kind !== 'platform_session' ||
      platformSession.resource.authority !== 'automonique' ||
      platformSession.resource.kind !== 'session'
    ) {
      throw new AttentionBoardError('attention_provider_relation_invalid');
    }
    const source: AttentionSource = {
      id: record.identity.id,
      kind: 'provider_session',
    };
    const key = sourceKey(source);
    if (seen.has(key)) {
      throw new AttentionBoardError('attention_inventory_duplicate_source');
    }
    seen.add(key);
    sources.push(source);
    providerSessions.set(key, {
      authority: platformSession.resource.authority,
      id: platformSession.resource.id,
      kind: platformSession.resource.kind,
    });
  }

  if (sources.length > MAX_ATTENTION_SOURCES_PER_WORKSPACE) {
    throw new AttentionBoardError('attention_inventory_too_large');
  }

  return Object.freeze({
    providerSessions,
    sources: Object.freeze(
      [...sources].sort((left, right) => {
        if (left.kind !== right.kind) return left.kind < right.kind ? -1 : 1;
        if (left.id === right.id) return 0;
        return left.id < right.id ? -1 : 1;
      }),
    ),
    target: Object.freeze({ ...target }),
  });
}

/** The Platform session a provider source is authoritatively bound to. */
export function providerSessionBinding(
  inventory: AttentionSourceInventory,
  source: AttentionSource,
): ProviderSessionBinding | null {
  return inventory.providerSessions.get(sourceKey(source)) ?? null;
}
