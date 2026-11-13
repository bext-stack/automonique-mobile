// SPDX-License-Identifier: Elastic-2.0

import { createHash } from 'node:crypto';

import {
  beginAccountSignIn,
  holdAccountSignIn,
  inspectAccountSignIn,
  redeemAccountSignIn,
  signInGrant,
  takeAccountSignIn,
  type AccountSignInDependencies,
} from './account-signin';

const ORIGIN = 'https://monique.example.test';
const GRANT = 'a'.repeat(64);

function crypto(now = 1_000): AccountSignInDependencies {
  return {
    randomBytes: (count) => new Uint8Array(count).fill(7),
    sha256: async (text) =>
      new Uint8Array(createHash('sha256').update(text).digest()),
    now: () => now,
    wait: async () => undefined,
  };
}

function reply(status: number, body: string): typeof fetch {
  return jest.fn(async () => new Response(body, { status })) as never;
}

test('an attempt carries a verifier and sends only its digest', async () => {
  const attempt = await beginAccountSignIn(`${ORIGIN}/`, crypto());
  expect(attempt.origin).toBe(ORIGIN);
  expect(attempt.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const challenge = createHash('sha256')
    .update(attempt.verifier)
    .digest('base64url');
  expect(attempt.url).toBe(
    `${ORIGIN}/api/mobile/signin/start?challenge=${challenge}`,
  );
  expect(attempt.url).not.toContain(attempt.verifier);
});

test('sign-in needs an HTTPS server', async () => {
  await expect(
    beginAccountSignIn('http://monique.example.test', crypto()),
  ).rejects.toThrow('https_required');
});

test('a server offers sign-in only with the expected answer', async () => {
  const offered = JSON.stringify({
    schema: 'automonique.mobile-signin/v1',
    provider: 'Example',
  });
  await expect(
    inspectAccountSignIn(ORIGIN, undefined, { fetcher: reply(200, offered) }),
  ).resolves.toEqual({ provider: 'Example' });
  for (const fetcher of [
    reply(404, '{"error":"mobile_signin_unconfigured"}'),
    reply(200, '{"schema":"other/v1","provider":"Example"}'),
    reply(200, '{"schema":"automonique.mobile-signin/v1","provider":""}'),
    reply(200, 'not json'),
    jest.fn(async () => {
      throw new Error('offline');
    }) as never,
  ]) {
    await expect(
      inspectAccountSignIn(ORIGIN, undefined, { fetcher }),
    ).resolves.toBeNull();
  }
});

test('redeeming posts the grant with the verifier and returns the offer', async () => {
  const attempt = await beginAccountSignIn(ORIGIN, crypto());
  const fetcher = reply(201, '{"offer":true}');
  await expect(
    redeemAccountSignIn(attempt, GRANT, undefined, { ...crypto(), fetcher }),
  ).resolves.toBe('{"offer":true}');
  const [url, init] = jest.mocked(fetcher).mock.calls[0]!;
  expect(url).toBe(`${ORIGIN}/api/mobile/signin/redeem`);
  expect(JSON.parse(String(init?.body))).toEqual({
    grant: GRANT,
    verifier: attempt.verifier,
  });
});

test('a refused, unreachable or stale redemption fails with a category', async () => {
  const attempt = await beginAccountSignIn(ORIGIN, crypto());
  await expect(
    redeemAccountSignIn(attempt, GRANT, undefined, {
      ...crypto(),
      fetcher: reply(400, '{"error":"mobile_signin_grant_invalid"}'),
    }),
  ).rejects.toThrow('account_signin_refused');
  await expect(
    redeemAccountSignIn(attempt, GRANT, undefined, {
      ...crypto(),
      fetcher: jest.fn(async () => {
        throw new Error('offline');
      }) as never,
    }),
  ).rejects.toThrow('account_signin_unreachable');
  const fetcher = reply(201, '{}');
  await expect(
    redeemAccountSignIn(attempt, GRANT, undefined, {
      ...crypto(1_000 + 10 * 60 * 1000 + 1),
      fetcher,
    }),
  ).rejects.toThrow('account_signin_expired');
  expect(fetcher).not.toHaveBeenCalled();
});

test('a redemption that failed to send is sent again', async () => {
  const attempt = await beginAccountSignIn(ORIGIN, crypto());
  let calls = 0;
  const fetcher = jest.fn(async () => {
    calls += 1;
    if (calls < 3) throw new TypeError('Network request failed');
    return new Response('{"offer":true}', { status: 201 });
  }) as never;
  const waits: number[] = [];
  await expect(
    redeemAccountSignIn(attempt, GRANT, undefined, {
      ...crypto(),
      fetcher,
      wait: async (milliseconds) => {
        waits.push(milliseconds);
      },
    }),
  ).resolves.toBe('{"offer":true}');
  expect(calls).toBe(3);
  expect(waits).toEqual([400, 1200]);
});

test('a refused redemption is not sent again', async () => {
  const attempt = await beginAccountSignIn(ORIGIN, crypto());
  const fetcher = reply(400, '{"error":"mobile_signin_grant_invalid"}');
  await expect(
    redeemAccountSignIn(attempt, GRANT, undefined, { ...crypto(), fetcher }),
  ).rejects.toThrow('account_signin_refused');
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test('a return link is honoured once and only when well formed', async () => {
  expect(signInGrant(GRANT)).toBe(GRANT);
  expect(signInGrant('A'.repeat(64))).toBeNull();
  expect(signInGrant('abc')).toBeNull();
  expect(signInGrant(undefined)).toBeNull();
  const attempt = await beginAccountSignIn(ORIGIN, crypto());
  holdAccountSignIn(attempt);
  expect(takeAccountSignIn()).toBe(attempt);
  expect(takeAccountSignIn()).toBeNull();
});
