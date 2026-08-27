// SPDX-License-Identifier: Elastic-2.0

import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import ActivityScreen from './app/(tabs)/activity';
import ApprovalsScreen from './app/(tabs)/approvals';
import OverviewScreen from './app/(tabs)/index';
import SessionsScreen from './app/(tabs)/sessions';
import SessionScreen from './app/session/[id]';
import SettingsScreen from './app/settings';
import { ConnectionBanner } from './components/connection-banner';
import { ReceiptCard } from './components/receipt-card';
import { syntheticSnapshot } from '@/core/fixtures';
import { decimalRevision } from '@/core/types';
import {
  useVoiceDictationEvent,
  VoiceDictationModule,
} from '@/core/voice-dictation';

jest.mock('expo-speech-recognition', () => ({
  ExpoSpeechRecognitionModule: {
    abort: jest.fn(),
    requestPermissionsAsync: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
    supportsOnDeviceRecognition: jest.fn(),
  },
  useSpeechRecognitionEvent: jest.fn(),
}));

const mockUseMobile = jest.fn();
const mockPair = jest.fn();
const mockInspectAutomoniqueServer = jest.fn();
const mockSpeechStart = jest
  .spyOn(VoiceDictationModule, 'start')
  .mockImplementation(() => undefined);
jest.spyOn(VoiceDictationModule, 'stop').mockImplementation(() => undefined);
jest.spyOn(VoiceDictationModule, 'abort').mockImplementation(() => undefined);
jest
  .spyOn(VoiceDictationModule, 'requestPermissionsAsync')
  .mockResolvedValue({ granted: true, canAskAgain: true } as never);
jest
  .spyOn(VoiceDictationModule, 'supportsOnDeviceRecognition')
  .mockReturnValue(true);

jest.mock('@/providers/mobile-provider', () => ({
  useMobile: () => mockUseMobile(),
}));
jest.mock('@/providers/production-mobile-provider', () => ({
  useMobileLifecycle: () => ({
    state: { phase: 'unpaired', profile: null },
    refreshCredential: jest.fn(),
    revokeCredential: jest.fn(),
    pair: mockPair,
  }),
}));
jest.mock('@/core/server-connection', () => ({
  ...jest.requireActual('@/core/server-connection'),
  inspectAutomoniqueServer: (...args: unknown[]) =>
    mockInspectAutomoniqueServer(...args),
}));

jest.mock('expo-router', () => ({
  Link: ({ children }: { readonly children: ReactNode }) => children,
  useLocalSearchParams: () => ({ id: 'session-synthetic-001' }),
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
  },
}));

