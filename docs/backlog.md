# Delivery backlog

This is the repository-local execution list. It complements the cross-repo
[mobile epic](https://github.com/bext-stack/automonique/issues/112) and the
[canonical TypeScript SDK issue](https://github.com/bext-stack/automonique/issues/113).
An item is complete only when its acceptance evidence is committed and the
relevant CI checks pass.

Remaining tracked work is grouped in the
[Mobile foundation milestone](https://github.com/bext-stack/automonique-mobile/milestone/1).

## Completed baseline

- [x] **MOB-000 — Create the public repository and Expo baseline.** Node.js 24,
      Expo SDK 57, React Native 0.86.2, React 19.2, TypeScript, native identifiers,
      EAS profiles, license, contribution policy, and security policy are present.
- [x] **MOB-001 — Build the first operator screens.** Session list, session
      timeline, follow-up composer, exact-run stop, approvals, connection draft,
      stale toggle, and receipt cards exist behind the mobile provider.
- [x] **MOB-002 — Establish baseline CI.** Clean install, typecheck, lint, Jest,
      formatting, Expo Doctor, all-platform export, dependency review, and secret
      history scanning run on GitHub.

## Now — verify the synthetic vertical slice

- [x] **MOB-010 — Exercise the gateway and projection end to end.**
  - Dependency: none.
  - Acceptance: the provider accepts an injected gateway; bootstrap and
    attachable timelines pass through `bootstrap`, `attach`, and the cursor
    reducer; duplicate pages are idempotent; gaps, conflicts, wrong-session
    pages, excessive pages, and oversized pages become stale/read-only; tests
    assert the user-visible state.
- [x] **MOB-011 — Enforce exact targets and independent action authority.**
  - Dependency: MOB-010.
  - Acceptance: follow-up, approval, and stop validate current coordinates and
    revisions; idempotency-key reuse with a different command is rejected;
    each UI control is gated by its own authorized action rather than a shared
    follow-up flag; expired approvals fail closed.
- [x] **MOB-012 — Recover ambiguous mutations without replay.**
  - Dependency: MOB-011.
  - Acceptance: a bounded handle containing action, exact target, and
    idempotency key is stored before sending; transport ambiguity and accepted
    receipts call reconciliation only; pending handles survive restart;
    settled outcomes clear the handle; no original command payload is stored
    or replayed.
- [x] **MOB-013 — Admit and bound cached projections.**
  - Dependency: MOB-010.
  - Acceptance: restored cache is schema-validated and always read-only;
    documented session/event/approval/receipt and byte ceilings are enforced;
    invalid cache is removed without suppressing a fresh bootstrap; storage
    failures cannot make mutations writable.
- [x] **MOB-014 — Consume the canonical SDK through one adapter.**
  - Dependency: Automonique #113 package contract.
  - Acceptance: `@automonique/sdk` is an immutable dependency; source commit,
    package version, archive SHA-256, schema digest, and license are verified;
    SDK primitives remain confined to core protocol-boundary modules and never
    leak into screens or the provider; the adapter maps every mobile gateway
    operation; Node-free Android/iOS/web bundles pass.
- [x] **MOB-015 — Add integration and adverse-state coverage.**
  - Dependencies: MOB-010 through MOB-014.
  - Acceptance: tests cover provider startup, cached-stale restore, corrupt and
    oversized cache, authorization per action, exact-target conflicts, cursor
    resume/gap/duplicate/unknown event, ambiguous outcome, restart recovery,
    and receipt-driven UI updates.
- [x] **[MOB-016 — Verify and publish the synthetic baseline evidence](https://github.com/bext-stack/automonique-mobile/issues/1).**
  - Dependencies: MOB-010 through MOB-015.
  - Acceptance: `npm run validate` passes from a clean Node.js 24 install; CI
    is green on the pushed commit; documentation matches the implementation;
    parent #112 receives a concise evidence comment. Do not close #112.

## Next — production connection, blocked on server contracts

- [ ] **[MOB-100 — Add scoped mobile credential lifecycle and server identity](https://github.com/bext-stack/automonique-mobile/issues/2).**
  - Blocked by: Automonique #112 server-owned issuance, refresh, expiry,
    revocation, endpoint discovery, and stable identity contracts.
  - Acceptance: credentials are stored only in OS Secure Store; connection
    profiles contain no secret; identity mismatch, expiry, refresh failure, and
    revocation all become read-only before navigation.
- [ ] **[MOB-101 — Consume actor-authorized capabilities and limits](https://github.com/bext-stack/automonique-mobile/issues/3).**
  - Blocked by: Automonique #112 actor authorization contract.
  - Acceptance: the signed-in actor, server identity, actions, and limits are
    negotiated and admitted before a live projection is exposed; method
    presence alone grants nothing.
- [ ] **[MOB-102 — Consume sanitized remotely resumable history](https://github.com/bext-stack/automonique-mobile/issues/4).**
  - Blocked by: Automonique #112 bounded session history/progress contract.
  - Acceptance: attach resumes from the acknowledged cursor, cursor expiry
    requests a snapshot, raw provider/tool output never enters mobile, and all
    pages observe negotiated ceilings.
- [ ] **[MOB-103 — Verify the first authorized non-production connection](https://github.com/bext-stack/automonique-mobile/issues/5).**
  - Dependencies: MOB-100 through MOB-102.
  - Acceptance: endpoint/identity negotiation, session discovery, attach,
    follow-up, approval, stop, reconnect, conflict, and ambiguous receipt
    recovery pass against a live authorized installation with no production
    data or deployment claim.

## Native release readiness

- [ ] **[MOB-200 — Run reproducible EAS Android and iOS simulator builds](https://github.com/bext-stack/automonique-mobile/issues/6).**
      Record immutable build references and verify cleartext/ATS policy in the
      generated native applications.
  - [x] Pin the credential-free simulator profile and assert generated Android
        and iOS transport policy from a clean prebuild.
  - [ ] Link the authorized Expo project, run both EAS builds, and record build
        IDs plus downloaded artifact hashes.
- [ ] **[MOB-201 — Complete device accessibility and resilience passes](https://github.com/bext-stack/automonique-mobile/issues/7).**
      Verify VoiceOver, TalkBack, Dynamic Type, reduced motion, dark/light themes,
      reconnect, cursor expiry, interrupted mutation recovery, and destructive
      action announcements on both platforms.
  - [x] Implement semantic controls, truthful action announcements,
        reduced-motion navigation, scalable layouts, serialized reconnect, fresh
        snapshot recovery after cursor expiry, and automated contract coverage.
  - [ ] Record hands-on VoiceOver and TalkBack passes on authorized iOS and
        Android devices/simulators.
- [ ] **[MOB-202 — Add repository release governance](https://github.com/bext-stack/automonique-mobile/issues/8).** Require CI checks on
      `main`, add ownership/review rules, pin third-party actions and scanner images
      immutably, produce complete third-party notices, and document signing and
      rollback before any release.
  - [x] Add CODEOWNERS, PR policy, immutable workflow references, generated npm
        notices, release/signing/rollback guidance, and CI enforcement.
  - [ ] Activate repository rules and independent approval once a second
        qualified organization reviewer exists.

## Later

- [ ] Replace remaining Expo-template assets and remove unused dependencies.
- [ ] Evaluate attachments and voice only after the base authority and privacy
      contracts are stable.
- [ ] Consider widgets and a multi-server cockpit as separate products.
- [ ] Treat profiles/models/tools administration and app-store publication as
      separately authorized initiatives.
