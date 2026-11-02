// SPDX-License-Identifier: Elastic-2.0
import { fireEvent, render } from '@testing-library/react-native';
import { SessionTimeline } from './session-timeline';
import { decimalRevision, type SessionEvent } from '@/core/types';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn() },
}));

function event(index: number) {
  return {
    id: `event-${index}`,
    cursor: `cursor-${index}`,
    sequence: decimalRevision(String(index + 1)),
    createdAt: '2026-01-01T00:00:00Z',
    provenance: 'authoritative' as const,
  };
}
const events: SessionEvent[] = [
  { ...event(0), kind: 'message', role: 'user', text: 'Explain this app' },
  ...Array.from({ length: 91 }, (_, index): SessionEvent => ({
    ...event(index + 1),
    kind: 'unknown',
    eventType: 'adapter_event',
  })),
  { ...event(92), kind: 'run_state', state: 'failed' },
  {
    ...event(93),
    kind: 'tool',
    name: 'Check',
    state: 'error',
    publicText: 'A useful failure',
  },
  {
    ...event(94),
    kind: 'message',
    role: 'assistant',
    text: 'Here is the answer',
  },
];

test('details groups 91 diagnostic events while preserving messages and failures', async () => {
  const view = await render(<SessionTimeline events={events} diagnostics />);
  expect(view.getByText('Explain this app')).toBeVisible();
  expect(view.getByText('Here is the answer')).toBeVisible();
  expect(view.getByText('failed')).toBeVisible();
  expect(view.getByText('A useful failure')).toBeVisible();
  expect(view.getByText('Internal events · 91')).toBeVisible();
  expect(view.queryByText('Unknown event')).toBeNull();
  await fireEvent.press(view.getByText('Internal events · 91'));
  expect(view.getByText('adapter_event × 91')).toBeVisible();
  expect(view.queryByText('Unknown event')).toBeNull();
  await fireEvent.press(view.getByText('Show raw events · 20'));
  expect(view.getAllByText('Unknown event')).toHaveLength(20);
  await fireEvent.press(view.getByText('Show next events · 20'));
  expect(view.getAllByText('Unknown event')).toHaveLength(40);
  await fireEvent.press(view.getByText('Internal events · 91'));
  expect(view.queryByText('Unknown event')).toBeNull();
});

test('ordinary conversation shows only messages, with no diagnostic summaries', async () => {
  const view = await render(
    <SessionTimeline events={events} diagnostics={false} />,
  );
  expect(view.getByText('Explain this app')).toBeVisible();
  expect(view.getByText('Here is the answer')).toBeVisible();
  expect(view.queryByText(/Internal events/)).toBeNull();
  expect(view.queryByText('Unknown event')).toBeNull();
});
