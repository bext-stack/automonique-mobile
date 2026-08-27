# Architecture

Automonique Mobile is a presentation client, not an execution node. The server
owns identity, authority, policy, execution, canonical history, and mutation
outcomes.

The workspace-companion foundation adds a second, strictly admitted read model
for multiple authorized server identities. Its strict admission layer binds
hosts, projects, workspaces, attempts, retained sessions, and navigation grants
to one server profile. Cached profiles reopen stale and retain only
`workspace_read`. The canonical Platform v2 SDK is now vendored and the
production lifecycle constructs a generation-scoped authenticated v2 gateway.
It negotiates v2 before reads, consumes exact project-root queries, exposes
typed lineage and read-only review snapshots, and performs create/resume only
through an ephemeral server preview and a separate confirmation. Persisted
authorization tombstones pin omitted or
revoked identities to their tenant, origin, and last authorization revision.
Bounded per-object revision tombstones also retain workspace, attempt, and
session rollback fences across omission; reintroduction must advance the exact
object revision.
The provider does not infer project roots or v2 actions from the v1 session
scope. Until the server issues a delegated bearer principal with exact roots,
per-action grants, identity/revisions, generation, and expiry—and the bridge
validates that principal—no production screen can start inventory reads or a
workspace mutation. This authentication incompatibility, project/action
authorization, production UI/cache integration, and live acceptance are
distinct blockers.

## System boundary

```text
screens
   │ high-level reads and actions only
   ▼
ProductionMobileProvider / MobileProvider
   │
   ├── MobileAutomoniqueGateway ──┬── createMockGateway (tests only)
   │                              │     deterministic adverse-state contract
   │                              └── SDK mobile adapter
   │                                    │
   │                                    ▼
   │                              @automonique/sdk
   │                                    │ canonical Platform v1 over HTTPS
   │                                    ▼
   │                              Automonique server
   │
   ├── WorkspaceV2Gateway ───────── @automonique/sdk Platform v2 over HTTPS
   │       negotiated reads, lineage, review reads, typed lifecycle preview,
   │       explicit confirm/deny, and exact lineage cancellation
   │
   ├── bounded read cache and reconciliation handles ── Async Storage
   ├── endpoint/profile metadata and message drafts ─── Async Storage
   └── scoped mobile credential ──────────────────────── OS Secure Store
```

Screens can list and attach sessions, consume typed event pages, send a bound
follow-up, decide an exact approval revision, stop an exact run, and reconcile
a receipt by idempotency key. There is deliberately no generic `execute`
method in the mobile gateway. Runtime SDK imports are confined to core
protocol-boundary modules: the adapter, protocol metadata, shared type
vocabulary, and persistence admission. Screens and the provider never receive
Platform transport or raw execution primitives.

The v2 gateway is recreated with every credential generation. Its credential
provider rechecks the original authorization fingerprint after asynchronous
refresh, and 401/403/410 responses move the process-wide lifecycle to
`refresh_required`. Prepared lifecycle previews are held only in memory and
are single-use; app reload, credential replacement, expiry, denial, or replay
cannot submit them. Before submit, mobile persists only a bounded receipt
lookup handle carrying a fixed SHA-256 digest of the principal—never the
principal grant, preview, intent, authority, or an outbox. Canonical receipts
must match the exact project-bound
handle, preview, digests, idempotency key, approval, and resulting revision.
Accepted or transport-lost submissions remain explicitly reconcilable across
reload without replay, and settled receipts require an authoritative
projection refresh.

The synthetic and SDK gateways implement the same interface. Synthetic data
must pass through gateway bootstrap, attachment, cursor reduction, mutation,
and receipt recovery rather than being read directly by screens. This makes
the initial slice an executable boundary test instead of a disconnected mockup.
`ProductionMobileProvider` never selects that gateway: recursive source and
emitted-bundle checks reject mock transport from production output.

Before constructing the SDK gateway, the process-wide lifecycle coordinator
requires an origin- and server-identity-bound one-time pairing offer, persists
access and refresh credentials in OS Secure Store, and admits the exact actor,
session scope, actions, limits, revisions, and expiry. It serializes refresh
and revoke, aborts superseded work, and replaces the gateway generation after
credential rotation. Loading, unpaired, pairing, expired/refresh-required,
refreshing, revoking, and recovery-required states expose no operational
gateway.

## Connection state

The connection state and the action authorization are separate. A method being
advertised by the Platform server is not actor authorization.

```text
start/reconnect (mutations false)
        │
        ├── valid cache ───────────────► stale (mutations false)
        │
        └── bootstrap + identity + actor authorization + limits admitted
                                             │
                                             ▼
                                      live (per-action gates)
                                             │
                 ┌───────────────────────────┼───────────────────────────┐
                 │ transport uncertainty     │ cursor gap/conflict       │ contract/identity mismatch
                 ▼                           ▼                           ▼
           reconnecting/stale          stale, resync required      incompatible
           (mutations false)           (mutations false)           (mutations false)
```

