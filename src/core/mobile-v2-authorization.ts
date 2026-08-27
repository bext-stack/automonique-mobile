// SPDX-License-Identifier: Elastic-2.0

import {
  MAX_MOBILE_V2_PROJECT_ROOTS as SDK_MAX_MOBILE_V2_PROJECT_ROOTS,
  MOBILE_PLATFORM_V2_ACTIONS,
  MOBILE_PLATFORM_V2_AUTHORIZATION_MEDIA_TYPE,
  MOBILE_PLATFORM_V2_AUTHORIZATION_SCHEMA,
  ProjectId,
  type MobilePlatformV2Action,
  type ProjectId as ProjectIdValue,
} from '@automonique/sdk';
import * as Crypto from 'expo-crypto';

export const MOBILE_V2_AUTHORIZATION_SCHEMA =
  MOBILE_PLATFORM_V2_AUTHORIZATION_SCHEMA;
export const MOBILE_V2_AUTHORIZATION_MEDIA_TYPE =
  MOBILE_PLATFORM_V2_AUTHORIZATION_MEDIA_TYPE;
export const MAX_MOBILE_V2_PROJECT_ROOTS = SDK_MAX_MOBILE_V2_PROJECT_ROOTS;

export const MOBILE_V2_ACTIONS = MOBILE_PLATFORM_V2_ACTIONS;

export type MobileV2Action = MobilePlatformV2Action;

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

export const MOBILE_V2_RECEIPT_MIGRATION_SCHEMA =
  'automonique.mobile-platform-v2-receipt-migration/v1' as const;

/**
 * Non-authority coordinates retained only long enough to move legacy receipt
 * handles into their stable delegation namespace. This is deliberately not a
 * delegated authorization and cannot construct a workspace gateway.
 */
export interface MobileV2ReceiptMigrationMetadata {
  readonly schema: typeof MOBILE_V2_RECEIPT_MIGRATION_SCHEMA;
  readonly server_identity: string;
  readonly credential_id: string;
  readonly delegation_id: string;
  readonly authorization_digest: string;
}

interface ExpectedMobileV2Authorization {
  readonly serverIdentity: string;
  readonly credentialId: string;
  readonly credentialRevision: bigint;
  readonly authorizationRevision: bigint;
  readonly now: number;
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

function admitDelegatedMobileV2AuthorizationInternal(
  value: unknown,
  expected: ExpectedMobileV2Authorization,
  allowExpired: boolean,
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
    (!allowExpired && authorization.expires_at_ms <= BigInt(expected.now)) ||
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

export function admitDelegatedMobileV2Authorization(
  value: unknown,
  expected: ExpectedMobileV2Authorization,
): DelegatedMobileV2Authorization {
  return admitDelegatedMobileV2AuthorizationInternal(value, expected, false);
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

/**
 * Fixed-size, non-authority persistence binding for the complete delegated
 * principal. The canonical fingerprint above remains process-local only.
 */
export async function mobileV2AuthorizationDigest(
  value: DelegatedMobileV2Authorization,
): Promise<string> {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    mobileV2AuthorizationFingerprint(value),
  );
  if (!/^[0-9a-f]{64}$/u.test(digest)) {
    throw new Error('mobile_v2_authorization_digest_invalid');
  }
  return `sha256:${digest}`;
}

/**
 * Structurally admit an old grant without reviving its expired authority, then
 * retain only the fixed receipt-migration coordinates derived from it.
 */
export async function deriveMobileV2ReceiptMigrationMetadata(
  value: unknown,
  expected: ExpectedMobileV2Authorization,
): Promise<MobileV2ReceiptMigrationMetadata> {
  const authorization = admitDelegatedMobileV2AuthorizationInternal(
    value,
    expected,
    true,
  );
  return {
    schema: MOBILE_V2_RECEIPT_MIGRATION_SCHEMA,
    server_identity: authorization.server_identity,
    credential_id: authorization.credential_id,
    delegation_id: authorization.delegation_id,
    authorization_digest: await mobileV2AuthorizationDigest(authorization),
  };
}

export function admitMobileV2ReceiptMigrationMetadata(
  value: unknown,
  expected: Pick<
    ExpectedMobileV2Authorization,
    'serverIdentity' | 'credentialId'
  >,
): MobileV2ReceiptMigrationMetadata {
  const candidate = object(value);
  exact(candidate, [
    'schema',
    'server_identity',
    'credential_id',
    'delegation_id',
    'authorization_digest',
  ]);
  const metadata: MobileV2ReceiptMigrationMetadata = {
    schema: MOBILE_V2_RECEIPT_MIGRATION_SCHEMA,
    server_identity: boundedString(candidate.server_identity, 96),
    credential_id: boundedString(candidate.credential_id, 96),
    delegation_id: boundedString(candidate.delegation_id, 128),
    authorization_digest: boundedString(candidate.authorization_digest, 71),
  };
  if (
    metadata.schema !== candidate.schema ||
    metadata.server_identity !== expected.serverIdentity ||
    metadata.credential_id !== expected.credentialId ||
    !/^sha256:[0-9a-f]{64}$/u.test(metadata.authorization_digest)
  ) {
    throw new Error('mobile_v2_receipt_migration_invalid');
  }
  return metadata;
}

/**
 * Stable, non-authority receipt namespace for one server-issued delegation.
 * Access-token rotation preserves the delegation ID; a regrant replaces it.
 */
export async function mobileV2DelegationFamilyDigest(
  value: Pick<
    DelegatedMobileV2Authorization,
    'server_identity' | 'credential_id' | 'delegation_id'
  >,
): Promise<string> {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    JSON.stringify({
      schema: 'automonique.mobile-workspace-v2-receipt-delegation/v1',
      serverIdentity: value.server_identity,
      credentialId: value.credential_id,
      delegationId: value.delegation_id,
    }),
  );
  if (!/^[0-9a-f]{64}$/u.test(digest)) {
    throw new Error('mobile_v2_delegation_family_digest_invalid');
  }
  return `sha256:${digest}`;
}
