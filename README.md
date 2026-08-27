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
state. A five-tab operator shell exposes a workload overview, filterable
sessions, pending approvals, sanitized activity plus durable receipts, and the
server/access scope. Screens expose only bounded session discovery and
attachment, exact-session follow-up, exact-run stop, approval decisions, and
receipt reconciliation. They never receive generic Platform execution authority.
Deterministic synthetic gateways remain test fixtures and are excluded from
the production source graph and emitted bundles.

The vendored SDK also includes the canonical Platform v2 client. The
credential lifecycle constructs its exact `/api/platform/v2` HTTPS transport,
renegotiates it per credential generation, and exposes bounded project reads,
lineage, read-only review, lifecycle preview/confirmation, and exact intent
cancellation behind a narrow companion gateway. Production workspace screens
remain fail-closed until the dedicated server endpoint issues a delegated
Platform v2 principal binding the bearer to server-owned tenant/actor,
credential identity and revisions, generation, expiry, exact project roots,
and per-operation actions. The lifecycle strictly admits and persists that
document with the secure credential generation; refresh retrieves its rotated
generation. Mobile never translates its bearer into Basic or derives authority
from a session, label, or external task. Operator project provisioning,
production UI/cache integration, and live acceptance remain separate work.

The connection screen is a self-host onboarding flow rather than a fixture
selector: it checks an existing server's public mobile discovery contract,
shows actionable reverse-proxy failures, accepts a pairing invite by QR scan or
strict paste, displays the pinned origin and server identity for confirmation,
and only then performs the one-time exchange. See
[Connect an existing Automonique server](docs/connect-existing-server.md) for
the routes, media type, scoping request, ingress constraints, and
troubleshooting path.

This implementation has passed automated SDK, lifecycle, security, native
policy, test, and Android/iOS/web export gates. It has not yet been accepted
against an authorized non-production Automonique installation, and no EAS
artifact, signed device build, app-store release, or production deployment is
claimed. Those steps require separately authorized endpoint, account, build,
device, and release evidence.

## Public Android preview

Download the immutable
[Automonique Mobile 0.1.0-preview.2 APK](https://www.automonique.fr/downloads/android/0.1.0-preview.2/4c7b7fac529c8060ecc84691b00156c1fc42989c86adab467cdf9f43e959b353/automonique-mobile-0.1.0-preview.2.apk).

SHA-256: `4c7b7fac529c8060ecc84691b00156c1fc42989c86adab467cdf9f43e959b353`

The adjacent [publication record](https://www.automonique.fr/downloads/android/0.1.0-preview.2/4c7b7fac529c8060ecc84691b00156c1fc42989c86adab467cdf9f43e959b353/publication.json) connects these
exact bytes to protected `main`, retained GitHub Actions run
[`33018777648`](https://github.com/bext-stack/automonique-mobile/actions/runs/33018777648),
the GitHub artifact attestation, packaged manifest, ABIs, debug-only signer,
toolchains, and dependency notices.

This is a public, credential-free, non-production Android preview for
evaluation. Its universal package contains at least `arm64-v8a` and `x86_64`.
It is not evidence of an authorized live Automonique connection,
physical-device support, production signing, app-store readiness, or deployment
of Automonique itself. See the
[preview publication gates](docs/release-governance.md#authorized-android-preview-publication).

The earlier
[0.1.0-preview.1 path](https://www.automonique.fr/downloads/android/0.1.0-preview.1/42a0f924bc865075c19f54f437e91836215950ee5035664e819dfd24f4b7ce8f/automonique-mobile-0.1.0-preview.1.apk)
stays published and unchanged; a preview path is never overwritten or
redirected. The synthetic TalkBack traversal recorded for preview.1 was not
repeated for preview.2 and does not cover it.

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
- Async Storage contains bounded cached reads, endpoint drafts, and message
  drafts—never credentials and never an offline mutation outbox.
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