Every action requires a live projection, its explicit actor-authorized action,
an exact target revision, and all negotiated limits. Restoring cached data
never restores write authority.

## Read and cursor flow

1. `bootstrap` verifies Platform capabilities, lists actor-visible sessions,
   and reads per-session command state through `MobileSessionClient`; the
   already admitted authorization supplies action and limit projection.
2. Each authorized attachable session is attached through `PlatformClient`.
   A first attachment obtains a sanitized bounded history snapshot; a resumed
   attachment continues from the acknowledged history cursor.
3. History pages name the session, previous cursor, terminal cursor, and
   ordered sequence. The reducer admits exact duplicates but rejects gaps,
   conflicting duplicates, wrong-session pages, excessive pages, and pages
   over the negotiated event ceiling.
4. An admitted cursor becomes the next resume point. A rejected page makes the
   entire projection stale and requires a fresh snapshot; the client does not
   guess across a gap.
5. Timeline events carry `authoritative`, `preview`, `synthetic`, or unknown
   provenance. Unknown kinds stay visible and never imply success.

The server-owned history API emits only the sanitized message, tool-state,
run-state, and explicit unknown-event vocabulary. A typed retention gap becomes
`session_history_resync_required`; mobile replaces the projection from a fresh
bounded snapshot rather than guessing across the missing range.

## Mutation and reconciliation flow

```text
operator confirms action
        │
        ▼
admit live state + exact target + action authority + limits
        │ refusal: no network call
        ▼
generate idempotency key
        │
        ▼
persist bounded reconciliation handle (no command payload)
        │ storage failure: no network call
        ▼
send the exact mutation once
        │
        ├── definitive receipt ──► project outcome ──► remove settled handle
        │
        └── exception or accepted/pending outcome
                              │
                              ▼
       MobileSessionClient.reconcileReceipt by idempotency key
                              │
                  ┌───────────┴───────────┐
                  │ settled               │ still unknown
                  ▼                       ▼
          project + remove handle   retain handle; never replay
```

The persisted handle contains only the action, exact target, and idempotency
key. It is a receipt lookup obligation, not an offline mutation queue. The
follow-up text, approval decision, and stop command are deliberately absent, so
restart recovery cannot resubmit them.

Conflict and resynchronization outcomes make the projection read-only before
another action. A completed follow-up may add a preview/synthetic event until
the server stream confirms it, but its `local:` display cursor never advances
the acknowledged resume cursor and the preview is dropped on restart. The
durable receipt remains visible. An accepted, completed, or unknown follow-up
also persists a fence at the submitted session revision. History replacement,
refresh, and restart cannot lift that fence; only command state for the same
session at a strictly newer lossless revision can do so. Rejected, conflict,
and resync-required outcomes keep the editable draft for review. A completed
approval removes that exact approval; a completed stop clears the exact run
association.

## SDK mapping

| Mobile gateway operation | Canonical SDK methods                                                             | Additional mobile admission                                                                                |
| ------------------------ | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `bootstrap`              | `PlatformClient.capabilities`, `listSessions`; `MobileSessionClient.commandState` | Expected protocol/schema, remote HTTPS transport, stable server identity, actor actions and limits         |
| `attach` and event pages | `PlatformClient.attach`, `sessionHistorySnapshot`, `sessionHistoryPage`           | `attach` action, exact session, cursor grammar, page/event ceilings, ordered sequences                     |
| `followUp`               | `MobileSessionClient.followUp`                                                    | `follow_up` action, exact session revision, non-empty text, negotiated UTF-8 byte ceiling, idempotency key |
| `decideApproval`         | `MobileSessionClient.decideApproval`                                              | `decide_approval` action, exact unexpired approval revision, decision, idempotency key                     |
| `stopRun`                | `MobileSessionClient.stopRun`                                                     | `stop_run` action, exact run revision, idempotency key                                                     |
| `reconcile`              | `MobileSessionClient.reconcileReceipt`                                            | Existing pending key; receipt action and target must match the recorded handle                             |

Screens never receive `PlatformClient`, transport, raw `execute`, provider
credentials, or arbitrary parameters. Detach and control claim/release are not
mobile actions in the first slice.

## Persistence boundaries

