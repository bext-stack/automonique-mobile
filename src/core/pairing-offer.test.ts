// SPDX-License-Identifier: Elastic-2.0

import {
  decodePairingOfferText,
  MAX_PAIRING_OFFER_BYTES,
} from './pairing-offer';

const IDENTITY = `sha256:${'a'.repeat(64)}`;
const OFFER = `{"exchange_endpoint":"https://ops.example.test/api/mobile/pairings/exchange","expires_at_ms":1777000300000,"origin":"https://ops.example.test","pairing_id":"pi_${'b'.repeat(43)}","pairing_token":"mp_${'c'.repeat(43)}","schema":"automonique.mobile-auth/v1","server_identity":"${IDENTITY}"}`;

test('decodes the exact bounded canonical operator offer', () => {
  expect(decodePairingOfferText(OFFER)).toMatchObject({
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
