// SPDX-License-Identifier: Elastic-2.0

import { MobileLifecycleError } from '@automonique/sdk';

import {
  decodePairingOfferText,
  describePairingError,
  MAX_PAIRING_OFFER_BYTES,
} from './pairing-offer';

const IDENTITY = `sha256:${'a'.repeat(64)}`;

test.each([
  ['mobile_pairing_expired', 'expired'],
  ['mobile_pairing_invalid', 'no longer available'],
  ['mobile_server_identity_mismatch', 'identity does not match'],
  ['mobile_protocol_unsupported', 'not compatible'],
  ['response_stream_unavailable', 'latest app version'],
  ['content_type_mismatch', 'reverse proxy'],
])('describes the SDK refusal category %s', (category, message) => {
  expect(
    describePairingError(new MobileLifecycleError(400, category)),
  ).toContain(message);
});
const OFFER = `{"exchange_endpoint":"https://ops.example.test/api/mobile/pairings/exchange","expires_at_ms":1777000300000,"origin":"https://ops.example.test","pairing_id":"pi_${'b'.repeat(43)}","pairing_token":"mp_${'c'.repeat(43)}","schema":"automonique.mobile-auth/v1","server_identity":"${IDENTITY}"}`;

test('decodes the exact bounded canonical operator offer', () => {
  expect(decodePairingOfferText(OFFER, 1_777_000_000_000)).toMatchObject({
    origin: 'https://ops.example.test',
    pairing_id: `pi_${'b'.repeat(43)}`,
    pairing_token: `mp_${'c'.repeat(43)}`,
    expires_at_ms: 1_777_000_300_000n,
    server_identity: IDENTITY,
  });
});

test.each([
  '',
  '{}',
  OFFER.replace('"schema":', '"extra":true,"schema":'),
  OFFER.replace('https://ops.example.test', 'http://ops.example.test'),
  `{"padding":"${'x'.repeat(MAX_PAIRING_OFFER_BYTES)}"}`,
])('refuses malformed, widened, insecure, or oversized offers', (value) => {
  expect(() => decodePairingOfferText(value)).toThrow(
    'mobile_pairing_offer_invalid',
  );
});

test('rejects an invite at its expiry boundary', () => {
  expect(() => decodePairingOfferText(OFFER, 1_777_000_300_000)).toThrow(
    'mobile_pairing_offer_expired',
  );
  expect(() => decodePairingOfferText(OFFER, 1_777_000_300_001)).toThrow(
    'mobile_pairing_offer_expired',
  );
});

test('unexpected failures never expose server details or invite secrets', () => {
  expect(
    describePairingError(new Error('private response body')),
  ).not.toContain('private response body');
  expect(
    describePairingError(new Error('mobile_protocol_unsupported')),
  ).toContain('Update the app');
});
