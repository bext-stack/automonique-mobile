// SPDX-License-Identifier: Elastic-2.0

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  decodeWorkspaceCompanionCache,
  encodeWorkspaceCompanionCache,
  type WorkspaceCompanionCache,
} from './workspace-companion-cache';
import { revokeWorkspaceCatalogServer } from './workspace-catalog-reducer';
import type { ServerIdentity } from './workspace-companion';
import { decimalRevision, type DecimalRevision } from './types';

const WORKSPACE_CACHE_KEY = 'automonique.mobile.workspace-catalog.v2';
const LEGACY_WORKSPACE_CACHE_KEY = 'automonique.mobile.workspace-catalog.v1';
const WORKSPACE_DRAFTS_KEY = 'automonique.mobile.workspace-drafts.v1';
const REVIEW_DRAFTS_KEY = 'automonique.mobile.review-drafts.v1';
export const MAX_WORKSPACE_DRAFT_BYTES = 4_096;
export const MAX_WORKSPACE_DRAFTS = 32;
const MAX_WORKSPACE_DRAFT_ENVELOPE_BYTES = 160 * 1024;
export const MAX_REVIEW_DRAFT_BYTES = 4_096;
export const MAX_REVIEW_DRAFTS = 64;
const MAX_REVIEW_DRAFT_ENVELOPE_BYTES = 320 * 1024;

export interface WorkspaceDraftScope {
  readonly serverIdentity: ServerIdentity;
  readonly authorizationRevision: DecimalRevision;
  readonly workspaceId: string;
  readonly workspaceRevision: DecimalRevision;
}

export interface WorkspaceCacheGeneration {
  readonly serverIdentity: ServerIdentity;
  readonly authorizationRevision: DecimalRevision;
}

interface StoredWorkspaceDraft extends WorkspaceDraftScope {
  readonly text: string;
  readonly updatedAtMs: string;
}

interface WorkspaceDraftEnvelope {
  readonly schema: 'automonique.mobile-workspace-drafts/v2';
  readonly drafts: readonly StoredWorkspaceDraft[];
}

export interface ReviewDraftScope {
  readonly serverIdentity: ServerIdentity;
  readonly authorizationRevision: DecimalRevision;
  readonly principalGeneration: DecimalRevision;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly workspaceRevision: DecimalRevision;
  readonly reviewRevision: DecimalRevision;
  readonly fileId: string;
  readonly hunkId: string;
  readonly side: 'old' | 'new';
  readonly line: DecimalRevision;
}

export interface StoredReviewDraft extends ReviewDraftScope {
  readonly text: string;
  readonly updatedAtMs: string;
}

interface ReviewDraftEnvelope {
  readonly schema: 'automonique.mobile-review-drafts/v1';
  readonly drafts: readonly StoredReviewDraft[];
}

const encoder = new TextEncoder();
const revocationFences = new Map<string, bigint>();
const activeOperations = new Map<string, Set<AbortController>>();
let storageTail: Promise<void> = Promise.resolve();

function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const result = storageTail.then(operation, operation);
  storageTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function draftKey(scope: WorkspaceDraftScope): string {
  return `${scope.serverIdentity}\u0000${scope.authorizationRevision}\u0000${scope.workspaceId}\u0000${scope.workspaceRevision}`;
}

function reviewDraftKey(scope: ReviewDraftScope): string {
  return [
    scope.serverIdentity,
    scope.authorizationRevision,
    scope.principalGeneration,
    scope.projectId,
    scope.workspaceId,
    scope.workspaceRevision,
    scope.reviewRevision,
    scope.fileId,
    scope.hunkId,
    scope.side,
    scope.line,
  ].join('\u0000');
}

function boundedText(value: unknown, maximum: number): string {
  if (
    typeof value !== 'string' ||
    encoder.encode(value).byteLength > maximum ||
    /\u0000/u.test(value)
  ) {
    throw new Error('workspace_draft_invalid');
  }
  return value;
}

