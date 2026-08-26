# Roadmap

The executable task list and acceptance evidence live in the
[delivery backlog](backlog.md). The [product definition](product.md) explains
who each phase serves and what the first slice must prove.

## Completed foundation — verified synthetic slice

- Route fixture data through the same gateway, cursor reducer, bounded cache,
  and receipt-reconciliation path as the SDK adapter.
- Admit exact targets, actor actions, limits, unknown outcomes, and failure
  states without creating an offline mutation queue.
- Pin and verify the canonical SDK artifact and run provider/screen integration
  tests plus Android/iOS/web export gates.

This phase remains useful historical context: its deterministic gateways and
adverse-state fixtures still verify the same narrow application boundary, but
they are test-only and are excluded from the production source graph and
bundles.

## Implemented production connection boundary

- Server-owned one-time pairing, scoped access/refresh rotation, revocation,
  endpoint discovery, and stable server identity are integrated.
- Actor-authorized session scope, actions, and limits are admitted before
  operational navigation.
- Sanitized bounded history snapshots/pages resume by cursor and require typed
  resynchronization after retention gaps.
- `MobileSessionClient` exposes command state, follow-up, exact-run stop,
  approval decisions, and receipt reconciliation without giving screens a
  generic `execute` surface.
- The production composition root remains in settings/read-only lifecycle
  states until the exact SDK, identity, credential, and authorization contracts
  are admitted.

The implementation was delivered through the server SDK work tracked by
[Automonique #112](https://github.com/bext-stack/automonique/issues/112) and
[Automonique #113](https://github.com/bext-stack/automonique/issues/113), plus
the completed mobile MOB-100 through MOB-102 issues.

## Authorized non-production acceptance

- Supply an approved non-production HTTPS origin, operator-authorized one-time
  pairing offer, and bounded test-data scope.
- Exercise discovery, attach/history, all three bound commands, reconnect,
  cursor resynchronization, conflicts, and ambiguous receipt recovery.
- Record results without using production data or claiming deployment.

The code path and automated contracts are complete; this live acceptance phase
remains an external endpoint, credential, and infrastructure evidence gate.

## Native verification

- Run EAS Android and iOS simulator profiles in an authorized build project.
- Complete VoiceOver and TalkBack device passes.
- Exercise Dynamic Type, reduced motion, reconnect, cursor expiry, and
  ambiguous receipt recovery on both platforms.

Repository branch/tag controls and automated native-policy checks are active.
EAS build records, downloaded artifact hashes, packaged-policy inspection,
hands-on accessibility evidence, and an independent CODEOWNERS approval remain
external gates; none is inferred from Expo export or CI success.

## Later, explicitly out of the first slice

Audio-message uploads, attachments, widgets, a multi-server cockpit,
model/profile/tool administration, direct provider access, background mutation
execution, and app-store publication. On-device dictation remains an editable
input method for the existing text follow-up contract, not a new server action.
