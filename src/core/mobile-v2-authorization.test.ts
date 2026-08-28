// SPDX-License-Identifier: Elastic-2.0

import { ProjectId } from '@automonique/sdk';

import {
  MOBILE_V2_ACTIONS,
  MOBILE_V2_AUTHORIZATION_SCHEMA,
  admitDelegatedMobileV2Authorization,
  admitMobileV2ReceiptMigrationMetadata,
  deriveMobileV2ReceiptMigrationMetadata,
  mobileV2AuthorizationDigest,
  mobileV2AuthorizationFingerprint,
  mobileV2DelegationFamilyDigest,
} from './mobile-v2-authorization';

jest.mock('expo-crypto', () => {
  const crypto =
    jest.requireActual<typeof import('node:crypto')>('node:crypto');
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    digestStringAsync: async (_algorithm: string, value: string) =>
      crypto.createHash('sha256').update(value).digest('hex'),
  };
});

const NOW = 1_777_000_000_000;
const expected = {
  serverIdentity: `sha256:${'a'.repeat(64)}`,
  credentialId: 'credential-mobile',
  credentialRevision: 3n,
  authorizationRevision: 5n,
  expiresAtMs: BigInt(NOW + 60_000),
  now: NOW,
};

function document() {
  return {
    schema: MOBILE_V2_AUTHORIZATION_SCHEMA,
    server_identity: expected.serverIdentity,
    credential_id: expected.credentialId,
    credential_revision: expected.credentialRevision,
    authorization_revision: expected.authorizationRevision,
    principal_generation: 7n,
    delegation_id: 'delegation-mobile',
    tenant_id: 'tenant-mobile',
    actor_id: 'operator-mobile',
    issued_at_ms: BigInt(NOW - 1),
    expires_at_ms: BigInt(NOW + 60_000),
    project_roots: [ProjectId('project-a'), ProjectId('project-b')],
    actions: MOBILE_V2_ACTIONS,
  };
}

test('admits and process-locally fingerprints the entire delegated principal', () => {
  const admitted = admitDelegatedMobileV2Authorization(document(), expected);
  const changed = { ...admitted, principal_generation: 8n };
  expect(mobileV2AuthorizationFingerprint(admitted)).not.toBe(
    mobileV2AuthorizationFingerprint(changed),
  );
  expect(mobileV2AuthorizationFingerprint(admitted)).toContain(
    'get_mutation_receipt',
  );
});

test.each([
  ['equal', 0, true],
  ['shorter', -1, false],
  ['longer', 1, false],
] as const)(
  '%s delegated expiry is admitted only when equal to the enclosing v1 grant',
  (_label, delta, admitted) => {
    const candidate = {
      ...document(),
      expires_at_ms: expected.expiresAtMs + BigInt(delta),
    };
    const operation = () =>
      admitDelegatedMobileV2Authorization(candidate, expected);
    if (admitted) expect(operation).not.toThrow();
    else expect(operation).toThrow('mobile_v2_authorization_invalid');
  },
);

test('derives a fixed cryptographic persistence digest without exposing authority', async () => {
  const admitted = admitDelegatedMobileV2Authorization(document(), expected);
  const digest = await mobileV2AuthorizationDigest(admitted);
  const changed = await mobileV2AuthorizationDigest({
    ...admitted,
    principal_generation: 8n,
  });
  expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  expect(changed).not.toBe(digest);
  expect(digest).not.toContain('get_mutation_receipt');
  expect(digest).not.toContain('project-a');
});

test('keeps one delegation receipt family stable across token rotation but not regrant', async () => {
  const admitted = admitDelegatedMobileV2Authorization(document(), expected);
  const family = await mobileV2DelegationFamilyDigest(admitted);
  const rotatedAuthorization = {
    ...admitted,
    credential_revision: 4n,
    principal_generation: 8n,
    project_roots: [ProjectId('project-other')],
    actions: ['get_mutation_receipt'] as const,
  };
  const rotated = await mobileV2DelegationFamilyDigest(rotatedAuthorization);
  const regranted = await mobileV2DelegationFamilyDigest({
    ...rotatedAuthorization,
    delegation_id: 'delegation-regranted',
  });
  expect(rotated).toBe(family);
  expect(regranted).not.toBe(family);
  expect(family).toMatch(/^sha256:[0-9a-f]{64}$/u);
  expect(family).not.toContain(admitted.credential_id);
});

test('derives only fixed migration coordinates from an expired grant', async () => {
  const metadata = await deriveMobileV2ReceiptMigrationMetadata(
    { ...document(), expires_at_ms: BigInt(NOW) },
    { ...expected, expiresAtMs: BigInt(NOW) },
  );
  expect(metadata).toEqual({
    schema: 'automonique.mobile-platform-v2-receipt-migration/v1',
    server_identity: expected.serverIdentity,
    credential_id: expected.credentialId,
    delegation_id: 'delegation-mobile',
    authorization_digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
  });
  expect(JSON.stringify(metadata)).not.toContain('project-a');
  expect(JSON.stringify(metadata)).not.toContain('get_mutation_receipt');
  expect(admitMobileV2ReceiptMigrationMetadata(metadata, expected)).toEqual(
    metadata,
  );
  expect(() =>
    admitMobileV2ReceiptMigrationMetadata(
      { ...metadata, credential_id: 'credential-other' },
      expected,
    ),
  ).toThrow('mobile_v2_receipt_migration_invalid');
});

test.each([
  ['unknown field', { ...document(), future: true }],
  [
    'wrong identity',
    { ...document(), server_identity: `sha256:${'b'.repeat(64)}` },
  ],
  ['wrong credential revision', { ...document(), credential_revision: 4n }],
  ['expired', { ...document(), expires_at_ms: BigInt(NOW) }],
  ['future-issued', { ...document(), issued_at_ms: BigInt(NOW + 1) }],
  [
    'unsorted roots',
    {
      ...document(),
      project_roots: [ProjectId('project-b'), ProjectId('project-a')],
    },
  ],
  [
    'duplicate roots',
    {
      ...document(),
      project_roots: [ProjectId('project-a'), ProjectId('project-a')],
    },
  ],
  [
    'unsorted actions',
    { ...document(), actions: [...MOBILE_V2_ACTIONS].reverse() },
  ],
  [
    'duplicate actions',
    { ...document(), actions: ['query_work_contexts', 'query_work_contexts'] },
  ],
  ['unknown action', { ...document(), actions: ['generic_execute'] }],
])('refuses %s without normalizing authority', (_label, value) => {
  expect(() => admitDelegatedMobileV2Authorization(value, expected)).toThrow(
    'mobile_v2_authorization_invalid',
  );
});
