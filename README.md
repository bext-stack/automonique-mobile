# Automonique Mobile

Official iOS and Android operator client for Automonique. The app is a thin,
fail-closed consumer: it never embeds an agent runtime, provider credentials,
routing policy, privileged tools, direct database access, or an alternative
authority model.

## Current implementation

The checked-in application has a production networking path backed by the
canonical Automonique SDK. The production composition root starts unpaired and
keeps operational navigation unavailable until an operator supplies a
short-lived, one-time pairing offer for an exact HTTPS origin. Discovery and
pairing pin the server identity; issued access and refresh credentials are
stored in OS Secure Store, while non-secret connection metadata is kept
separately. Expiry, rejected authorization, refresh uncertainty, revocation,
and identity or contract mismatches return the app to a fail-closed,
non-writable lifecycle state.

After successful admission, the SDK gateway consumes the server-authorized
actor, session scope, actions, limits, sanitized resumable history, and receipt
state. The operator shell exposes a workload overview, filterable sessions,
typed workspace discovery, pending approvals, sanitized activity plus durable
receipts, and the server/access scope. Screens expose only bounded session discovery and
attachment, exact-session follow-up, exact-run stop, approval decisions, and
receipt reconciliation. They never receive generic Platform execution authority.
Deterministic synthetic gateways remain test fixtures and are excluded from
the production source graph and emitted bundles.

Phone pairing supports selected conversations or an explicit administrator
scope covering all current and future conversations on that Monique instance.
The dashboard displays a QR code and offers a PNG download; both expire after
five minutes and work once. Administrator scope requires a fresh invite with
`all_sessions`, keeps task creation and ticket management separate, and does
not upgrade existing credentials. This app version understands that grant and
shows it in Settings; older builds must be updated before pairing as admin.

Pair from **Settings → Scan or import QR code**: photograph the code on another
screen or select the PNG downloaded from Monique. Image import uses the system
picker and does not require camera permission. Review the server address before
connecting; expired invites are cleared and must be renewed on the website.
Scanning an invite does not mark its server verified; pairing checks the pinned
identity and protocol before exchanging the one-time secret.

The vendored SDK also includes the canonical Platform v2 client. The
credential lifecycle constructs its exact `/api/platform/v2` HTTPS transport,
renegotiates it per credential generation, and exposes bounded project reads,
lineage, read-only review, lifecycle preview/confirmation, and exact intent
cancellation behind a narrow companion gateway. Production workspace screens
join only typed project/host/checkout/workspace relations, bound detail fanout,
report partial coverage, preserve a read-only multi-server cache and exact
revision drafts, and admit review destinations only from current review data.
Retained-chat links keep the typed work-session relation separate from its v1
session target and bind both through the tenant, authorization revision,
principal generation, workspace revision, relation revision, and target
revision before handing off to the session screen.
They remain fail-closed until the dedicated server endpoint issues a delegated
Platform v2 principal binding the bearer to server-owned tenant/actor,
credential identity and revisions, generation, expiry, exact project roots,
and per-operation actions. The lifecycle strictly admits and persists that
document with the secure credential generation; refresh retrieves its rotated
generation. Mobile never translates its bearer into Basic or derives authority
from a session, label, or external task. Create/resume, terminal relay,
concurrent active multi-server credentials, and live acceptance remain separate
work.

The connection screen is a self-host onboarding flow rather than a fixture
selector: it checks an existing server's public mobile discovery contract,
shows actionable reverse-proxy failures, accepts a pairing invite by QR scan,
image import, or strict paste, displays the pinned origin and server identity for confirmation,
and only then performs the one-time exchange. See
[Connect an existing Automonique server](docs/connect-existing-server.md) for
the routes, media type, scoping request, ingress constraints, and
troubleshooting path.

This implementation has passed automated SDK, lifecycle, security, native
policy, test, and Android/iOS/web export gates. The mobile SDK gateway has also
read the configured Slack channel and ticket queue against an authorized live
server, with rejected unauthorized requests and subsequent credential
revocation verified. Ticket mutations were tested with an isolated Manage
fixture, including a lost-response retry. This does not establish physical-device
acceptance or an app-store release. The public Android preview has its own
build and publication evidence below.

## Start and continue tasks

Open **Sessions → Run a task** to ask Monique to create files, execute scripts,
or investigate a problem. The phone must be paired with the dashboard's explicit
**Allow this phone to start tasks** permission. Existing pairings keep their
current permissions; create a new invitation and pair again to enable this.

