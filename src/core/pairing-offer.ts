// SPDX-License-Identifier: Elastic-2.0

import {
  decodeMobilePairingOffer,
  parseCanonical,
  type MobilePairingOffer,
} from '@automonique/sdk';

export const MAX_PAIRING_OFFER_BYTES = 8 * 1024;

/** Decode the exact canonical JSON copied from the operator pairing endpoint. */
export function decodePairingOfferText(value: string): MobilePairingOffer {
  const bytes = new TextEncoder().encode(value.trim());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_PAIRING_OFFER_BYTES) {
    throw new Error('mobile_pairing_offer_invalid');
  }
  try {
    return decodeMobilePairingOffer(parseCanonical(bytes));
  } catch (error) {
    throw new Error('mobile_pairing_offer_invalid', { cause: error });
  }
}
