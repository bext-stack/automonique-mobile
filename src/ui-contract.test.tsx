// SPDX-License-Identifier: Elastic-2.0

import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import ApprovalsScreen from './app/approvals';
import SessionScreen from './app/session/[id]';
import SettingsScreen from './app/settings';
import { ConnectionBanner } from './components/connection-banner';
import { ReceiptCard } from './components/receipt-card';
import { syntheticSnapshot } from '@/core/fixtures';
import { decimalRevision } from '@/core/types';

const mockUseMobile = jest.fn();

jest.mock('@/providers/mobile-provider', () => ({
  useMobile: () => mockUseMobile(),
}));

jest.mock('expo-router', () => ({
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
    sendFollowUp: jest.fn(),
    decideApproval: jest.fn(),
    stopRun: jest.fn(),
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

test('shared connection status distinguishes an SDK transport', async () => {
  mockUseMobile.mockReturnValue(mobileValue(['attach'], { synthetic: false }));
  const view = await render(<ConnectionBanner />);
  expect(view.getByText('Live · SDK')).toBeTruthy();
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