function decodeDrafts(encoded: string | null): WorkspaceDraftEnvelope {
  if (encoded === null) {
    return { schema: 'automonique.mobile-workspace-drafts/v2', drafts: [] };
  }
  if (encoder.encode(encoded).byteLength > MAX_WORKSPACE_DRAFT_ENVELOPE_BYTES) {
    throw new Error('workspace_draft_invalid');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(encoded);
  } catch {
    throw new Error('workspace_draft_invalid');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('workspace_draft_invalid');
  }
  const envelope = parsed as Record<string, unknown>;
  if (
    Object.keys(envelope).length !== 2 ||
    envelope.schema !== 'automonique.mobile-workspace-drafts/v2' ||
    !Array.isArray(envelope.drafts) ||
    envelope.drafts.length > MAX_WORKSPACE_DRAFTS
  ) {
    throw new Error('workspace_draft_invalid');
  }
  const keys = new Set<string>();
  const drafts = envelope.drafts.map((entry): StoredWorkspaceDraft => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('workspace_draft_invalid');
    }
    const value = entry as Record<string, unknown>;
    if (
      Object.keys(value).length !== 6 ||
      typeof value.serverIdentity !== 'string' ||
      !/^sha256:[a-f0-9]{64}$/u.test(value.serverIdentity) ||
      typeof value.updatedAtMs !== 'string' ||
      !/^[1-9][0-9]{0,18}$/u.test(value.updatedAtMs)
    ) {
      throw new Error('workspace_draft_invalid');
    }
    const draft: StoredWorkspaceDraft = {
      serverIdentity: value.serverIdentity as ServerIdentity,
      authorizationRevision: decimalRevision(
        boundedText(value.authorizationRevision, 19),
      ),
      workspaceId: boundedText(value.workspaceId, 256),
      workspaceRevision: decimalRevision(
        boundedText(value.workspaceRevision, 19),
      ),
      text: boundedText(value.text, MAX_WORKSPACE_DRAFT_BYTES),
      updatedAtMs: value.updatedAtMs,
    };
    const key = draftKey(draft);
    if (keys.has(key)) throw new Error('workspace_draft_invalid');
    keys.add(key);
    return draft;
  });
  return { schema: 'automonique.mobile-workspace-drafts/v2', drafts };
}

function encodeDrafts(drafts: readonly StoredWorkspaceDraft[]): string {
  const encoded = JSON.stringify({
    schema: 'automonique.mobile-workspace-drafts/v2',
    drafts: drafts.slice(0, MAX_WORKSPACE_DRAFTS),
  });
  if (encoder.encode(encoded).byteLength > MAX_WORKSPACE_DRAFT_ENVELOPE_BYTES) {
    throw new Error('workspace_draft_invalid');
  }
  decodeDrafts(encoded);
  return encoded;
}

function decodeReviewDrafts(encoded: string | null): ReviewDraftEnvelope {
  if (encoded === null) {
    return { schema: 'automonique.mobile-review-drafts/v1', drafts: [] };
  }
  if (encoder.encode(encoded).byteLength > MAX_REVIEW_DRAFT_ENVELOPE_BYTES) {
    throw new Error('review_draft_invalid');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(encoded);
  } catch {
    throw new Error('review_draft_invalid');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('review_draft_invalid');
  }
  const value = parsed as Record<string, unknown>;
  if (
    Object.keys(value).length !== 2 ||
    value.schema !== 'automonique.mobile-review-drafts/v1' ||
    !Array.isArray(value.drafts) ||
    value.drafts.length > MAX_REVIEW_DRAFTS
  ) {
    throw new Error('review_draft_invalid');
  }
  const keys = new Set<string>();
  const drafts = value.drafts.map((entry): StoredReviewDraft => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('review_draft_invalid');
    }
    const candidate = entry as Record<string, unknown>;
    const fields = [
      'serverIdentity',
      'authorizationRevision',
      'principalGeneration',
      'projectId',
      'workspaceId',
      'workspaceRevision',
      'reviewRevision',
      'fileId',
      'hunkId',
      'side',
      'line',
      'text',
      'updatedAtMs',
    ];
    if (
      Object.keys(candidate).length !== fields.length ||
      fields.some((field) => !Object.hasOwn(candidate, field)) ||
      typeof candidate.serverIdentity !== 'string' ||
      !/^sha256:[a-f0-9]{64}$/u.test(candidate.serverIdentity) ||
      !['old', 'new'].includes(String(candidate.side)) ||
      typeof candidate.updatedAtMs !== 'string' ||
      !/^[1-9][0-9]{0,18}$/u.test(candidate.updatedAtMs)
    ) {
      throw new Error('review_draft_invalid');
    }
    const draft: StoredReviewDraft = {
      serverIdentity: candidate.serverIdentity as ServerIdentity,
      authorizationRevision: decimalRevision(
        boundedText(candidate.authorizationRevision, 19),
      ),
      principalGeneration: decimalRevision(
        boundedText(candidate.principalGeneration, 19),
      ),
      projectId: boundedText(candidate.projectId, 256),
      workspaceId: boundedText(candidate.workspaceId, 256),
      workspaceRevision: decimalRevision(
        boundedText(candidate.workspaceRevision, 19),
      ),
      reviewRevision: decimalRevision(
        boundedText(candidate.reviewRevision, 19),
      ),
      fileId: boundedText(candidate.fileId, 256),
      hunkId: boundedText(candidate.hunkId, 256),
      side: candidate.side as 'old' | 'new',
      line: decimalRevision(boundedText(candidate.line, 19)),
      text: boundedText(candidate.text, MAX_REVIEW_DRAFT_BYTES),
      updatedAtMs: candidate.updatedAtMs,
    };
    const key = reviewDraftKey(draft);
    if (keys.has(key)) throw new Error('review_draft_invalid');
    keys.add(key);
    return draft;
  });
  return { schema: 'automonique.mobile-review-drafts/v1', drafts };
}

