# Workspace companion threat model

Issue #34 expands the visible mobile domain beyond the historical single-server
session slice. It does not expand where execution authority lives. The remote
Automonique server still owns tenant scope, host and project visibility,
workspace lifecycle, repository operations, terminal access, and canonical
status.

## Protected assets and trust boundaries

The phone may retain sanitized display names, external work-item references,
workspace and attempt state, session references, branch/repository labels,
freshness, unread counts, and task-prefill drafts. Credentials remain in OS
Secure Store. Host filesystem paths, environment variables, provider output,
repository credentials, shell commands, terminal data, and mutation payloads
must never enter the companion DTO or cache.

Every admitted record is bound to one stable server identity and its tenant.
Hosts, projects, workspaces, attempts, sessions, navigation grants, and
authority previews are server-issued scoped data. A display label, origin,
workspace, repository, branch, or SDK method cannot create authority. Profile
selection uses the exact server identity; revocation removes the profile from
selection and presentation. A bounded persisted tombstone pins that identity
to its tenant and HTTPS origin after omission or revocation; reauthorization
requires a strictly newer authorization revision.
The delegated Platform v2 grant must also expire at exactly the same millisecond
as its enclosing current Platform v1 credential authorization. A shorter or
longer delegated lifetime makes the lifecycle recovery-required and exposes no
operational workspace or session gateway.
Omitted workspaces, attempts, and sessions likewise leave bounded per-ID
revision tombstones. Reintroducing one requires a strictly newer object
revision, including after server revocation and reauthorization.

Cached catalogs reopen as stale. Active authorization becomes `cached`, and
all actions except bounded reads are removed. Cached workspace data never
enters the generic session route: retained chat must first be revalidated
against the current lifecycle server, authorization and principal generation,
full v1 coordinate, and exact v1 target revision. Review-backed files,
previews, source control, every mutation, and terminal require a current live
grant. Drafts remain inert data in a 32-entry index keyed by exact server,
authorization revision, workspace, and workspace revision. Prior draft schemas
are discarded rather than migrated across authority generations, and all
generations for a server are purged with its revocation. Authority previews are
never cached.

## Expansion decisions

| Expansion beyond the original non-goals                                                            | Decision                                                                                       | Required control                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Multi-server cockpit                                                                               | Approved for bounded reads                                                                     | At most eight profiles; each exact, scoped, revocable server identity is admitted independently. No ambient host discovery.                                                                           |
| Host, project, task, workspace, attempt, branch, repository, freshness, and attention presentation | Approved for sanitized reads                                                                   | Strict DTO keys, ceilings, referential scope checks, HTTPS-only repository links, and no host path or credential field.                                                                               |
| External task integration                                                                          | Approved for display and task prefill                                                          | External work-item status is a separate type and field from Automonique orchestration state. It grants no host/workspace authority.                                                                   |
| Workspace creation and resume                                                                      | Approved through typed task intents or an ephemeral lifecycle preview                          | The canonical v2 SDK binds exact request coordinates, revisions, authority ceiling, expiry, and idempotency. Confirmation is separate and single-use. No generic execute method or offline outbox.    |
| Deep links to retained chat, files, preview, and source control                                    | Approved for explicitly granted exact workspace revisions                                      | Retained chat binds the full v1 coordinate and exact target revision to the current server and principal generation. Cached workspace data stays visible, but chat waits for live scope revalidation. |
| Terminal relay                                                                                     | Refused by workspace visibility; conditionally approvable in a separate risk-reviewed delivery | Requires an exact workspace navigation grant, active live profile, and separate `terminal_relay` actor action. No terminal transport is implemented here.                                             |
| Attachments and audio uploads                                                                      | Refused in this issue                                                                          | Separate data-retention, content-scanning, size, privacy, and transport review required.                                                                                                              |
| Dictation as capability expansion                                                                  | Refused                                                                                        | Existing on-device dictation may edit text locally only; it does not add an upload or action.                                                                                                         |
| Background mutation or offline queue                                                               | Refused                                                                                        | Connectivity loss disables mutations. Draft restoration never submits work.                                                                                                                           |
| Shell, repository mutation, provider credentials, routing, or privileged tools                     | Refused                                                                                        | These capabilities cannot be represented or inferred by the mobile workspace model.                                                                                                                   |

