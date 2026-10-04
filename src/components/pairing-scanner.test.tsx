// SPDX-License-Identifier: Elastic-2.0

import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { manipulateAsync } from 'expo-image-manipulator';
import {
  launchImageLibraryAsync,
  requestCameraPermissionsAsync,
} from 'expo-image-picker';
import { decodePairingQrJpeg } from '@/core/qr-image';
import { PairingScanner } from './pairing-scanner';
import {
  scanPairingQr,
  dismissPairingScanner,
} from '@/core/native-pairing-scanner';
import { MAX_PAIRING_OFFER_BYTES } from '@/core/pairing-offer';

jest.mock('@/core/native-pairing-scanner', () => ({
  scanPairingQr: jest.fn(),
  dismissPairingScanner: jest.fn(),
}));

jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(),
}));
jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: 'jpeg' },
}));
jest.mock('@/core/qr-image', () => ({ decodePairingQrJpeg: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView:
    jest.requireActual<typeof import('react-native')>('react-native').View,
}));

const picked = {
  canceled: false,
  assets: [{ uri: 'file:///qr.png', width: 1000, height: 1000 }],
};
beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(dismissPairingScanner).mockResolvedValue();
  jest.mocked(scanPairingQr).mockResolvedValue('live-one-time-invite');
  jest
    .mocked(requestCameraPermissionsAsync)
    .mockResolvedValue({ granted: true } as never);
  jest.mocked(launchImageLibraryAsync).mockResolvedValue(picked as never);
  jest
    .mocked(manipulateAsync)
    .mockResolvedValue({ base64: 'jpeg-payload' } as never);
  jest.mocked(decodePairingQrJpeg).mockReturnValue('one-time-invite');
});

test('imports a downloaded QR image without requesting camera permission', async () => {
  const onScan = jest.fn();
  const view = await render(
    <PairingScanner visible onCancel={jest.fn()} onScan={onScan} />,
  );
  await fireEvent.press(view.getByText('Import QR image'));
  await waitFor(() => expect(onScan).toHaveBeenCalledWith('one-time-invite'));
  expect(requestCameraPermissionsAsync).not.toHaveBeenCalled();
  expect(manipulateAsync).toHaveBeenCalledWith(
    'file:///qr.png',
    [],
    expect.objectContaining({ base64: true, format: 'jpeg' }),
  );
});

test('a canceled picker does not decode or connect', async () => {
  jest
    .mocked(launchImageLibraryAsync)
    .mockResolvedValue({ canceled: true, assets: null });
  const onScan = jest.fn();
  const view = await render(
    <PairingScanner visible onCancel={jest.fn()} onScan={onScan} />,
  );
  await fireEvent.press(view.getByText('Import QR image'));
  await waitFor(() =>
    expect(view.getByText(/Selection canceled/)).toBeTruthy(),
  );
  expect(manipulateAsync).not.toHaveBeenCalled();
  expect(onScan).not.toHaveBeenCalled();
});

test('closing the scanner fences a late image-picker result', async () => {
  let finish!: (value: never) => void;
  jest.mocked(launchImageLibraryAsync).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const onScan = jest.fn();
  const onCancel = jest.fn();
  const view = await render(
    <PairingScanner visible onCancel={onCancel} onScan={onScan} />,
  );
  await fireEvent.press(view.getByText('Import QR image'));
  await fireEvent.press(view.getByText('Cancel'));
  await act(async () => finish(picked as never));
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onScan).not.toHaveBeenCalled();
  expect(manipulateAsync).not.toHaveBeenCalled();
});

test('denied camera access still permits image import', async () => {
  jest
    .mocked(requestCameraPermissionsAsync)
    .mockResolvedValue({ granted: false, canAskAgain: false } as never);
  const onScan = jest.fn();
  const view = await render(
    <PairingScanner visible onCancel={jest.fn()} onScan={onScan} />,
  );
  await fireEvent.press(view.getByText('Scan with camera'));
  await waitFor(() =>
    expect(view.getByText(/Camera access is disabled/)).toBeTruthy(),
  );
  expect(scanPairingQr).not.toHaveBeenCalled();
  await fireEvent.press(view.getByText('Import QR image'));
  await waitFor(() => expect(onScan).toHaveBeenCalledTimes(1));
});