function encodeReviewDrafts(drafts: readonly StoredReviewDraft[]): string {
  const encoded = JSON.stringify({
    schema: 'automonique.mobile-review-drafts/v1',
    drafts: drafts.slice(0, MAX_REVIEW_DRAFTS),
  });
  if (encoder.encode(encoded).byteLength > MAX_REVIEW_DRAFT_ENVELOPE_BYTES) {
    throw new Error('review_draft_invalid');
  }
  decodeReviewDrafts(encoded);
  return encoded;
}

function generationRevoked(
  serverIdentity: string,
  authorizationRevision: DecimalRevision,
): boolean {
  const fence = revocationFences.get(serverIdentity);
  return fence !== undefined && BigInt(authorizationRevision) <= fence;
}

export function registerWorkspaceOperation(
  serverIdentity: string,
  controller: AbortController,
): () => void {
  const operations = activeOperations.get(serverIdentity) ?? new Set();
  operations.add(controller);
  activeOperations.set(serverIdentity, operations);
  return () => {
    operations.delete(controller);
    if (operations.size === 0) activeOperations.delete(serverIdentity);
  };
}

function abortWorkspaceOperations(serverIdentity: string): void {
  for (const controller of activeOperations.get(serverIdentity) ?? []) {
    controller.abort('workspace_server_revoked');
  }
}

async function readCatalogUnsafe(): Promise<WorkspaceCompanionCache | null> {
  const encoded = await AsyncStorage.getItem(WORKSPACE_CACHE_KEY);
  if (encoded === null) {
    // v1 collapsed the Platform v2 work-session identity into its retained v1
    // target. It cannot be reinterpreted safely, so discard rather than migrate.
    if ((await AsyncStorage.getItem(LEGACY_WORKSPACE_CACHE_KEY)) !== null) {
      await AsyncStorage.removeItem(LEGACY_WORKSPACE_CACHE_KEY);
    }
    return null;
  }
  try {
    return decodeWorkspaceCompanionCache(encoded);
  } catch {
    await AsyncStorage.removeItem(WORKSPACE_CACHE_KEY);
    return null;
  }
}

export function loadWorkspaceCatalogCache(): Promise<WorkspaceCompanionCache | null> {
  return serialized(readCatalogUnsafe);
}

export function persistWorkspaceCatalogCache(
  cache: WorkspaceCompanionCache,
  serverIdentity: string,
  authorizationRevision: DecimalRevision,
  signal?: AbortSignal,
): Promise<void> {
  return persistWorkspaceCatalogCacheForServers(
    cache,
    [
      {
        serverIdentity: serverIdentity as ServerIdentity,
        authorizationRevision,
      },
    ],
    signal,
  );
}