| Data                                     | Store                 | Ceiling/lifetime                                                 | Rule                                                           |
| ---------------------------------------- | --------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------- |
| Scoped access and refresh credentials    | OS Secure Store       | Server expiry/rotation/revocation                                | Never Async Storage; pairing proof is never persisted          |
| Endpoint, actor, expiry, server identity | Async Storage profile | One active profile                                               | Metadata only; endpoint must pass HTTPS policy                 |
| Endpoint draft                           | Async Storage         | One draft; 2 KiB                                                 | Re-admitted on load; validation makes no network call          |
| Read projection                          | Async Storage         | 256 KiB; 100 sessions; 1,000 events; 100 approvals; 200 receipts | Schema-admitted and always restored stale/read-only            |
| Workspace companion projection           | Async Storage         | 256 KiB; 8 servers; 64 server and 1,024 object tombstones        | Exact-scope admitted; restored stale with read authority only  |
| Workspace create/resume draft            | Async Storage         | 32 inert typed drafts                                            | Never contains or restores an authority preview                |
| Message draft                            | Async Storage         | One draft per session; negotiated UTF-8 follow-up byte ceiling   | Re-admitted on load; never submitted in the background         |
| Reconciliation handle                    | Async Storage         | 20 handles; 16 KiB encoded set                                   | Action, exact target and key only; never an executable command |

Provider credentials, raw provider/tool output, routing policy, and an offline
mutation queue never cross or live inside the mobile boundary.

## Failure modes

| Failure                                                                    | Required behavior                                                                  |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Cache is corrupt, incompatible, or oversized                               | Remove/ignore it, remain read-only, and attempt a fresh bootstrap independently    |
| Bootstrap or transport fails                                               | Retain only an admitted stale projection; disable every mutation                   |
| Identity, schema, media type, or required SDK method mismatches            | Enter incompatible/read-only state; do not navigate to a writable surface          |
| Server advertises no protocol version this build speaks                    | Refuse admission as `mobile_protocol_unsupported` before exchanging a credential   |
| Page has a gap, conflicting duplicate, wrong session, or exceeds a ceiling | Stop page consumption, mark resynchronization required, and fetch a fresh snapshot |
| Unknown event or outcome arrives                                           | Preserve it as unknown; never convert it to success                                |
| Handle persistence fails before mutation                                   | Do not send the mutation                                                           |
| Mutation response is lost                                                  | Call receipt reconciliation with the same key; never call the mutation again       |
| Receipt remains unknown                                                    | Keep the bounded handle for later reconciliation and remain conservative in the UI |
| Follow-up may have applied but session revision has not advanced           | Persist the exact revision fence; keep mutations disabled and never replay         |
| Receipt action/target differs from the recorded command                    | Reject it as a contract violation; do not project it                               |
| Conflict or resync-required receipt arrives                                | Make the projection stale/read-only before another action                          |

## Cross-repository dependencies

- [Automonique #112](https://github.com/bext-stack/automonique/issues/112)
  owns the end-to-end mobile epic. Its scoped authentication, pairing,
  refresh/revocation, endpoint identity, authorization, history, commands, and
  testing-fixture contracts are implemented; registry publication and combined
  hands-on accessibility evidence remain external gates.
- [Automonique #113](https://github.com/bext-stack/automonique/issues/113)
  records the original canonical TypeScript Platform client and distribution
  repair. The mobile app consumes the CI-verified packed SDK archive until an
  authorized public registry release exists.
- [Automonique #164](https://github.com/bext-stack/automonique/issues/164)
  delivered the retained-session Rust client helpers in Automonique PR #171.
  It did not change the TypeScript SDK's deterministic fixture from the source
  commit already vendored here, so that fixture remains sufficient for mobile's
  cursor-independence and ambiguous-receipt parity tests; #164 alone does not
  require a re-vendor.
- [Automonique Mobile #32](https://github.com/bext-stack/automonique-mobile/issues/32)
  delivered the scheduled/manual SDK schema-drift signal in PR #36. The current
  informational digest difference is tracked by
  [#37](https://github.com/bext-stack/automonique-mobile/issues/37); it does not
  itself grant authority, prove incompatibility, or require this change to
  re-vendor the SDK.
- This repository owns the narrow mobile gateway, SDK adapter, persistence and
  reconciliation policy, screens, native behavior, and mobile verification.

Compatibility with a server is negotiated on the mobile protocol major version;
the vendored schema digest is recorded provenance and is never compared against
a server. Both rules are stated in [decisions.md](decisions.md) and covered by
`src/core/negotiation.test.ts`, `src/core/server-connection.test.ts` and
`src/core/mobile-lifecycle.test.ts`.

The re-vendored canonical SDK completes the multi-version discovery work from
[Automonique #149](https://github.com/bext-stack/automonique/issues/149).
`MobileLifecycleClient.discover` now admits bounded ordered advertisements and
the generated mobile protocol domain supports versions 1 through 2. Mobile
selects the highest shared version and ignores versions above this build's
ceiling; an empty, repeated, malformed, or non-overlapping offer still fails
closed.

The server contracts and production composition root are implemented and
verified by automated Rust-to-TypeScript, mobile, and bundle gates. An
authorized non-production endpoint and one-time pairing ceremony are still
required to establish live acceptance; EAS artifacts, device accessibility,
and release evidence remain separate gates.
