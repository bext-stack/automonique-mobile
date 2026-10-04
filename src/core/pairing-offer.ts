// SPDX-License-Identifier: Elastic-2.0

import {
  decodeMobilePairingOffer,
  MobileLifecycleError,
  parseCanonical,
  type MobilePairingOffer,
} from '@automonique/sdk';

export const MAX_PAIRING_OFFER_BYTES = 8 * 1024;

/** Decode the exact canonical JSON copied from the operator pairing endpoint. */
export function decodePairingOfferText(
  value: string,
  now = Date.now(),
): MobilePairingOffer {
  const bytes = new TextEncoder().encode(value.trim());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_PAIRING_OFFER_BYTES) {
    throw new Error('mobile_pairing_offer_invalid');
  }
  let offer: MobilePairingOffer;
  try {
    offer = decodeMobilePairingOffer(parseCanonical(bytes));
  } catch (error) {
    throw new Error('mobile_pairing_offer_invalid', { cause: error });
  }
  assertPairingOfferCurrent(offer, now);
  return offer;
}

export function assertPairingOfferCurrent(
  offer: MobilePairingOffer,
  now = Date.now(),
): void {
  if (offer.expires_at_ms <= BigInt(now))
    throw new Error('mobile_pairing_offer_expired');
}

export function describePairingError(error: unknown): string {
  const category =
    error instanceof MobileLifecycleError
      ? error.category
      : error instanceof Error
        ? error.message
        : '';
  switch (category) {
    case 'mobile_pairing_offer_expired':
    case 'mobile_pairing_expired':
      return 'This invite has expired. Create a new QR code in Monique, then scan or import it again.';
    case 'mobile_pairing_offer_invalid':
    case 'mobile_pairing_lifetime_invalid':
      return 'This is not a valid Monique invite. Scan the pairing QR code or paste the complete invite copied from Monique.';
    case 'mobile_server_identity_mismatch':
      return 'The server identity does not match this invite. Check the server address and create a new invite from that server.';
    case 'mobile_protocol_unsupported':
    case 'mobile_auth_protocol_mismatch':
    case 'mobile_auth_schema_mismatch':
    case 'mobile_discovery_mismatch':
    case 'mobile_pairing_discovery_mismatch':
      return 'This server and app version are not compatible. Update the app or ask your administrator to update Monique.';
    case 'mobile_auth_unauthorized':
    case 'mobile_pairing_invalid':
      return 'This invite is no longer available. It may have expired or already been used. Create a new invite in Monique.';
    case 'response_stream_unavailable':
      return 'This app could not read the server response. Install the latest app version and try again.';
    case 'content_type_mismatch':
    case 'cache_control_mismatch':
    case 'response_url_mismatch':
      return 'The server answered with an unexpected response. Ask your administrator to check the mobile API and reverse proxy.';
    case 'secure_store_unavailable':
      return 'This device could not store the connection securely. Restart the app and create a new invite before trying again.';
    default:
      return 'Could not connect to Monique. Check your internet connection and server address, then try a new invite.';
  }
}
