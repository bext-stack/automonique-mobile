// SPDX-License-Identifier: Elastic-2.0

import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { manipulateAsync } from 'expo-image-manipulator';
import {
  launchCameraAsync,
  launchImageLibraryAsync,
  requestCameraPermissionsAsync,
} from 'expo-image-picker';
import { decodePairingQrJpeg } from '@/core/qr-image';
import { PairingScanner } from './pairing-scanner';

jest.mock('expo-image-picker', () => ({
  launchCameraAsync: jest.fn(),
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
  await fireEvent.press(view.getByText('Open camera'));
  await waitFor(() =>
    expect(view.getByText(/Camera access is disabled/)).toBeTruthy(),
  );
  expect(launchCameraAsync).not.toHaveBeenCalled();
  await fireEvent.press(view.getByText('Import QR image'));
  await waitFor(() => expect(onScan).toHaveBeenCalledTimes(1));
});
