// SPDX-License-Identifier: Elastic-2.0

import { ProjectId } from '@automonique/sdk';

import {
  MOBILE_V2_ACTIONS,
  MOBILE_V2_AUTHORIZATION_SCHEMA,
  admitDelegatedMobileV2Authorization,
  mobileV2AuthorizationFingerprint,
} from './mobile-v2-authorization';

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

test('admits and fingerprints the entire server-issued delegated principal', () => {
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