test('live scanning returns the native result without taking or decoding a photo', async () => {
  const onScan = jest.fn();
  const view = await render(
    <PairingScanner visible onCancel={jest.fn()} onScan={onScan} />,
  );
  await fireEvent.press(view.getByText('Scan with camera'));
  await waitFor(() =>
    expect(onScan).toHaveBeenCalledWith('live-one-time-invite'),
  );
  expect(scanPairingQr).toHaveBeenCalledTimes(1);
  expect(manipulateAsync).not.toHaveBeenCalled();
  expect(decodePairingQrJpeg).not.toHaveBeenCalled();
  expect(launchImageLibraryAsync).not.toHaveBeenCalled();
});

test('native cancellation unlocks scanning for a retry', async () => {
  jest.mocked(scanPairingQr).mockResolvedValueOnce(null);
  const onScan = jest.fn();
  const view = await render(
    <PairingScanner visible onCancel={jest.fn()} onScan={onScan} />,
  );
  await fireEvent.press(view.getByText('Scan with camera'));
  await waitFor(() => expect(view.getByText(/Scanning stopped/)).toBeTruthy());
  expect(onScan).not.toHaveBeenCalled();
  await fireEvent.press(view.getByText('Scan with camera'));
  await waitFor(() => expect(onScan).toHaveBeenCalledTimes(1));
});

test('unavailable native scanner leaves import usable', async () => {
  jest.mocked(scanPairingQr).mockRejectedValue(new Error('unavailable'));
  const onScan = jest.fn();
  const view = await render(
    <PairingScanner visible onCancel={jest.fn()} onScan={onScan} />,
  );
  await fireEvent.press(view.getByText('Scan with camera'));
  await waitFor(() =>
    expect(view.getByText(/Live scanning is unavailable/)).toBeTruthy(),
  );
  expect(onScan).not.toHaveBeenCalled();
  await fireEvent.press(view.getByText('Import QR image'));
  await waitFor(() => expect(onScan).toHaveBeenCalledWith('one-time-invite'));
});

test('cancel dismisses the native scanner and ignores its late result', async () => {
  let finish!: (value: string) => void;
  jest.mocked(scanPairingQr).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const onScan = jest.fn();
  const onCancel = jest.fn();
  const view = await render(
    <PairingScanner visible onCancel={onCancel} onScan={onScan} />,
  );
  await fireEvent.press(view.getByText('Scan with camera'));
  await waitFor(() => expect(scanPairingQr).toHaveBeenCalledTimes(1));
  await fireEvent.press(view.getByText('Cancel'));
  await act(async () => finish('late-invite'));
  expect(dismissPairingScanner).toHaveBeenCalled();
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onScan).not.toHaveBeenCalled();
});

test('closing while permission is pending never launches the scanner', async () => {
  let finish!: (value: never) => void;
  jest.mocked(requestCameraPermissionsAsync).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const onScan = jest.fn();
  const view = await render(
    <PairingScanner visible onCancel={jest.fn()} onScan={onScan} />,
  );
  await fireEvent.press(view.getByText('Scan with camera'));
  await fireEvent.press(view.getByText('Cancel'));
  await act(async () => finish({ granted: true } as never));
  expect(scanPairingQr).not.toHaveBeenCalled();
  expect(onScan).not.toHaveBeenCalled();
});

test.each(['', 'x'.repeat(MAX_PAIRING_OFFER_BYTES + 1)])(
  'invalid native results are rejected',
  async (result) => {
    jest.mocked(scanPairingQr).mockResolvedValue(result);
    const onScan = jest.fn();
    const view = await render(
      <PairingScanner visible onCancel={jest.fn()} onScan={onScan} />,
    );
    await fireEvent.press(view.getByText('Scan with camera'));
    await waitFor(() =>
      expect(view.getByText(/Live scanning is unavailable/)).toBeTruthy(),
    );
    expect(onScan).not.toHaveBeenCalled();
  },
);

test('hiding the scanner ignores an outstanding native result', async () => {
  let finish!: (value: string) => void;
  jest.mocked(scanPairingQr).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const onScan = jest.fn();
  const onCancel = jest.fn();
  const view = await render(
    <PairingScanner visible onCancel={onCancel} onScan={onScan} />,
  );
  await fireEvent.press(view.getByText('Scan with camera'));
  await waitFor(() => expect(scanPairingQr).toHaveBeenCalledTimes(1));
  await view.rerender(
    <PairingScanner visible={false} onCancel={onCancel} onScan={onScan} />,
  );
  await act(async () => finish('late-invite'));
  expect(dismissPairingScanner).toHaveBeenCalled();
  expect(onScan).not.toHaveBeenCalled();
});
