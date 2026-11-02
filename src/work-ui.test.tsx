// SPDX-License-Identifier: Elastic-2.0
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PropsWithChildren } from 'react';
import { MobileLifecycleError, type MobileWorkRequest } from '@automonique/sdk';
import WorkScreen from './app/(tabs)/work';
import { syntheticSnapshot } from './core/fixtures';

jest.mock('expo-router', () => ({ useFocusEffect: jest.fn() }));
const mockMobile = jest.fn();
jest.mock('@/providers/mobile-provider', () => ({
  useMobile: () => mockMobile(),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'fixture-key' }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));
jest.mock('@/components/screen', () => ({
  Screen: ({ children }: PropsWithChildren) => {
    const { View } =
      jest.requireActual<typeof import('react-native')>('react-native');
    return <View>{children}</View>;
  },
}));
const ticket = {
  job_id: 'job-a',
  source_key: 'slack:fixture',
  issue_url: 'https://github.com/example/repo/issues/1',
  issue_title: 'Fixture ticket',
  job_status: 'pending_approval',
  updated_at: '2026-09-30T12:00:00Z',
};
function setup() {
  const request = jest.fn(async (request: MobileWorkRequest) => {
    if (request.action === 'channel')
      return {
        kind: 'channel',
        channel: 'team',
        text: 'Fixture channel message',
      } as const;
    if (request.action === 'snapshot')
      return { kind: 'queue', items: [ticket], hasMore: false } as const;
    return {
      kind: 'receipt',
      jobId: 'job-a',
      status:
        request.action === 'decide' && request.decision === 'reject'
          ? 'cancelled'
          : 'pending',
      duplicate: false,
    } as const;
  });
  const mobile = {
    storageScope: 'fixture-account',
    workGateway: { request },
    projectionReady: true,
    snapshot: {
      ...syntheticSnapshot,
      connection: {
        ...syntheticSnapshot.connection,
        synthetic: false,
        allowedActions: ['manage_work'],
      },
    },
  };
  mockMobile.mockReturnValue(mobile);
  return { request, mobile };
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(AsyncStorage.getItem).mockResolvedValue(null);
});
test('work controls require an explicit pairing grant', async () => {
  const { mobile, request } = setup();
  mockMobile.mockReturnValue({ ...mobile, workGateway: null });
  const view = await render(<WorkScreen />);
  expect(view.getByText(/Pair this phone/)).toBeTruthy();
  expect(request).not.toHaveBeenCalled();
});
test('reads the channel but approves only after a separate confirmation', async () => {
  const { request } = setup();
  const view = await render(<WorkScreen />);
  await fireEvent.press(view.getByRole('tab', { name: 'Slack' }));
  await waitFor(() =>
    expect(view.getByText('Fixture channel message')).toBeTruthy(),
  );
  await fireEvent.press(view.getByRole('tab', { name: 'Tickets' }));
  await fireEvent.press(view.getByText('Fixture ticket'));
  await fireEvent.press(view.getByText('Approve ticket'));
  expect(request.mock.calls.some(([value]) => value.action === 'decide')).toBe(
    false,
  );
  await fireEvent.press(view.getByText('Confirm action'));
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      {
        action: 'decide',
        job_id: 'job-a',
        source_key: 'slack:fixture',
        decision: 'approve',
        reason: '',
        idempotency_key: 'fixture-key',
      },
      expect.anything(),
    ),
  );
  expect(AsyncStorage.setItem).toHaveBeenCalled();
});
test('reject requires a reason and sends the exact pending job coordinates', async () => {
  const { request } = setup();
  const view = await render(<WorkScreen />);
  await waitFor(() => expect(view.getByText('Fixture ticket')).toBeTruthy());
  await fireEvent.press(view.getByText('Fixture ticket'));
  await fireEvent.press(view.getByText('Reject ticket'));
  await fireEvent.press(view.getByText('Confirm action'));
  expect(request.mock.calls.some(([value]) => value.action === 'decide')).toBe(
    false,
  );
  await fireEvent.changeText(
    view.getByLabelText('Reason for rejecting ticket'),
    'No longer needed',
  );
  await fireEvent.press(view.getByText('Confirm action'));
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: 'reject',
        job_id: 'job-a',
        reason: 'No longer needed',
      }),
      expect.anything(),
    ),
  );
});
test('offline projections cannot read or mutate the queue', async () => {
  const { mobile, request } = setup();
  mockMobile.mockReturnValue({
    ...mobile,
    snapshot: {
      ...mobile.snapshot,
      connection: {
        ...mobile.snapshot.connection,
        phase: 'offline',
        mutationsAllowed: false,
      },
    },
  });
  const view = await render(<WorkScreen />);
  expect(
    view.getByText('Reconnect to read Slack and manage work.'),
  ).toBeTruthy();
  expect(request).not.toHaveBeenCalled();
});

