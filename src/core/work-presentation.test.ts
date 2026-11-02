// SPDX-License-Identifier: Elastic-2.0
import {
  readableWorkDate,
  workFeedBlocks,
  presentSlackText,
} from './work-presentation';
test('preserves multiline bodies and an unstructured preamble', () => {
  const blocks = workFeedBlocks(
    '#team: recent messages\n2026-11-02T12:00:00Z Alice: First line\nSecond line\n2026-11-02T12:01:00Z Bob: <https://example.test|A label>',
  );
  expect(blocks).toEqual([
    { author: null, timestamp: null, text: '#team: recent messages' },
    {
      author: 'Alice',
      timestamp: '2026-11-02T12:00:00Z',
      text: 'First line\nSecond line',
    },
    {
      author: 'Bob',
      timestamp: '2026-11-02T12:01:00Z',
      text: '<https://example.test|A label>',
    },
  ]);
});
test('keeps unfamiliar feed and date formats readable without dropping them', () => {
  expect(workFeedBlocks('Unstructured message')).toEqual([
    { author: null, timestamp: null, text: 'Unstructured message' },
  ]);
  expect(readableWorkDate('not supplied', 'fr')).toBe('not supplied');
});

test('Slack links keep their label and destination while deduplicating actions', () => {
  const result = presentSlackText(
    'Read <https://github.com/example/repo/issues/12|the ticket>\nhttps://github.com/example/repo/issues/12',
  );
  expect(result.text).toContain('the ticket — example/repo #12');
  expect(result.text.match(/example\/repo #12/g)).toHaveLength(1);
  expect(result.text).not.toContain('https://');
  expect(result.links).toHaveLength(1);
  expect(result.links[0]?.issueUrl).toBe(
    'https://github.com/example/repo/issues/12',
  );
});
test('unsafe protocols and credential URLs never become actions; lookalikes cannot prepare tickets', () => {
  const result = presentSlackText(
    '<javascript:alert(1)|go> <https://user:secret@example.test|go> https://github.com.example.test/example/repo/issues/12',
  );
  expect(result.links).toHaveLength(1);
  expect(result.links[0]?.issueUrl).toBeNull();
  expect(result.text).toContain('javascript:alert(1)');
});
test('GitHub issue fragments link to the comment but prepare the canonical issue', () => {
  const result = presentSlackText(
    'https://github.com/example/repo/issues/12#issuecomment-7',
  );
  expect(result.links[0]?.url).toContain('#issuecomment-7');
  expect(result.links[0]?.issueUrl).toBe(
    'https://github.com/example/repo/issues/12',
  );
});

test('recognizes Slack GitHub URL labels without showing the URL twice', () => {
  for (const label of [
    'https://github.com/example/repo/issues/42',
    'github.com/example/repo/issues/42',
  ]) {
    const result = presentSlackText(
      `<https://github.com/example/repo/issues/42|${label}>`,
    );
    expect(result.text).toBe('example/repo #42');
    expect(result.links).toHaveLength(1);
    expect(result.links[0]?.url).toBe(
      'https://github.com/example/repo/issues/42',
    );
  }
});
