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
Omitted workspaces, attempts, and sessions likewise leave bounded per-ID
revision tombstones. Reintroducing one requires a strictly newer object
revision, including after server revocation and reauthorization.

Cached catalogs reopen as stale. Active authorization becomes `cached`, and
all actions except bounded reads are removed. Cached data may navigate to
retained read surfaces, but it cannot create/resume work or open a terminal.
Drafts remain inert data. Authority previews are never cached.

## Expansion decisions

| Expansion beyond the original non-goals                                                            | Decision                                                                                       | Required control                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Multi-server cockpit                                                                               | Approved for bounded reads                                                                     | At most eight profiles; each exact, scoped, revocable server identity is admitted independently. No ambient host discovery.                                                                        |
| Host, project, task, workspace, attempt, branch, repository, freshness, and attention presentation | Approved for sanitized reads                                                                   | Strict DTO keys, ceilings, referential scope checks, HTTPS-only repository links, and no host path or credential field.                                                                            |
| External task integration                                                                          | Approved for display and task prefill                                                          | External work-item status is a separate type and field from Automonique orchestration state. It grants no host/workspace authority.                                                                |
| Workspace creation and resume                                                                      | Approved through typed task intents or an ephemeral lifecycle preview                          | The canonical v2 SDK binds exact request coordinates, revisions, authority ceiling, expiry, and idempotency. Confirmation is separate and single-use. No generic execute method or offline outbox. |
| Deep links to retained chat, files, preview, and source control                                    | Approved for explicitly granted exact workspace revisions                                      | Retained chat also binds the exact session revision. Routes are internal typed destinations, not arbitrary URLs or filesystem paths. Cached routes are read-only.                                  |
| Terminal relay                                                                                     | Refused by workspace visibility; conditionally approvable in a separate risk-reviewed delivery | Requires an exact workspace navigation grant, active live profile, and separate `terminal_relay` actor action. No terminal transport is implemented here.                                          |
| Attachments and audio uploads                                                                      | Refused in this issue                                                                          | Separate data-retention, content-scanning, size, privacy, and transport review required.                                                                                                           |
| Dictation as capability expansion                                                                  | Refused                                                                                        | Existing on-device dictation may edit text locally only; it does not add an upload or action.                                                                                                      |
| Background mutation or offline queue                                                               | Refused                                                                                        | Connectivity loss disables mutations. Draft restoration never submits work.                                                                                                                        |
| Shell, repository mutation, provider credentials, routing, or privileged tools                     | Refused                                                                                        | These capabilities cannot be represented or inferred by the mobile workspace model.                                                                                                                |

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
- Omitting a workspace, attempt, or session cannot erase its revision fence;
  an equal or older reintroduction forces resynchronization.
- Terminal navigation is refused even when visible in a workspace unless both
  live profile authority and a separate terminal action are present.
- Oversized catalogs, session collections, unread counts, drafts, and encoded
  caches are rejected or deterministically bounded.
- A cached or offline profile cannot recover mutation authority from its prior
  live state.

## Deferred evidence

The production lifecycle now constructs the re-vendored canonical Platform v2
gateway and its authenticated, generation-fenced transport. Automated tests
cover negotiation, bounded paging, refusal/downgrade/resync, malformed input,
authorization loss, preview expiry/replay/app reload, explicit confirmation,
and exact lineage cancellation. End-to-end project discovery and multi-server
UI remain blocked because the server-issued mobile authorization document does
not yet carry an exact project-root grant. Terminal relay, live acceptance, and
device evidence remain separate work.
