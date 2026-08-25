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
state. Screens expose only bounded session discovery and attachment,
exact-session follow-up, exact-run stop, approval decisions, and receipt
reconciliation. They never receive generic Platform execution authority.
Deterministic synthetic gateways remain test fixtures and are excluded from
the production source graph and emitted bundles.

This implementation has passed automated SDK, lifecycle, security, native
policy, test, and Android/iOS/web export gates. It has not yet been accepted
against an authorized non-production Automonique installation, and no EAS
artifact, signed device build, app-store release, or production deployment is
claimed. Those steps require separately authorized endpoint, account, build,
device, and release evidence.

## Requirements

- Node.js 24 LTS
- npm 11
- Expo SDK 57
- React Native 0.86.2 and React 19.2

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
