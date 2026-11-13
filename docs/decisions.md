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
Retained chat carries both the typed Platform v2 work-session relation ID and
the distinct Platform v1 target ID; neither may be substituted for the other.
The route also binds tenant, principal generation, and authorization revision,
then rechecks the same scope after its handoff to the session screen.
Workspace, attempt, and session omission persists bounded per-ID revision
tombstones, so a later equal or older object cannot bypass rollback detection.
Terminal requires both a workspace navigation grant and a separate live
`terminal_relay` actor action; neither workspace visibility nor cached
authority can supply it.

Platform v2 inventory queries require an exact project root and every operation
requires its own v2 action. A dedicated versioned server response binds the
mobile bearer to server-owned tenant/actor, server and credential identity,
revisions, generation, expiry, sorted project roots, and sorted per-operation
actions. The credential lifecycle admits and stores that response in the
secure generation and refreshes it after token rotation. Mobile never converts
a bearer into Basic. Missing, malformed, stale, or ungranted responses leave
the workspace gateway unavailable; production UI/cache integration and live
acceptance remain independent work.

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

Accepted, unknown, rejected, conflict, and resync-required review outcomes leave
the confirmation and draft intact while the durable handle is reconciled or a
terminal result is inspected. Only a final completed review receipt clears the
draft. The reconciliation store intentionally contains no command payload and
can never act as a replay queue.

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

## Live pairing QR scanning

Camera pairing uses an app-local Expo module with a native live scanner. Android
uses `com.journeyapps:zxing-android-embedded:4.3.0` and
`com.google.zxing:core:3.5.3` (Apache-2.0), with autofocus, a portrait camera
preview, QR-only detection, and no saved barcode image. It does not require an
external scanner app, Google Play Services, or an ML Kit model download. iOS
uses Apple's VisionKit `DataScannerViewController`, restricted to QR codes.
Unsupported iOS hardware and web keep image import and invite paste available.

The camera permission is requested only when the operator chooses live scanning.
Cancellation releases the native camera and late results are ignored. Native
results are handed to the same bounded pairing-offer validation and server
review as image import and paste; scanning never connects automatically. Images
are decoded locally only for the explicit saved-image import fallback.

Keep the existing ban on Expo Camera / ML Kit dependencies and the Maven
license gate. The app-local module must be autolinked into a fresh native build;
a JavaScript-only update cannot enable it in an older installed APK. Physical
camera acceptance on Android and supported iOS hardware is still required.

## Live calls with persona agents

On 12 November 2026 the owner chose live, hands-free voice calls with
persistent agents over the earlier position that the microphone only fills a
reviewable draft. Three first-slice non-goals change, each narrowly:

- **Audio leaves the device, during a call only.** Frames go to the paired
  server over the call socket and from there to the server's speech provider.
  Dictation is unchanged: it stays on-device and still only fills a draft.
- **A spoken utterance is sent without review, as a follow-up only.** The
  server delivers it through the same follow-up contract a typed message uses,
  bound to the session's current revision. There is no spoken approval,
  denial or stop; those keep their on-screen confirmation.
- **Call audio runs in the background.** Nothing else does. There is still no
  offline queue, background mutation or automatic reconnect.

The phone never holds agent authority. `call_agent` lets it list registered
agents, open an agent's single long-lived session and request a single-use
call ticket; registering agents and editing personas stay on the server. The
ticket, not the credential, is what the call socket sees, so no bearer token
is sent on a WebSocket. The call engine admits only the paired HTTPS origin
and a path under `/api/mobile/`.

## Signing in with an account

On 13 November 2026 the owner asked for account sign-in beside QR pairing, so
a phone gains or changes access without an operator creating an invite each
time. The first slice is deliberately narrow:

- **Sign-in is a second way to an invite, not a second credential.** The
  server runs the account flow and answers with the same one-time pairing
  offer a QR code carries. Exchange, refresh, revocation and secure storage
  are unchanged, and QR pairing still works.
- **The app holds no account token.** It opens the paired server's
  `/api/mobile/signin/start` in the system browser and never sees the
  provider's code or ID token. Which accounts are admitted is the server
  operator's list.
- **The return link alone is worth nothing.** `automonique://signin` is a
  custom scheme another app could claim, so it carries a single-use grant
  that is redeemed only with a verifier generated for this attempt and kept
  in memory. The server saw only its SHA-256 digest. A cold start loses the
  verifier and the person starts again.
- **The offer must be for the chosen server.** The app refuses an offer whose
  origin differs from the server it opened the browser for.

Non-goals for this slice: per-account tenant or site scoping, showing the
signed-in account in the app, and signing in to the dashboard itself.