test('a definite first-attempt refusal explains recovery and keeps new actions available', async () => {
  const { request } = setup();
  const view = await render(<WorkScreen />);
  await waitFor(() => expect(view.getByText('Fixture ticket')).toBeTruthy());
  await fireEvent.press(view.getByText('Fixture ticket'));
  request.mockRejectedValueOnce(
    new MobileLifecycleError(409, 'mobile_work_not_applied'),
  );
  await fireEvent.press(view.getByText('Approve ticket'));
  await fireEvent.press(view.getByText('Confirm action'));
  await waitFor(() =>
    expect(
      view.getByText(
        'Manage did not apply this request. Check the ticket and refresh the queue before trying again.',
      ),
    ).toBeTruthy(),
  );
  expect(AsyncStorage.removeItem).toHaveBeenCalled();
  expect(view.queryByText('Retry same request')).toBeNull();
});

test('work sections isolate tickets, Slack and ticket creation without sending a command', async () => {
  const { request } = setup();
  const view = await render(<WorkScreen />);
  await waitFor(() => expect(view.getByText('Fixture ticket')).toBeTruthy());
  expect(view.queryByText('Fixture channel message')).toBeNull();
  expect(view.queryByLabelText('GitHub issue URL')).toBeNull();
  await fireEvent.press(view.getByRole('tab', { name: 'New ticket' }));
  expect(view.getByLabelText('GitHub issue URL')).toBeTruthy();
  expect(view.queryByText('Fixture ticket')).toBeNull();
  expect(
    request.mock.calls.every(
      ([value]) => value.action === 'channel' || value.action === 'snapshot',
    ),
  ).toBe(true);
});

test('ticket search keeps the queue scoped and preserves its filter when returning from details', async () => {
  setup();
  const view = await render(<WorkScreen />);
  await waitFor(() => expect(view.getByText('Fixture ticket')).toBeTruthy());
  await fireEvent.changeText(view.getByLabelText('Search tickets'), 'Fixture');
  await fireEvent.press(view.getByText('Fixture ticket'));
  await fireEvent.press(view.getByText('Back to tickets'));
  expect(view.getByLabelText('Search tickets')).toHaveProp('value', 'Fixture');
  await fireEvent.changeText(view.getByLabelText('Search tickets'), 'no match');
  expect(view.queryByText('Fixture ticket')).toBeNull();
  expect(view.getByText('No tickets match these filters.')).toBeTruthy();
});

test('a Slack issue link prepares an editable ticket without dispatching it', async () => {
  const { request } = setup();
  request.mockResolvedValueOnce({
    kind: 'channel',
    channel: 'team',
    text: '2026-11-02T12:00:00Z Alice: <https://github.com/example/repo/issues/42|Please review>',
  } as never);
  const view = await render(<WorkScreen />);
  await fireEvent.press(view.getByRole('tab', { name: 'Slack' }));
  await waitFor(() =>
    expect(
      view.getByLabelText(
        'Prepare ticket: https://github.com/example/repo/issues/42',
      ),
    ).toBeTruthy(),
  );
  await fireEvent.press(
    view.getByLabelText(
      'Prepare ticket: https://github.com/example/repo/issues/42',
    ),
  );
  expect(view.getByLabelText('GitHub issue URL')).toHaveProp(
    'value',
    'https://github.com/example/repo/issues/42',
  );
  expect(
    request.mock.calls.every(
      ([value]) => value.action === 'channel' || value.action === 'snapshot',
    ),
  ).toBe(true);
  await fireEvent.press(view.getByText('Review ticket submission'));
  expect(view.getByText('Confirm action')).toBeTruthy();
  expect(
    request.mock.calls.every(
      ([value]) => value.action === 'channel' || value.action === 'snapshot',
    ),
  ).toBe(true);
});
