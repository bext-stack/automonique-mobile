# Architecture

Automonique Mobile is a presentation client, not an execution node. The server
owns identity, authority, policy, execution, canonical history, and mutation
outcomes.

## System boundary

```text
screens
   │ high-level reads and actions only
   ▼
MobileProvider / vertical-slice controller
   │
   ├── MobileAutomoniqueGateway ──┬── createMockGateway
   │                              │     deterministic synthetic contract
   │                              └── SDK mobile adapter
   │                                    │
   │                                    ▼
   │                              @automonique/sdk
   │                                    │ canonical Platform v1 over HTTPS
   │                                    ▼
   │                              Automonique server
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

The synthetic and SDK gateways implement the same interface. Synthetic data
must pass through gateway bootstrap, attachment, cursor reduction, mutation,
and receipt recovery rather than being read directly by screens. This makes
the initial slice an executable boundary test instead of a disconnected mockup.

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

1. `bootstrap` returns the bounded session, approval, receipt, authorization,
   and limit projection.
2. Each authorized attachable session is attached through the gateway.
3. Event pages name the session, previous cursor, next cursor, and ordered
   sequence. The reducer admits exact duplicates but rejects gaps, conflicting
   duplicates, wrong-session pages, excessive pages, and pages over the
   negotiated event ceiling.
4. An admitted cursor becomes the next resume point. A rejected page makes the
   entire projection stale and requires a fresh snapshot; the client does not
   guess across a gap.
5. Timeline events carry `authoritative`, `preview`, `synthetic`, or unknown
   provenance. Unknown kinds stay visible and never imply success.

The current Platform resource subscription can prove the cursor and resource
update boundary, but rich sanitized conversation/tool history remains a server
dependency tracked in Automonique #112.

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
                  get receipt by idempotency key
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
durable receipt remains visible. A completed approval removes that exact
approval; a completed stop clears the exact run association.

## SDK mapping

| Mobile gateway operation | Canonical SDK methods                      | Additional mobile admission                                                                                |
| ------------------------ | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `bootstrap`              | `capabilities`, `listSessions`, `snapshot` | Expected protocol/schema, remote HTTPS transport, stable server identity, actor actions and limits         |
| `attach` and event pages | `attach`, `subscribe`                      | `attach` action, exact session, cursor grammar, page/event ceilings, ordered sequences                     |
| `followUp`               | `execute` with `follow_up`                 | `follow_up` action, exact session revision, non-empty text, negotiated UTF-8 byte ceiling, idempotency key |
| `decideApproval`         | `execute` with `decide_approval`           | `decide_approval` action, exact unexpired approval revision, decision, idempotency key                     |
| `stopRun`                | `execute` with `stop_run`                  | `stop_run` action, exact run revision, idempotency key                                                     |
| `reconcile`              | `getReceipt`                               | Existing pending key; receipt action and target must match the recorded handle                             |

Screens never receive `PlatformClient`, transport, raw `execute`, provider
credentials, or arbitrary parameters. Detach and control claim/release are not
mobile actions in the first slice.

## Persistence boundaries

| Data                                     | Store                 | Ceiling/lifetime                                                 | Rule                                                           |
| ---------------------------------------- | --------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------- |
| Scoped mobile credential                 | OS Secure Store       | Server expiry/revocation                                         | Never Async Storage; device-only accessibility                 |
| Endpoint, actor, expiry, server identity | Async Storage profile | One active profile                                               | Metadata only; endpoint must pass HTTPS policy                 |
| Endpoint draft                           | Async Storage         | One draft; 2 KiB                                                 | Re-admitted on load; validation makes no network call          |
| Read projection                          | Async Storage         | 256 KiB; 100 sessions; 1,000 events; 100 approvals; 200 receipts | Schema-admitted and always restored stale/read-only            |
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
| Page has a gap, conflicting duplicate, wrong session, or exceeds a ceiling | Stop page consumption, mark resynchronization required, and fetch a fresh snapshot |
| Unknown event or outcome arrives                                           | Preserve it as unknown; never convert it to success                                |
| Handle persistence fails before mutation                                   | Do not send the mutation                                                           |
| Mutation response is lost                                                  | Call receipt reconciliation with the same key; never call the mutation again       |
| Receipt remains unknown                                                    | Keep the bounded handle for later reconciliation and remain conservative in the UI |
| Receipt action/target differs from the recorded command                    | Reject it as a contract violation; do not project it                               |
| Conflict or resync-required receipt arrives                                | Make the projection stale/read-only before another action                          |

## Cross-repository dependencies

- [Automonique #112](https://github.com/bext-stack/automonique/issues/112)
  owns the end-to-end mobile epic and the missing server contracts: scoped
  authentication, refresh/revocation, endpoint discovery, stable identity,
  actor authorization, limits, and sanitized remotely resumable history.
- [Automonique #113](https://github.com/bext-stack/automonique/issues/113)
  owns the canonical TypeScript Platform client, generated codecs, package
  boundary, live Rust contract tests, and longer-term removal of remaining
  handwritten request encoding.
- This repository owns the narrow mobile gateway, SDK adapter, persistence and
  reconciliation policy, screens, native behavior, and mobile verification.

The SDK transport can be packaged and bundled before the #112 server contracts
exist. A production connection must remain unavailable until those contracts
are implemented and verified; a transport constructor alone is not authority.