/**
 * Persist one public multi-server cache only when every included credential
 * generation is explicitly fenced and the owning operation is still live.
 */
export function persistWorkspaceCatalogCacheForServers(
  cache: WorkspaceCompanionCache,
  generations: readonly WorkspaceCacheGeneration[],
  signal?: AbortSignal,
): Promise<void> {
  return serialized(async () => {
    if (signal?.aborted) throw new Error('workspace_generation_replaced');
    const expected = new Map(
      cache.catalog.servers.map((server) => [
        server.serverIdentity,
        server.authorizationRevision,
      ]),
    );
    const supplied = new Map(
      generations.map((generation) => [
        generation.serverIdentity,
        generation.authorizationRevision,
      ]),
    );
    if (
      expected.size !== cache.catalog.servers.length ||
      supplied.size !== generations.length ||
      expected.size !== supplied.size ||
      [...expected].some(
        ([identity, revision]) => supplied.get(identity) !== revision,
      ) ||
      cache.intentDrafts.some((draft) => !expected.has(draft.serverIdentity))
    ) {
      throw new Error('workspace_cache_generation_scope_invalid');
    }
    for (const [identity, revision] of expected) {
      if (generationRevoked(identity, revision)) {
        throw new Error('workspace_generation_revoked');
      }
    }
    // Revocation installs its fence synchronously before queuing cleanup.
    // Re-check the operation after all generation validation and immediately
    // before the serialized write.
    if (signal?.aborted) throw new Error('workspace_generation_replaced');
    await AsyncStorage.setItem(
      WORKSPACE_CACHE_KEY,
      encodeWorkspaceCompanionCache(cache),
    );
  });
}

export function revokeWorkspaceServerStorage(
  serverIdentityValue: string,
  authorizationRevisionValue: string,
): Promise<void> {
  const serverIdentity = serverIdentityValue as ServerIdentity;
  const authorizationRevision = decimalRevision(authorizationRevisionValue);
  const current = revocationFences.get(serverIdentity) ?? 0n;
  if (BigInt(authorizationRevision) > current) {
    revocationFences.set(serverIdentity, BigInt(authorizationRevision));
  }
  abortWorkspaceOperations(serverIdentity);
  return serialized(async () => {
    const cache = await readCatalogUnsafe();
    if (cache !== null) {
      const catalog = revokeWorkspaceCatalogServer(
        cache.catalog,
        serverIdentity,
      );
      await AsyncStorage.setItem(
        WORKSPACE_CACHE_KEY,
        encodeWorkspaceCompanionCache({
          ...cache,
          catalog,
          intentDrafts: cache.intentDrafts.filter(
            (draft) => draft.serverIdentity !== serverIdentity,
          ),
        }),
      );
    }
    let envelope: WorkspaceDraftEnvelope = {
      schema: 'automonique.mobile-workspace-drafts/v2',
      drafts: [],
    };
    try {
      envelope = decodeDrafts(await AsyncStorage.getItem(WORKSPACE_DRAFTS_KEY));
    } catch {
      await AsyncStorage.removeItem(WORKSPACE_DRAFTS_KEY);
    }
    await AsyncStorage.setItem(
      WORKSPACE_DRAFTS_KEY,
      encodeDrafts(
        envelope.drafts.filter(
          (draft) => draft.serverIdentity !== serverIdentity,
        ),
      ),
    );
    let reviewEnvelope: ReviewDraftEnvelope;
    try {
      reviewEnvelope = decodeReviewDrafts(
        await AsyncStorage.getItem(REVIEW_DRAFTS_KEY),
      );
    } catch {
      await AsyncStorage.removeItem(REVIEW_DRAFTS_KEY);
      return;
    }
    await AsyncStorage.setItem(
      REVIEW_DRAFTS_KEY,
      encodeReviewDrafts(
        reviewEnvelope.drafts.filter(
          (draft) => draft.serverIdentity !== serverIdentity,
        ),
      ),
    );
  });
}

