// SPDX-License-Identifier: Elastic-2.0

import {
  MAX_WORKSPACE_HOSTS,
  MAX_WORKSPACE_PROJECTS,
  MAX_WORKSPACE_SERVERS,
  MAX_WORKSPACE_SESSIONS,
  MAX_WORKSPACES,
  WORKSPACE_COMPANION_SCHEMA,
  admitWorkspaceCompanionCatalog,
  admitWorkspaceIntentRequest,
  type WorkspaceCompanionCatalog,
  type WorkspaceIntentRequest,
} from './workspace-companion';

export const MAX_WORKSPACE_COMPANION_CACHE_BYTES = 256 * 1024;
export const MAX_WORKSPACE_INTENT_DRAFTS = 32;

export interface WorkspaceCompanionCache {
  readonly schema: 'automonique.mobile-workspace-cache/v1';
  readonly catalog: WorkspaceCompanionCatalog;
  readonly intentDrafts: readonly WorkspaceIntentRequest[];
}

function boundCatalog(
  catalog: WorkspaceCompanionCatalog,
): WorkspaceCompanionCatalog {
  let remainingSessions = MAX_WORKSPACE_SESSIONS;
  return {
    ...catalog,
    // Security fences are never truncated: admission rejects an oversized
    // catalog instead of making an omitted identity or object replayable.
    serverTombstones: catalog.serverTombstones,
    revisionTombstones: catalog.revisionTombstones,
    servers: catalog.servers.slice(0, MAX_WORKSPACE_SERVERS).map((server) => ({
      ...server,
      hosts: server.hosts.slice(0, MAX_WORKSPACE_HOSTS),
      projects: server.projects.slice(0, MAX_WORKSPACE_PROJECTS),
      workspaces: server.workspaces
        .slice(0, MAX_WORKSPACES)
        .map((workspace) => {
          const sessions = workspace.sessions.slice(0, remainingSessions);
          remainingSessions -= sessions.length;
          return { ...workspace, sessions };
        }),
    })),
  };
}

export function encodeWorkspaceCompanionCache(
  cache: WorkspaceCompanionCache,
): string {
  const encoded = JSON.stringify({
    schema: 'automonique.mobile-workspace-cache/v1',
    catalog: boundCatalog(cache.catalog),
    intentDrafts: cache.intentDrafts.slice(0, MAX_WORKSPACE_INTENT_DRAFTS),
  });
  if (
    new TextEncoder().encode(encoded).byteLength >
    MAX_WORKSPACE_COMPANION_CACHE_BYTES
  ) {
    throw new Error('workspace_companion_cache_too_large');
  }
  // Apply the runtime admission rules before a caller persists the value.
  decodeEnvelope(encoded);
  return encoded;
}

function decodeEnvelope(encoded: string): WorkspaceCompanionCache {
  if (
    new TextEncoder().encode(encoded).byteLength >
    MAX_WORKSPACE_COMPANION_CACHE_BYTES
  ) {
    throw new Error('workspace_companion_cache_too_large');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(encoded);
  } catch {
    throw new Error('workspace_companion_cache_invalid');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('workspace_companion_cache_invalid');
  }
  const envelope = parsed as Record<string, unknown>;
  if (
    Object.keys(envelope).length !== 3 ||
    envelope.schema !== 'automonique.mobile-workspace-cache/v1' ||
    !Object.hasOwn(envelope, 'catalog') ||
    !Array.isArray(envelope.intentDrafts) ||
    envelope.intentDrafts.length > MAX_WORKSPACE_INTENT_DRAFTS
  ) {
    throw new Error('workspace_companion_cache_invalid');
  }
  try {
    return {
      schema: 'automonique.mobile-workspace-cache/v1',
      catalog: admitWorkspaceCompanionCatalog(envelope.catalog),
      intentDrafts: envelope.intentDrafts.map(admitWorkspaceIntentRequest),
    };
  } catch (error) {
    throw new Error('workspace_companion_cache_invalid', { cause: error });
  }
}

export function decodeWorkspaceCompanionCache(
  encoded: string,
): WorkspaceCompanionCache {
  const admitted = decodeEnvelope(encoded);
  return {
    ...admitted,
    catalog: {
      ...admitted.catalog,
      schema: WORKSPACE_COMPANION_SCHEMA,
      phase: 'stale',
      servers: admitted.catalog.servers.map((server) => ({
        ...server,
        authorization:
          server.authorization === 'revoked' ? 'revoked' : 'cached',
        actions: server.actions.includes('workspace_read')
          ? (['workspace_read'] as const)
          : [],
      })),
    },
  };
}
