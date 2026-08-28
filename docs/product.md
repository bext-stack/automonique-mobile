# Product definition

## Product promise

Automonique Mobile gives an operator a small, trustworthy control surface for
work that is already running on an Automonique server. It is not a second
agent runtime. The server remains authoritative for identity, policy,
execution, history, and mutation outcomes.

## Primary operator

The first user is an on-call or delivery operator who needs to understand and
intervene in an active Automonique session away from a desktop. They already
have access to a particular Automonique installation and need a bounded view,
clear freshness, and explicit actions rather than an administration cockpit.

## Jobs to be done

1. Open an overview that distinguishes active work, running sessions, pending
   approvals, uncertain receipts, lost sessions, and connection freshness.
2. See which authorized sessions need attention and whether the view is live,
   reconnecting, stale, incompatible, or synthetic.
3. Open one exact session and understand its identity, revision, run,
   freshness, cursor, and sanitized timeline.
4. Send a deliberate follow-up to that exact session without accidentally
   targeting another run or replaying an uncertain write.
5. Review an approval's requester, impact, expiry, and exact revision before
   granting or denying it.
6. Stop one exact run and receive an authoritative outcome.
7. Review sanitized cross-session activity and recover the receipt for an
   ambiguous mutation by idempotency key without
   submitting the mutation again.
8. Inspect the exact server identity, actor, actions, session scope, limits,
   and credential expiry granted to this phone.
9. Retain a bounded read-only projection and message draft when connectivity
   is lost.

## Historical first-slice outcome

The original first slice was a deterministic, synthetic operator journey
through the same narrow gateway, cursor reducer, cache boundary, and
reconciliation path that the production SDK adapter now uses. It remains
valuable as an executable contract and interaction test; by itself, it is not
evidence of a live server connection.

The slice was accepted after all of the following were evidenced:

- Session bootstrap and every attachable timeline flow through
  `MobileAutomoniqueGateway`; screens do not import fixtures or the Platform
  client.
- The timeline retains authoritative, preview, synthetic, and unknown event
  provenance without interpreting an unknown event as success.
- Exact duplicate pages are idempotent. A cursor gap, conflicting duplicate,
  invalid page, or page over the negotiated limit makes the projection stale
  and read-only until a fresh snapshot is admitted.
- Follow-up, approval decision, and run stop each carry an exact coordinate,
  revision, and newly generated idempotency key.
- Action controls require both a live projection and the corresponding
  actor-authorized action. Follow-up also observes its negotiated UTF-8 byte
  ceiling.
- A reconciliation handle is durably recorded before a mutation is sent. An
  ambiguous or accepted result is resolved only through receipt
  reconciliation; the original mutation is never replayed.
- A possibly applied follow-up fences the submitted session revision across
  refresh and restart. Mobile becomes writable again only after authoritative
  command state reports a strictly newer session revision; refused and resync
  outcomes preserve the operator's editable draft.
- A completed follow-up may add a labeled local preview without advancing the
  acknowledged resume cursor; a completed approval disappears, and a completed
  stop removes the run association.
- Cached data is schema-admitted, read-only on restore, capped at 256 KiB, 100
  sessions, 1,000 events, 100 approvals, and 200 receipts. Corrupt or oversized
  cache data cannot make an action writable.
- The vendored SDK archive, source commit, package version, Apache-2.0 license,
  schema digest, and SHA-256 digest agree before validation proceeds.
- TypeScript, lint, unit/integration tests, formatting, Expo Doctor, secret
  scanning, and Android/iOS/web exports pass in CI under Node.js 24.

Signed native builds, hands-on device/simulator accessibility passes, and live
server acceptance are later evidence gates and must not be inferred from Expo
export success.

## Current implemented boundary

The production composition root now starts unpaired, admits an exact HTTPS
origin and server identity through a short-lived one-time pairing offer, and
stores issued access and refresh credentials only in OS Secure Store. It
enables the operational routes only while the server-issued credential and
actor authorization are current. Expiry, identity or scope drift, rejected
authorization, uncertain rotation, and revocation fail closed to settings or a
read-only recovery state.

The canonical SDK supplies actor-filtered session discovery, sanitized bounded
history snapshots/pages, typed retention-gap resynchronization, command state,
and high-level follow-up, approval-decision, exact-run-stop, and receipt
reconciliation methods. Production screens still receive only
`MobileAutomoniqueGateway`; neither a generic `execute` method nor raw provider
output crosses that boundary. Synthetic transports remain test fixtures and
are rejected by production source and emitted-bundle verification.

This proves the client implementation and its automated Rust-to-TypeScript,
mobile, security, and bundle contracts. It does not prove an authorized live
connection, EAS/native artifact, VoiceOver/TalkBack pass, signed release, or
production deployment.

## Delivery phases

### Phase 0 — verified synthetic slice (complete)

Established the executable mobile boundary, persistence rules, reconciliation
behavior, UI states, automated tests, and historical synthetic fixtures before
enabling a production credential or endpoint.

