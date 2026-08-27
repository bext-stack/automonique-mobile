// SPDX-License-Identifier: Elastic-2.0

import { ProjectId } from '@automonique/sdk';

import {
  MOBILE_V2_ACTIONS,
  MOBILE_V2_AUTHORIZATION_SCHEMA,
  admitDelegatedMobileV2Authorization,
  mobileV2AuthorizationDigest,
  mobileV2AuthorizationFingerprint,
  mobileV2CredentialFamilyDigest,
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

test('keeps the non-authority receipt family stable across rotation', async () => {
  const admitted = admitDelegatedMobileV2Authorization(document(), expected);
  const family = await mobileV2CredentialFamilyDigest(admitted);
  const rotatedAuthorization = {
    ...admitted,
    credential_revision: 4n,
    principal_generation: 8n,
    project_roots: [ProjectId('project-other')],
    actions: ['get_mutation_receipt'] as const,
  };
  const rotated = await mobileV2CredentialFamilyDigest(rotatedAuthorization);
  expect(rotated).toBe(family);
  expect(family).toMatch(/^sha256:[0-9a-f]{64}$/u);
  expect(family).not.toContain(admitted.credential_id);
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
