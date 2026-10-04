// SPDX-License-Identifier: Elastic-2.0
import { requireOptionalNativeModule } from 'expo';

interface NativePairingScanner {
  scanAsync(): Promise<string | null>;
  dismissAsync(): Promise<void>;
}

const scanner =
  requireOptionalNativeModule<NativePairingScanner>('PairingScanner');

export async function scanPairingQr(): Promise<string | null> {
  if (scanner === null) throw new Error('pairing_scanner_unavailable');
  return scanner.scanAsync();
}

export async function dismissPairingScanner(): Promise<void> {
  await scanner?.dismissAsync();
}
