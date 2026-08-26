// SPDX-License-Identifier: Elastic-2.0

import { encode as encodeJpeg } from 'jpeg-js';
import QRCode from 'qrcode';

import { decodePairingQrJpeg } from './qr-image';

const OFFER = `{"schema":"automonique.mobile-auth/v1","pairing_id":"pi_${'a'.repeat(43)}"}`;

function qrJpegBase64(value: string): string {
  const qr = QRCode.create(value, { errorCorrectionLevel: 'M' });
  const quietModules = 4;
  const scale = 8;
  const moduleCount = qr.modules.size;
  const width = (moduleCount + quietModules * 2) * scale;
  const data = new Uint8Array(width * width * 4);

  for (let y = 0; y < width; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const moduleX = Math.floor(x / scale) - quietModules;
      const moduleY = Math.floor(y / scale) - quietModules;
      const dark =
        moduleX >= 0 &&
        moduleX < moduleCount &&
        moduleY >= 0 &&
        moduleY < moduleCount &&
        qr.modules.get(moduleY, moduleX);
      const offset = (y * width + x) * 4;
      const channel = dark ? 0 : 255;
      data[offset] = channel;
      data[offset + 1] = channel;
      data[offset + 2] = channel;
      data[offset + 3] = 255;
    }
  }

  return Buffer.from(
    encodeJpeg({ data, width, height: width }, 90).data,
  ).toString('base64');
}

test('decodes a pairing payload from a bounded JPEG capture', () => {
  expect(decodePairingQrJpeg(qrJpegBase64(OFFER))).toBe(OFFER);
});

test('rejects an image with no QR payload', () => {
  const data = new Uint8Array(64 * 64 * 4).fill(255);
  const base64 = Buffer.from(
    encodeJpeg({ data, width: 64, height: 64 }, 90).data,
  ).toString('base64');
  expect(() => decodePairingQrJpeg(base64)).toThrow(
    'mobile_pairing_qr_not_found',
  );
});

test('rejects malformed image input', () => {
  expect(() => decodePairingQrJpeg('not-base64')).toThrow(
    'mobile_pairing_qr_image_invalid',
  );
});
