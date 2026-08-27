# Product and architecture decisions

## Thin client authority

The mobile app cannot run providers, execute shell commands, access SQLite, or
choose routing policy. Authority remains with the Automonique server.

## No generic mutation API in screens

The UI receives high-level follow-up, approval-decision, exact-run-stop, and
receipt-reconciliation methods only. This keeps new Platform actions from
silently becoming mobile capabilities.

## No offline mutation queue

Connectivity loss immediately disables mutations. Drafts survive locally, but
the operator must submit after a fresh capability and revision check. An
ambiguous request is reconciled by idempotency key and is not blindly retried.

## Workspace visibility is not execution authority

The workspace companion admits only server-scoped, revocable read profiles.
Repository and branch values are display labels, never local paths or an
invitation to infer Git operations. External work-item status and Automonique
orchestration status remain separate typed values.

Create/resume uses the canonical Platform v2 lifecycle client. A server preview
echoes the exact admitted request, parent revisions, inherited ceiling,
effective authority, expiry, and idempotency key. It remains ephemeral and
single-use; a distinct confirmation action is required, and a submit outcome
forces an authoritative refresh instead of manufacturing local success.
Task-prefilled create/resume and cancellation use the typed lineage intent
surface. Cancellation names the exact project, workspace, durable revision,
new intent ID, and target intent ID.
Deep links use a finite internal destination vocabulary and exact workspace
and retained-session revisions. Server omission or revocation persists a
bounded identity/tenant/origin/authorization-revision tombstone.
Workspace, attempt, and session omission persists bounded per-ID revision
tombstones, so a later equal or older object cannot bypass rollback detection.
Terminal requires both a workspace navigation grant and a separate live
`terminal_relay` actor action; neither workspace visibility nor cached
authority can supply it.

Platform v2 inventory queries require an exact project root. The current mobile
authorization schema grants sessions but not project roots, so the app refuses
to infer a root from a label, retained session, external issue, or method
presence. The authenticated gateway is production-ready but remains unreachable
from workspace screens until a server-issued, revocable project-root grant is
admitted.

## Exact decimal revisions

Revisions and event sequences are validated canonical decimal strings in the
mobile model. Arithmetic converts them to `bigint` transiently, preventing
precision loss across React Native JavaScript engines.

## Follow-up revision fence

An accepted, completed, or unknown follow-up may have changed authoritative
session state. Mobile records the exact submitted session revision in the
bounded projection, disables subsequent mutation, and keeps the fence through
restart and history resynchronization. Only a fresh command-state projection
whose session revision is strictly greater clears it. A refresh at the same or
an older revision cannot manufacture write authority.

Rejected, conflict, and resync-required receipts leave the draft intact so the
operator can review it after freshness is restored. A possibly applied outcome
clears the draft because the reconciliation store intentionally contains no
command payload and must never act as a replay queue.

## Production networking gate

The canonical SDK transport is necessary but not sufficient. Navigation to a
live surface also requires server identity plus actor-scoped actions and limits.
Method presence alone never grants authority.

## Server compatibility is negotiated on the protocol version

Admission negotiates on the mobile protocol major version the server advertises
in `supported_versions`. A server is admitted when what it advertises overlaps
the range this build supports, and the highest version in that overlap is the
one used. A version above this build's ceiling is ignored rather than treated
as a refusal, so a published build keeps working against a server that has
moved on. No overlap is `mobile_protocol_unsupported`, and pairing refuses it
before any credential is exchanged.

The range this build supports is read from the vendored SDK's own generated
bounds (`MobileProtocolVersion_MIN`/`_MAX`), so re-vendoring an SDK that widens
the protocol widens the app in the same step and no hand-kept constant can
drift from the archive that is installed.

## The vendored schema digest is evidence, not a gate

`schemaDigest` in `vendor/automonique-sdk.json` records which generated
protocol surface the vendored archive was built from. It is verified at build
time by `npm run sdk:verify` against the archive, the installed package and the
SDK's runtime constant, and it is displayed in Settings so an operator can
report exactly what a build speaks.

It is never compared against the server. The server does not advertise a
digest, so equality is not even expressible; and the digest fingerprints the
whole generated surface — daemon administration, automation and progress
included — not the mobile subset this app speaks. Gating on it would refuse a
server over changes the app cannot observe. Automonique #133 is the worked
example: it moved the digest from `sha256:3e58e47e…` to `sha256:183a1131…`
while `platform.ts` and `mobile-auth.ts`, the only generated modules the mobile
client uses, stayed byte-identical.

Automonique #149 widened the canonical SDK so a server may advertise multiple
bounded versions. This archive supports mobile protocol versions 1 through 2
and selects the highest shared version without using schema-digest equality.

The consequence is deliberate: a server change does not require a mobile
re-vendor and a new build. A re-vendor is required when the mobile protocol
surface itself changes, and that shows up as a protocol version the app must
learn to speak, not as a digest that moved.

`npm run sdk:drift` makes movement visible without turning it into a gate. A
scheduled weekday workflow runs the same bounded comparison, reuses one marked
GitHub issue while drift exists, and closes that issue after the vendored digest
catches up. Unrelated Automonique commits do not churn the issue because the
comparison resolves the latest commit that changed the SDK package metadata.
The current signal is tracked in
[Automonique Mobile #37](https://github.com/bext-stack/automonique-mobile/issues/37);
it is schema-digest review evidence, not a claim that this retained-session
change needs a different SDK archive.
