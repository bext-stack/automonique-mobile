// SPDX-License-Identifier: Elastic-2.0

import * as Crypto from 'expo-crypto';

import { httpFetch } from './http-fetch';
import { normalizeEndpoint } from './network-policy';

/**
 * Sign-in with an account, as a second way to obtain a pairing offer.
 *
 * The server runs the account flow in the system browser and returns to the
 * app through `automonique://signin?grant=…`. Another app could claim that
 * link, so the grant alone is worth nothing: redeeming it needs the verifier
 * generated here, which never leaves this process.
 */

const SCHEMA = 'automonique.mobile-signin/v1';
const SIGN_IN_PATH = '/api/mobile/signin';
const MAX_RESPONSE_BYTES = 8 * 1024;
/** Matches the server's limit on finishing at the account provider. */
const ATTEMPT_TTL_MS = 10 * 60 * 1000;

export interface AccountSignInOption {
  /** The account brand the server names, shown on the button. */
  readonly provider: string;
}

export interface AccountSignInAttempt {
  readonly origin: string;
  readonly verifier: string;
  readonly startedAt: number;
  /** Open this in the system browser. */
  readonly url: string;
}

export interface AccountSignInDependencies {
  readonly fetcher?: typeof fetch;
  readonly randomBytes?: (count: number) => Uint8Array;
  readonly sha256?: (text: string) => Promise<Uint8Array>;
  readonly now?: () => number;
  readonly wait?: (milliseconds: number) => Promise<void>;
}

/**
 * Pauses before sending the redemption again. The app has just come back from
 * the browser: the connection it held before may be dead, and the first
 * request on it then fails without ever leaving the phone.
 */
const REDEEM_RETRY_DELAYS_MS = [400, 1200, 2500];

function defaultWait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function base64Url(bytes: Uint8Array): string {
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let text = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] ?? 0;
    const b = bytes[index + 1] ?? 0;
    const c = bytes[index + 2] ?? 0;
    text += alphabet[a >> 2];
    text += alphabet[((a & 3) << 4) | (b >> 4)];
    if (index + 1 < bytes.length) text += alphabet[((b & 15) << 2) | (c >> 6)];
    if (index + 2 < bytes.length) text += alphabet[c & 63];
  }
  return text;
}

async function defaultSha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(
    await Crypto.digest(
      Crypto.CryptoDigestAlgorithm.SHA256,
      new TextEncoder().encode(text),
    ),
  );
}

async function boundedText(response: Response): Promise<string> {
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
    throw new Error('account_signin_response_invalid');
  }
  return text;
}

/** Whether this server offers account sign-in, and under which name. */
export async function inspectAccountSignIn(
  origin: string,
  signal?: AbortSignal,
  dependencies: AccountSignInDependencies = {},
): Promise<AccountSignInOption | null> {
  const base = normalizeEndpoint(origin, false);
  try {
    const response = await (dependencies.fetcher ?? httpFetch)(
      `${base}${SIGN_IN_PATH}`,
      {
        headers: { accept: 'application/json' },
        redirect: 'error',
        signal: signal ?? null,
      },
    );
    if (response.status !== 200) return null;
    const body: unknown = JSON.parse(await boundedText(response));
    if (typeof body !== 'object' || body === null) return null;
    const { schema, provider } = body as Record<string, unknown>;
    if (
      schema !== SCHEMA ||
      typeof provider !== 'string' ||
      provider.length === 0 ||
      provider.length > 40
    ) {
      return null;
    }
    return { provider };
  } catch {
    // Sign-in is optional: a server without it still pairs by invite.
    return null;
  }
}

/** Prepare one sign-in attempt. Nothing is sent until the URL is opened. */
export async function beginAccountSignIn(
  origin: string,
  dependencies: AccountSignInDependencies = {},
): Promise<AccountSignInAttempt> {
  const base = normalizeEndpoint(origin, false);
  const verifier = base64Url(
    (dependencies.randomBytes ?? Crypto.getRandomBytes)(32),
  );
  const challenge = base64Url(
    await (dependencies.sha256 ?? defaultSha256)(verifier),
  );
  return {
    origin: base,
    verifier,
    startedAt: (dependencies.now ?? Date.now)(),
    url: `${base}${SIGN_IN_PATH}/start?challenge=${challenge}`,
  };
}

/** The grant in a return link, or null when it is not a well-formed one. */
export function signInGrant(value: unknown): string | null {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
    ? value
    : null;
}

/**
 * Trade the returned grant for the one-time pairing offer, as the canonical
 * text the invite decoder already accepts.
 */
export async function redeemAccountSignIn(
  attempt: AccountSignInAttempt,
  grant: string,
  signal?: AbortSignal,
  dependencies: AccountSignInDependencies = {},
): Promise<string> {
  if ((dependencies.now ?? Date.now)() - attempt.startedAt > ATTEMPT_TTL_MS) {
    throw new Error('account_signin_expired');
  }
  const send = () =>
    (dependencies.fetcher ?? httpFetch)(
      `${attempt.origin}${SIGN_IN_PATH}/redeem`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ grant, verifier: attempt.verifier }),
        redirect: 'error',
        signal: signal ?? null,
      },
    );
  let response: Response | undefined;
  // A request that failed to send is repeated. If one did reach the server
  // and only its answer was lost, the grant is spent and the repeat is
  // refused, which is the safe outcome.
  for (let tries = 0; response === undefined; tries += 1) {
    try {
      response = await send();
    } catch (error) {
      const delay = REDEEM_RETRY_DELAYS_MS[tries];
      if (delay === undefined || signal?.aborted === true) {
        throw new Error('account_signin_unreachable', { cause: error });
      }
      await (dependencies.wait ?? defaultWait)(delay);
    }
  }
  if (response.status !== 201) throw new Error('account_signin_refused');
  return boundedText(response);
}

let pending: AccountSignInAttempt | null = null;

/** Remember the attempt the browser was opened for; a new one replaces it. */
export function holdAccountSignIn(attempt: AccountSignInAttempt | null): void {
  pending = attempt;
}

/** The attempt in progress, taken so a return link is honoured once. */
export function takeAccountSignIn(): AccountSignInAttempt | null {
  const attempt = pending;
  pending = null;
  return attempt;
}

export function describeAccountSignInError(error: unknown): string {
  switch (error instanceof Error ? error.message : '') {
    case 'account_signin_not_started':
      return 'This sign-in was not started from this app, or the app was restarted meanwhile. Start again from the connection screen.';
    case 'account_signin_expired':
      return 'This sign-in took too long. Start again from the connection screen.';
    case 'account_signin_refused':
      return 'The server did not accept this sign-in. It may have expired or already been used. Start again from the connection screen.';
    case 'account_signin_unreachable':
      return 'The server could not be reached. Check your internet connection, then start again.';
    default:
      return 'The sign-in could not be completed. Start again from the connection screen.';
  }
}