The app persists receipt coordinates before sending a task, checks status after
an interrupted response, and never queues task text or automatically resubmits.
Only the initiating device receives access to the resulting session. Open that
session to read retained history and send follow-ups after the live host exits.
Tasks use the server's isolated workspace for each turn; repository delivery
continues through the existing ticket workflow. A task submission receipt does
not by itself prove the requested work succeeded; check its session output.

## Slack and ticket queues

The **Work** tab reads the server-configured Slack channel and lists that
instance’s GitHub-linked Monique ticket queue. Enable the dashboard’s explicit
Slack and ticket permission when pairing. You can then submit a ticket, approve
its pending gate, or reject it with a reason. These controls require a live
connection and a confirmation; interrupted requests retain their original key
for an explicit retry. The server must support `/api/mobile/work` and configure
its channel binding. Existing phone credentials gain no new permissions.

## Public Android preview

Download the immutable
[Automonique Mobile 0.1.0-preview.6 APK](https://www.automonique.fr/downloads/android/0.1.0-preview.6/63a8ae79952032b09f3a318eb5db2e4cb5f97c4703849924cb69d70b7405e775/automonique-mobile-0.1.0-preview.6.apk).

SHA-256: `63a8ae79952032b09f3a318eb5db2e4cb5f97c4703849924cb69d70b7405e775`

The adjacent [publication record](https://www.automonique.fr/downloads/android/0.1.0-preview.6/63a8ae79952032b09f3a318eb5db2e4cb5f97c4703849924cb69d70b7405e775/publication.json) connects these
exact bytes to protected `main`, retained GitHub Actions run
[`37052371352`](https://github.com/bext-stack/automonique-mobile/actions/runs/37052371352),
the GitHub artifact attestation, packaged manifest, ABIs, debug-only signer,
toolchains, and dependency notices.

This is a public, credential-free, non-production Android preview for
evaluation. Its universal package contains at least `arm64-v8a` and `x86_64`.
It is not evidence of an authorized live Automonique connection,
physical-device support, production signing, app-store readiness, or deployment
of Automonique itself. See the
[preview publication gates](docs/release-governance.md#authorized-android-preview-publication).

The earlier
[0.1.0-preview.2 path](https://www.automonique.fr/downloads/android/0.1.0-preview.2/4c7b7fac529c8060ecc84691b00156c1fc42989c86adab467cdf9f43e959b353/automonique-mobile-0.1.0-preview.2.apk)
stays published and unchanged; a preview path is never overwritten or
redirected. The synthetic TalkBack traversal recorded for preview.1 was not
repeated for preview.2 through preview.6 and does not cover those versions.

## Requirements

- Node.js 24 LTS
- npm 11
- Expo SDK 57
- React Native 0.86.3 and React 19.2

```sh
npm ci
npm run validate
npm start
```

`npm run validate` verifies the pinned SDK, generated notices, native transport
policy, dependency severity, TypeScript, ESLint, Jest, Prettier, Expo Doctor,
and Android/iOS/web exports. Native EAS profiles are in `eas.json`; successful
local exports do not claim that signed device binaries or store releases exist.

## Safety properties

- Production endpoints require HTTPS; Android cleartext traffic is disabled.
- Server checks use credential-free discovery; camera access is used only while
  scanning a pairing QR code, and scanned offers are never persisted.
- Scoped access and refresh credentials are stored only with
  `expo-secure-store`; one-time pairing proofs are never persisted.
- Async Storage contains bounded cached reads, endpoint and message drafts,
  and the exact pending ticket request for explicit recovery. It stores no
  credentials, and pending requests are never sent automatically.
- Screens receive only the narrow `MobileAutomoniqueGateway`; they cannot issue
  arbitrary Platform `execute` requests.
- Every mutation names an exact target revision and idempotency key. Ambiguous
  writes reconcile by key instead of being blindly replayed.
- A stale, incompatible, or reconnecting projection is read-only.

See the [product definition](docs/product.md),
[architecture](docs/architecture.md), [decisions](docs/decisions.md),
[delivery backlog](docs/backlog.md), and [roadmap](docs/roadmap.md). Security
reports follow [SECURITY.md](SECURITY.md); native build, signing, and rollback
controls follow [release governance](docs/release-governance.md).

## License

Product code is licensed under the Elastic License 2.0. Third-party packages
retain their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