### Phase 1 — server contract and SDK integration (complete)

The mobile adapter is pinned to a verified `@automonique/sdk` artifact and
consumes server-owned pairing, credential refresh/revoke, endpoint discovery,
stable identity, actor authorization, limits, sanitized resumable history, and
high-level mobile commands.

### Phase 2 — authorized non-production acceptance (external evidence pending)

Connection setup is implemented after live Rust-to-TypeScript contract
evidence. Verifying real sessions, attachment, follow-up, approval, stop,
conflict, resynchronization, and receipt recovery still requires an authorized
non-production installation and pairing/test-data scope.

### Phase 3 — native release readiness (external evidence pending)

Run EAS Android and iOS simulator builds, device accessibility checks, adverse
network tests, privacy review, dependency notices, signing, and release
operations. App-store publication requires a separate decision.

## Product risks

| Risk                                    | Consequence                                                | Control                                                                                               |
| --------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Authority inferred from method presence | An operator sees an action they are not allowed to perform | Admit a server-bound actor authorization document and gate each action independently                  |
| Stale or conflicting projection         | A command targets obsolete state                           | Bind exact revisions; make stale, reconnecting, incompatible, gap, and conflict states read-only      |
| Ambiguous network outcome               | A write is performed twice                                 | Persist only a reconciliation handle before send and query the receipt by idempotency key             |
| Protocol or artifact drift              | Mobile encodes a different contract from the server        | Use the canonical SDK, pin its artifact and schema digests, and run bundle plus live contract gates   |
| Sensitive or unbounded local data       | Customer data leaks or exhausts device storage             | Cache only sanitized projections and drafts under explicit ceilings; keep credentials in Secure Store |
| Endpoint impersonation                  | Credentials or commands reach the wrong server             | Require HTTPS, stable server identity, scoped credentials, expiry, refresh, and revocation            |
| Native-only regressions                 | A web/export check hides a device failure                  | Require simulator builds and VoiceOver/TalkBack/Dynamic Type checks before release claims             |

## Non-goals for the first slice

- An embedded agent or provider runtime.
- Direct provider credentials, routing policy, privileged tools, shell access,
  or direct database access.
- A generic Platform `execute` surface in screens.
- An offline mutation queue or background mutation execution.
- Audio-message uploads, attachments, widgets, a multi-server cockpit, or
  model/profile/tool administration. On-device voice dictation is only an
  editable input method for the existing text follow-up contract.
- Production deployment, signed store binaries, or app-store publication.

## Read-only workspace companion expansion

Issue #34 deliberately revisits the multi-server-cockpit non-goal for bounded,
revocable reads only. An operator may eventually find an authorized task or
workspace across server profiles and continue into retained mobile surfaces.
The foundation models project, host, external work item, workspace, attempt,
session, branch/repository display context, freshness, and unread attention.
External task status remains visibly and structurally distinct from internal
orchestration status.

The expansion now ships the canonical Platform v2 SDK archive and a production
authenticated gateway for negotiated project reads, lineage, read-only review,
typed task intents, exact cancellation, and lifecycle preview/confirmation.
The mobile lifecycle consumes the dedicated server-issued delegated v2 bearer
document, persists it with the secure credential generation, and keeps exact
project roots and per-operation actions fail-closed across refresh.

Production companion navigation now consumes only those delegated project
roots. It joins projects, host setups, checkouts, workspaces, attempts,
sessions, repositories, and retained Platform sessions through typed
relations. It performs at most 32 per-workspace lineage/review detail reads,
two workspaces at a time, and calls out partial coverage. The durable catalog
can retain up to eight server identities read-only, while the current
credential generation is the only identity marked active. External-work
status and orchestration status are separate fields and UI sections; labels
are never parsed for either.

Workspace files, sanitized previews, and source-control summaries appear only
after a current `get_review` grant returns the corresponding typed projection.
The review surface additionally supports exact line-comment and approval
effects only when the current delegated grant exposes both review execution
and receipt lookup. Each effect has a separate confirmation preview and a
durable idempotency handle; cached, stale, revoked, or ambiguous state disables
new mutations. Opt-in local notifications contain no review content and their
coordinates are re-admitted against the current live projection before routing.
Check rerun, pull-request update/merge, batch send, generic execute, and shell
fallback remain unavailable.
Exact chat jumps additionally require the workspace revision, typed retained
session relation, session revision, and an exact session in the bounded v1
mobile projection. Cached data and revision-scoped drafts survive offline, but
non-chat destinations and every workspace mutation fail closed. Create/resume
remain visibly disabled because no production UI adapter binds those intents
to server-issued previews and receipts yet. Concurrent active credentials for
multiple servers and live-server acceptance remain pending because the
credential lifecycle currently admits one active server generation at a time.
Terminal
relay, attachments, uploads, and background mutation remain separate
risk-reviewed work. See
[workspace-companion-threat-model.md](workspace-companion-threat-model.md).