function mobileValue(
  allowedActions: typeof syntheticSnapshot.connection.allowedActions,
  options?: {
    readonly maxFollowUpBytes?: number;
    readonly approvalExpiresAt?: string;
    readonly synthetic?: boolean;
  },
) {
  return {
    storageScope: null,
    snapshot: {
      ...syntheticSnapshot,
      connection: {
        ...syntheticSnapshot.connection,
        synthetic: options?.synthetic ?? true,
        allowedActions,
        limits: {
          ...syntheticSnapshot.connection.limits,
          maxFollowUpBytes:
            options?.maxFollowUpBytes ??
            syntheticSnapshot.connection.limits.maxFollowUpBytes,
        },
      },
      approvals: syntheticSnapshot.approvals.map((approval) => ({
        ...approval,
        expiresAt: options?.approvalExpiresAt ?? '2999-01-01T00:00:00Z',
      })),
    },
    busyAction: null,
    projectionReady: true,
    sendFollowUp: jest.fn(),
    decideApproval: jest.fn(),
    stopRun: jest.fn(),
    refreshProjection: jest.fn(),
    setConnectionPhase: jest.fn(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('stop-run authorization is independent from follow-up authorization', async () => {
  mockUseMobile.mockReturnValue(mobileValue(['stop_run']));
  const view = await render(<SessionScreen />);

  expect(view.getByLabelText('Follow-up message').props.editable).toBe(false);
  expect(view.getByLabelText('Stop exact run run-synthetic-001')).toBeEnabled();
});

test('follow-up uses the negotiated UTF-8 byte limit', async () => {
  mockUseMobile.mockReturnValue(
    mobileValue(['follow_up'], { maxFollowUpBytes: 4 }),
  );
  const view = await render(<SessionScreen />);

  await fireEvent.changeText(view.getByLabelText('Follow-up message'), 'ééé');

  expect(view.getByText('6 / 4 bytes · too long')).toBeTruthy();
  expect(view.getByLabelText('Send follow-up')).toBeDisabled();
  await waitFor(() =>
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(
      'automonique.mobile.draft.v1:session-synthetic-001',
    ),
  );
});

test('voice dictation stays on-device and fills the reviewable draft', async () => {
  mockUseMobile.mockReturnValue(mobileValue(['follow_up']));
  const view = await render(<SessionScreen />);

  await fireEvent.press(view.getByLabelText('Start voice dictation'));
  await waitFor(() =>
    expect(mockSpeechStart).toHaveBeenCalledWith(
      expect.objectContaining({
        interimResults: true,
        requiresOnDeviceRecognition: true,
      }),
    ),
  );
  const resultCall = jest
    .mocked(useVoiceDictationEvent)
    .mock.calls.find(([event]) => event === 'result');
  const resultListener = resultCall?.[1] as
    ((event: never) => void) | undefined;
  await act(() => {
    resultListener?.({
      isFinal: true,
      results: [{ transcript: 'Check the deployment status' }],
    } as never);
  });

  expect(view.getByLabelText('Follow-up message').props.value).toBe(
    'Check the deployment status',
  );
  expect(
    view.getByText('Dictation ready. Review or edit it before sending.'),
  ).toBeTruthy();
});

test('a bounded persisted draft restores without an initial blank overwrite', async () => {
  jest.mocked(AsyncStorage.getItem).mockResolvedValueOnce('Saved draft');
  mockUseMobile.mockReturnValue(mobileValue(['follow_up']));

  const view = await render(<SessionScreen />);

  await waitFor(() =>
    expect(view.getByLabelText('Follow-up message').props.value).toBe(
      'Saved draft',
    ),
  );
  expect(AsyncStorage.setItem).not.toHaveBeenCalledWith(
    'automonique.mobile.draft.v1:session-synthetic-001',
    '',
  );
});

test.each(['rejected', 'conflict', 'resync_required'] as const)(
  'a %s follow-up refusal preserves the reviewable draft',
  async (outcome) => {
    const value = mobileValue(['follow_up']);
    value.sendFollowUp.mockResolvedValue({
      id: null,
      idempotencyKey: 'draft-refusal',
      action: 'follow_up',
      target: syntheticSnapshot.sessions[0]!.target.coordinate,
      revision: syntheticSnapshot.sessions[0]!.target.revision,
      outcome,
      explanation: 'refresh required',
    });
    mockUseMobile.mockReturnValue(value);
    const view = await render(<SessionScreen />);
    await waitFor(() =>
      expect(view.getByLabelText('Follow-up message').props.value).toBe(''),
    );
    await fireEvent.changeText(
      view.getByLabelText('Follow-up message'),
      'Keep this draft',
    );

    await fireEvent.press(view.getByLabelText('Send follow-up'));

    await waitFor(() => expect(value.sendFollowUp).toHaveBeenCalledTimes(1));
    expect(view.getByLabelText('Follow-up message').props.value).toBe(
      'Keep this draft',
    );
    expect(AsyncStorage.removeItem).not.toHaveBeenCalledWith(
      'automonique.mobile.draft.v1:session-synthetic-001',
    );
  },
);

test('an oversized persisted draft is removed instead of restored', async () => {
  jest.mocked(AsyncStorage.getItem).mockResolvedValueOnce('ééé');
  mockUseMobile.mockReturnValue(
    mobileValue(['follow_up'], { maxFollowUpBytes: 4 }),
  );

  const view = await render(<SessionScreen />);

  await waitFor(() =>
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(
      'automonique.mobile.draft.v1:session-synthetic-001',
    ),
  );
  expect(view.getByLabelText('Follow-up message').props.value).toBe('');
});

test('approval decisions require their own negotiated action', async () => {
  mockUseMobile.mockReturnValue(mobileValue(['follow_up']));
  const view = await render(<ApprovalsScreen />);
  expect(
    view.getByLabelText('grant Publish the preview build at revision 3'),
  ).toBeDisabled();
});

test('overview exposes real attention and authorized workload counts', async () => {
  mockUseMobile.mockReturnValue(mobileValue(['attach']));
  const view = await render(<OverviewScreen />);

  expect(view.getByText('Your Automonique')).toBeTruthy();
  expect(view.getByLabelText('Active: 2')).toBeTruthy();
  expect(view.getByLabelText('Approvals: 1')).toBeTruthy();
  expect(view.getByText('Review 1 pending approval')).toBeTruthy();
});

test('sessions can be filtered without changing server scope', async () => {
  mockUseMobile.mockReturnValue(mobileValue(['attach']));
  const view = await render(<SessionsScreen />);

  expect(view.getByText('2 authorized · 2 shown')).toBeTruthy();
  await fireEvent.press(view.getByRole('tab', { name: /completed/i }));
  expect(view.getByText('2 authorized · 0 shown')).toBeTruthy();
  expect(view.getByText('No completed sessions')).toBeTruthy();
});

test('activity separates sanitized events from durable receipts', async () => {
  mockUseMobile.mockReturnValue(mobileValue(['attach']));
  const view = await render(<ActivityScreen />);

  expect(view.getByText('Session timeline')).toBeTruthy();
  expect(view.getByText('Automonique message')).toBeTruthy();
  await fireEvent.press(view.getByRole('tab', { name: /receipts/i }));
  expect(view.queryByText('Session timeline')).toBeNull();
});

test('expired approvals remain disabled even when the action is authorized', async () => {
  mockUseMobile.mockReturnValue(
    mobileValue(['decide_approval'], {
      approvalExpiresAt: '2000-01-01T00:00:00Z',
    }),
  );
  const view = await render(<ApprovalsScreen />);
  expect(
    view.getByLabelText('grant Publish the preview build at revision 3'),
  ).toBeDisabled();
});

test('settings renders protocol identity imported from the vendored SDK', async () => {
  mockUseMobile.mockReturnValue(mobileValue(['attach'], { synthetic: false }));
  const view = await render(<SettingsScreen />);

  expect(view.getByText('Live @automonique/sdk transport')).toBeTruthy();
  expect(view.getByText('automonique.platform/v1 · protocol v1')).toBeTruthy();
  expect(view.getByText('automonique.platform')).toBeTruthy();
  expect(AsyncStorage.getItem).toHaveBeenCalled();
});

test('an oversized endpoint draft is removed before display', async () => {
  jest
    .mocked(AsyncStorage.getItem)
    .mockResolvedValueOnce(`https://example.test/${'a'.repeat(2_048)}`);
  mockUseMobile.mockReturnValue(mobileValue(['attach']));

  const view = await render(<SettingsScreen />);

  await waitFor(() =>
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(
      'automonique.mobile.endpoint-draft.v1',
    ),
  );
  expect(view.getByLabelText('Automonique HTTPS endpoint').props.value).toBe(
    'https://',
  );
});

test('checks an existing server before asking for a pairing invite', async () => {
  mockUseMobile.mockReturnValue(mobileValue(['attach']));
  mockInspectAutomoniqueServer.mockResolvedValue({
    origin: 'https://ops.example.test',
    platformEndpoint: 'https://ops.example.test/api/platform',
    protocolVersion: '1',
    serverIdentity: `sha256:${'a'.repeat(64)}`,
  });
  const view = await render(<SettingsScreen />);

  await fireEvent.changeText(
    view.getByLabelText('Automonique HTTPS endpoint'),
    'https://ops.example.test',
  );
  await fireEvent.press(view.getByText('Check this server'));

  await waitFor(() =>
    expect(view.getByText('Compatible Automonique server')).toBeTruthy(),
  );
  expect(mockInspectAutomoniqueServer).toHaveBeenCalledWith(
    'https://ops.example.test',
    expect.any(AbortSignal),
  );
  expect(AsyncStorage.setItem).toHaveBeenCalledWith(
    'automonique.mobile.endpoint-draft.v1',
    'https://ops.example.test',
  );
});

test('reviews a one-time invite before exchanging it', async () => {
  mockUseMobile.mockReturnValue(mobileValue(['attach']));
  const identity = `sha256:${'a'.repeat(64)}`;
  const offer = `{"exchange_endpoint":"https://ops.example.test/api/mobile/pairings/exchange","expires_at_ms":32472144000000,"origin":"https://ops.example.test","pairing_id":"pi_${'b'.repeat(43)}","pairing_token":"mp_${'c'.repeat(43)}","schema":"automonique.mobile-auth/v1","server_identity":"${identity}"}`;
  const view = await render(<SettingsScreen />);

  await fireEvent.changeText(
    view.getByLabelText('One-time pairing offer'),
    offer,
  );
  await fireEvent.press(view.getByText('Review pasted invite'));

  expect(view.getByLabelText('Pairing invite confirmation')).toBeTruthy();
  expect(view.getByText('Connect to https://ops.example.test?')).toBeTruthy();
  expect(mockPair).not.toHaveBeenCalled();

  await fireEvent.press(view.getByText('Connect this server'));
  await waitFor(() => expect(mockPair).toHaveBeenCalledTimes(1));
  expect(mockPair.mock.calls[0]?.[0]).toMatchObject({
    origin: 'https://ops.example.test',
    server_identity: identity,
  });
});

test('shared connection status distinguishes an SDK transport', async () => {
  mockUseMobile.mockReturnValue(mobileValue(['attach'], { synthetic: false }));
  const view = await render(<ConnectionBanner />);
  expect(view.getByText('Live · SDK')).toBeTruthy();
});

test('initial hydration does not expose a competing reconnect operation', async () => {
  const value = mobileValue(['attach']);
  mockUseMobile.mockReturnValue({
    ...value,
    projectionReady: false,
    snapshot: {
      ...value.snapshot,
      connection: {
        ...value.snapshot.connection,
        phase: 'stale',
        mutationsAllowed: false,
      },
    },
  });
  const view = await render(<ConnectionBanner />);

  expect(view.queryByLabelText('Reconnect and refresh projection')).toBeNull();
});

test('a refusal without a receipt id remains visibly reconcilable', async () => {
  const view = await render(
    <ReceiptCard
      receipt={{
        id: null,
        idempotencyKey: 'pending-key',
        action: 'follow_up',
        target: syntheticSnapshot.sessions[0]!.target.coordinate,
        revision: decimalRevision('12'),
        outcome: 'rejected',
        explanation: 'policy denied',
      }}
    />,
  );
  expect(view.getByText('pending · pending-key')).toBeTruthy();
});
