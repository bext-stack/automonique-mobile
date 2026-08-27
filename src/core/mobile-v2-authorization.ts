// SPDX-License-Identifier: Elastic-2.0

import { ProjectId, type ProjectId as ProjectIdValue } from '@automonique/sdk';

export const MOBILE_V2_AUTHORIZATION_SCHEMA =
  'automonique.mobile-platform-v2-authorization/v1' as const;
export const MAX_MOBILE_V2_PROJECT_ROOTS = 32;

export const MOBILE_V2_ACTIONS = [
  'query_work_contexts',
  'get_lineage',
  'prepare_mutation',
  'decide_mutation',
  'submit_mutation',
  'get_mutation_receipt',
  'submit_workspace_intent',
  'get_workspace_intent',
  'get_review',
] as const;

export type MobileV2Action = (typeof MOBILE_V2_ACTIONS)[number];

export interface DelegatedMobileV2Authorization {
  readonly schema: typeof MOBILE_V2_AUTHORIZATION_SCHEMA;
  readonly server_identity: string;
  readonly credential_id: string;
  readonly credential_revision: bigint;
  readonly authorization_revision: bigint;
  readonly principal_generation: bigint;
  readonly delegation_id: string;
  readonly tenant_id: string;
  readonly actor_id: string;
  readonly issued_at_ms: bigint;
  readonly expires_at_ms: bigint;
  readonly project_roots: readonly ProjectIdValue[];
  readonly actions: readonly MobileV2Action[];
}

function object(value: unknown): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('mobile_v2_authorization_invalid');
  }
  return value as Readonly<Record<string, unknown>>;
}

function exact(
  value: Readonly<Record<string, unknown>>,
  fields: readonly string[],
): void {
  const keys = Object.keys(value);
  if (
    keys.length !== fields.length ||
    fields.some((field) => !Object.hasOwn(value, field))
  ) {
    throw new Error('mobile_v2_authorization_invalid');
  }
}

function boundedString(value: unknown, maximum = 256): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    new TextEncoder().encode(value).length > maximum ||
    /\p{Cc}/u.test(value)
  ) {
    throw new Error('mobile_v2_authorization_invalid');
  }
  return value;
}

function positive(value: unknown): bigint {
  if (typeof value !== 'bigint' || value <= 0n) {
    throw new Error('mobile_v2_authorization_invalid');
  }
  return value;
}

export function admitDelegatedMobileV2Authorization(
  value: unknown,
  expected: {
    readonly serverIdentity: string;
    readonly credentialId: string;
    readonly credentialRevision: bigint;
    readonly authorizationRevision: bigint;
    readonly now: number;
  },
): DelegatedMobileV2Authorization {
  const candidate = object(value);
  exact(candidate, [
    'schema',
    'server_identity',
    'credential_id',
    'credential_revision',
    'authorization_revision',
    'principal_generation',
    'delegation_id',
    'tenant_id',
    'actor_id',
    'issued_at_ms',
    'expires_at_ms',
    'project_roots',
    'actions',
  ]);
  if (
    candidate.schema !== MOBILE_V2_AUTHORIZATION_SCHEMA ||
    !Array.isArray(candidate.project_roots) ||
    candidate.project_roots.length === 0 ||
    candidate.project_roots.length > MAX_MOBILE_V2_PROJECT_ROOTS ||
    !Array.isArray(candidate.actions) ||
    candidate.actions.length === 0 ||
    candidate.actions.length > MOBILE_V2_ACTIONS.length
  ) {
    throw new Error('mobile_v2_authorization_invalid');
  }
  const authorization: DelegatedMobileV2Authorization = {
    schema: MOBILE_V2_AUTHORIZATION_SCHEMA,
    server_identity: boundedString(candidate.server_identity, 96),
    credential_id: boundedString(candidate.credential_id, 96),
    credential_revision: positive(candidate.credential_revision),
    authorization_revision: positive(candidate.authorization_revision),
    principal_generation: positive(candidate.principal_generation),
    delegation_id: boundedString(candidate.delegation_id, 128),
    tenant_id: boundedString(candidate.tenant_id, 128),
    actor_id: boundedString(candidate.actor_id, 128),
    issued_at_ms: positive(candidate.issued_at_ms),
    expires_at_ms: positive(candidate.expires_at_ms),
    project_roots: candidate.project_roots.map((root) =>
      ProjectId(boundedString(root)),
    ),
    actions: candidate.actions.map((action) => {
      if (!MOBILE_V2_ACTIONS.includes(action as MobileV2Action)) {
        throw new Error('mobile_v2_authorization_invalid');
      }
      return action as MobileV2Action;
    }),
  };
  if (
    authorization.server_identity !== expected.serverIdentity ||
    authorization.credential_id !== expected.credentialId ||
    authorization.credential_revision !== expected.credentialRevision ||
    authorization.authorization_revision !== expected.authorizationRevision ||
    authorization.issued_at_ms > BigInt(expected.now) ||
    authorization.expires_at_ms <= BigInt(expected.now) ||
    authorization.issued_at_ms >= authorization.expires_at_ms ||
    new Set(authorization.project_roots).size !==
      authorization.project_roots.length ||
    new Set(authorization.actions).size !== authorization.actions.length ||
    !authorization.project_roots.every(
      (root, index) =>
        index === 0 || authorization.project_roots[index - 1]! < root,
    ) ||
    !authorization.actions.every(
      (action, index) =>
        index === 0 ||
        MOBILE_V2_ACTIONS.indexOf(authorization.actions[index - 1]!) <
          MOBILE_V2_ACTIONS.indexOf(action),
    )
  ) {
    throw new Error('mobile_v2_authorization_invalid');
  }
  return authorization;
}

export function mobileV2AuthorizationFingerprint(
  value: DelegatedMobileV2Authorization,
): string {
  return JSON.stringify({
    schema: value.schema,
    serverIdentity: value.server_identity,
    credentialId: value.credential_id,
    credentialRevision: value.credential_revision.toString(),
    authorizationRevision: value.authorization_revision.toString(),
    principalGeneration: value.principal_generation.toString(),
    delegationId: value.delegation_id,
    tenantId: value.tenant_id,
    actorId: value.actor_id,
    issuedAtMs: value.issued_at_ms.toString(),
    expiresAtMs: value.expires_at_ms.toString(),
    projectRoots: value.project_roots,
    actions: value.actions,
  });
}