export function loadWorkspaceDraft(
  scope: WorkspaceDraftScope,
): Promise<string> {
  return serialized(async () => {
    if (generationRevoked(scope.serverIdentity, scope.authorizationRevision)) {
      return '';
    }
    let envelope: WorkspaceDraftEnvelope;
    try {
      envelope = decodeDrafts(await AsyncStorage.getItem(WORKSPACE_DRAFTS_KEY));
    } catch {
      await AsyncStorage.removeItem(WORKSPACE_DRAFTS_KEY);
      return '';
    }
    return (
      envelope.drafts.find((draft) => draftKey(draft) === draftKey(scope))
        ?.text ?? ''
    );
  });
}

export function persistWorkspaceDraft(
  scope: WorkspaceDraftScope,
  text: string,
  now = Date.now(),
): Promise<void> {
  boundedText(text, MAX_WORKSPACE_DRAFT_BYTES);
  return serialized(async () => {
    if (generationRevoked(scope.serverIdentity, scope.authorizationRevision)) {
      throw new Error('workspace_generation_revoked');
    }
    let envelope: WorkspaceDraftEnvelope;
    try {
      envelope = decodeDrafts(await AsyncStorage.getItem(WORKSPACE_DRAFTS_KEY));
    } catch {
      envelope = {
        schema: 'automonique.mobile-workspace-drafts/v2',
        drafts: [],
      };
    }
    const retained = envelope.drafts.filter(
      (draft) => draftKey(draft) !== draftKey(scope),
    );
    const drafts = (
      text.length === 0
        ? retained
        : [
            {
              ...scope,
              text,
              updatedAtMs: BigInt(now).toString(),
            },
            ...retained,
          ]
    )
      .sort((left, right) =>
        BigInt(right.updatedAtMs) > BigInt(left.updatedAtMs) ? 1 : -1,
      )
      .slice(0, MAX_WORKSPACE_DRAFTS);
    await AsyncStorage.setItem(WORKSPACE_DRAFTS_KEY, encodeDrafts(drafts));
  });
}

export function loadReviewDrafts(
  scope: Omit<ReviewDraftScope, 'fileId' | 'hunkId' | 'side' | 'line'>,
): Promise<readonly StoredReviewDraft[]> {
  return serialized(async () => {
    if (generationRevoked(scope.serverIdentity, scope.authorizationRevision)) {
      return [];
    }
    let envelope: ReviewDraftEnvelope;
    try {
      envelope = decodeReviewDrafts(
        await AsyncStorage.getItem(REVIEW_DRAFTS_KEY),
      );
    } catch {
      await AsyncStorage.removeItem(REVIEW_DRAFTS_KEY);
      return [];
    }
    return envelope.drafts.filter(
      (draft) =>
        draft.serverIdentity === scope.serverIdentity &&
        draft.authorizationRevision === scope.authorizationRevision &&
        draft.principalGeneration === scope.principalGeneration &&
        draft.projectId === scope.projectId &&
        draft.workspaceId === scope.workspaceId &&
        draft.workspaceRevision === scope.workspaceRevision &&
        draft.reviewRevision === scope.reviewRevision,
    );
  });
}

export function persistReviewDraft(
  scope: ReviewDraftScope,
  text: string,
  now = Date.now(),
): Promise<void> {
  boundedText(text, MAX_REVIEW_DRAFT_BYTES);
  return serialized(async () => {
    if (generationRevoked(scope.serverIdentity, scope.authorizationRevision)) {
      throw new Error('workspace_generation_revoked');
    }
    let envelope: ReviewDraftEnvelope;
    try {
      envelope = decodeReviewDrafts(
        await AsyncStorage.getItem(REVIEW_DRAFTS_KEY),
      );
    } catch {
      envelope = { schema: 'automonique.mobile-review-drafts/v1', drafts: [] };
    }
    const retained = envelope.drafts.filter(
      (draft) => reviewDraftKey(draft) !== reviewDraftKey(scope),
    );
    const drafts = (
      text.length === 0
        ? retained
        : [{ ...scope, text, updatedAtMs: BigInt(now).toString() }, ...retained]
    )
      .sort((left, right) =>
        BigInt(right.updatedAtMs) > BigInt(left.updatedAtMs) ? 1 : -1,
      )
      .slice(0, MAX_REVIEW_DRAFTS);
    await AsyncStorage.setItem(REVIEW_DRAFTS_KEY, encodeReviewDrafts(drafts));
  });
}