## Abuse cases and fail-closed outcomes

- A forged profile label or origin cannot select a server; only the exact
  admitted server identity can. Reusing that identity with a different tenant
  or origin, or replaying it after a tombstone, forces resynchronization.
- A revoked identity cannot be selected, searched, or navigated.
- A workspace referencing a host or project outside its server profile is
  rejected as one invalid catalog.
- Unknown fields such as credentials, host paths, commands, or raw provider
  output make admission fail rather than being ignored.
- A stale workspace/session revision, missing destination grant, or unscoped
  retained session refuses a deep link.
- A retained-session deep link names both its work-session relation and its
  retained v1 target. It also names the exact tenant, authorization revision,
  and principal generation; an ID collision across either relation, tenant, or
  generation is refused at the handoff and again at the session screen.
- A nested attention record cannot supply a session route by display text. Its
  exact typed lineage attempt and work-session origin must match the same live
  Platform v2 binding and a current retained v1 target under the selected
  server identity.
- Omitting a workspace, attempt, or session cannot erase its revision fence;
  an equal or older reintroduction forces resynchronization.
- Terminal navigation is refused even when visible in a workspace unless both
  live profile authority and a separate terminal action are present.
- Oversized project, host, workspace, retained-session, and detail inventories
  are linearly and deterministically bounded before strict DTO admission. Each
  omission class is reported separately and makes coverage partial. Unread
  counts, drafts, and encoded caches are likewise rejected or bounded.
- Revocation fences the exact server authorization generation and aborts its
  active workspace operations synchronously. Durable workspace cleanup failure
  is surfaced but cannot prevent the lifecycle's remote-first credential
  revoke; simultaneous failures are reported together.
- A cached or offline profile cannot recover mutation authority from its prior
  live state.
- Durable v2 receipt lookup handles contain only a fixed SHA-256 principal
  binding and exact receipt coordinates. A bounded non-authority index uses a
  stable server-identity/credential-ID/delegation-ID digest to retain handles
  across same-delegation token rotation. A regrant changes that family, so
  prior-delegation handles are neither listed nor queried; current action and
  project grants filter every recovery surface. Legacy authorization-digest
  handles are migrated before remote rotation using only the exact old admitted
  secure grant and into only its old delegation family; no cross-family key scan
  is permitted. If the app cold-starts after expiry, only fixed receipt-migration
  coordinates survive beside the refresh credential; the expired authority is
  withheld from the gateway. Malformed optional migration state is discarded
  without destroying an otherwise valid refresh path. Project roots, action
  grants, tenant and actor metadata,
  previews, intents, and replayable payloads are excluded; the complete encoded
  set is capped at 16 KiB.

## Deferred evidence

The production lifecycle now constructs the re-vendored canonical Platform v2
gateway and its authenticated, generation-fenced transport. The production
provider consumes typed project graphs and bounded lineage/review details into
a durable, revision-fenced catalog; screens expose discovery, exact retained
chat, and current review-backed destinations without a generic transport.
Automated tests
cover negotiation, bounded paging, refusal/downgrade/resync, malformed and
future grants, authorization loss and generation races, preview
expiry/replay/app reload, exact approval decisions, durable receipt lookup
without replay, generation-fenced local persistence, explicit confirmation,
project ancestry, exact lineage cancellation, dedicated bearer-grant
admission/persistence, receipt discovery across rotation, typed relation joins,
bounded partial coverage, offline cache behavior, and revocation tombstones.
The current secure lifecycle still holds only one active server credential at a
time, and live acceptance has not run. Terminal relay and device evidence remain
separate work.
