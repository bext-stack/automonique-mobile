// SPDX-License-Identifier: Elastic-2.0
export interface FeedBlock {
  readonly author: string | null;
  readonly timestamp: string | null;
  readonly text: string;
}
/** Format the text feed without inventing message identities or dropping unknown formats. */
export function workFeedBlocks(text: string): readonly FeedBlock[] {
  return text
    .split(/(?=^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s)/m)
    .filter((block) => block.trim())
    .map((block) => {
      const match =
        /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s+([^:\n]+):\s*([\s\S]*)$/.exec(block);
      return match
        ? { author: match[2]!, timestamp: match[1]!, text: match[3]!.trimEnd() }
        : { author: null, timestamp: null, text: block.trimEnd() };
    });
}
export function readableWorkDate(value: string, language: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString(language === 'fr' ? 'fr-FR' : 'en-US', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : value;
}

export interface FeedLink {
  readonly url: string;
  readonly label: string;
  readonly host: string;
  readonly issueUrl: string | null;
}
/** Only offer HTTPS links with no embedded credentials; unknown markup stays plain text. */
export function presentSlackText(text: string): {
  text: string;
  links: readonly FeedLink[];
} {
  const links: FeedLink[] = [];
  const seen = new Set<string>();
  const rendered = text.replace(
    /<(https:\/\/[^>|]+)(?:\|([^>]+))?>|(https:\/\/[^\s<>]+)/g,
    (
      original,
      wrapped: string | undefined,
      label: string | undefined,
      bare: string | undefined,
    ) => {
      const raw = wrapped ?? bare ?? '';
      let parsed: URL;
      try {
        parsed = new URL(raw);
      } catch {
        return original;
      }
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password)
        return original;
      const issueUrl =
        parsed.hostname === 'github.com' &&
        parsed.port === '' &&
        /^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/[1-9][0-9]*\/?$/.test(
          parsed.pathname,
        )
          ? `https://github.com${parsed.pathname.replace(/\/$/, '')}`
          : null;
      const duplicate = seen.has(parsed.href);
      if (!duplicate) {
        seen.add(parsed.href);
        links.push({
          url: parsed.href,
          label: label || raw,
          host: parsed.host,
          issueUrl,
        });
      }
      const sameLabel =
        !label ||
        label.replace(/^https?:\/\//, '').replace(/\/$/, '') ===
          raw.replace(/^https?:\/\//, '').replace(/\/$/, '');
      if (issueUrl) {
        const [, owner, repo, , number] = parsed.pathname.split('/');
        const reference = `${owner}/${repo} #${number}`;
        if (duplicate) return sameLabel ? '' : label!;
        return sameLabel ? reference : `${label} — ${reference}`;
      }
      return sameLabel ? raw : `${label} (${raw})`;
    },
  );
  return { text: rendered, links };
}
