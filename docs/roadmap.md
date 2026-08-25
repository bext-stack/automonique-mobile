# Roadmap

The executable task list and acceptance evidence live in the
[delivery backlog](backlog.md). The [product definition](product.md) explains
who each phase serves and what the first slice must prove.

## Verified synthetic slice

- Route fixture data through the same gateway, cursor reducer, bounded cache,
  and receipt-reconciliation path as the SDK adapter.
- Admit exact targets, actor actions, limits, unknown outcomes, and failure
  states without creating an offline mutation queue.
- Pin and verify the canonical SDK artifact and run provider/screen integration
  tests plus Android/iOS/web export gates.

## First authorized production connection

- Add server-owned scoped mobile credential issue/refresh/revoke flows.
- Add endpoint discovery and stable server identity verification.
- Consume actor-authorized capabilities and limits through `@automonique/sdk`.
- Add sanitized, bounded, resumable session history and progress pages.
- Enable the SDK adapter in navigation only after those contracts are admitted.

This phase is blocked by
[Automonique #112](https://github.com/bext-stack/automonique/issues/112). The
canonical SDK package and protocol work is tracked in
[Automonique #113](https://github.com/bext-stack/automonique/issues/113).

## Native verification

- Run EAS Android and iOS simulator profiles in an authorized build project.
- Complete VoiceOver and TalkBack device passes.
- Exercise Dynamic Type, reduced motion, reconnect, cursor expiry, and
  ambiguous receipt recovery on both platforms.

## Later, explicitly out of the first slice

Attachments, voice, widgets, a multi-server cockpit, model/profile/tool
administration, direct provider access, background mutation execution, and
app-store publication.
