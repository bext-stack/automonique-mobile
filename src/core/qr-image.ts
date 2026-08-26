// SPDX-License-Identifier: Elastic-2.0

import { toByteArray } from 'base64-js';
import { decode as decodeJpeg } from 'jpeg-js';
import jsQR from 'jsqr';

import { MAX_PAIRING_OFFER_BYTES } from './pairing-offer';

const MAX_JPEG_BASE64_CHARS = 16 * 1024 * 1024;
const MAX_JPEG_MEGAPIXELS = 3;
const MAX_JPEG_MEMORY_MB = 64;

/** Decode one bounded, in-memory camera capture without a remote scanner. */
export function decodePairingQrJpeg(base64: string): string {
  if (base64.length === 0 || base64.length > MAX_JPEG_BASE64_CHARS) {
    throw new Error('mobile_pairing_qr_image_invalid');
  }

  let bytes: Uint8Array;
  try {
    bytes = toByteArray(base64);
  } catch (error) {
    throw new Error('mobile_pairing_qr_image_invalid', { cause: error });
  }

  let image: {
    readonly width: number;
    readonly height: number;
    readonly data: Uint8Array;
  };
  try {
    image = decodeJpeg(bytes, {
      useTArray: true,
      formatAsRGBA: true,
      tolerantDecoding: false,
      maxResolutionInMP: MAX_JPEG_MEGAPIXELS,
      maxMemoryUsageInMB: MAX_JPEG_MEMORY_MB,
    });
  } catch (error) {
    throw new Error('mobile_pairing_qr_image_invalid', { cause: error });
  }

  if (
    image.width <= 0 ||
    image.height <= 0 ||
    image.data.length !== image.width * image.height * 4
  ) {
    throw new Error('mobile_pairing_qr_image_invalid');
  }

  const result = jsQR(
    Uint8ClampedArray.from(image.data),
    image.width,
    image.height,
    { inversionAttempts: 'attemptBoth' },
  );
  if (
    result === null ||
    result.data.length === 0 ||
    result.data.length > MAX_PAIRING_OFFER_BYTES
  ) {
    throw new Error('mobile_pairing_qr_not_found');
  }
  return result.data;
}
