# Automonique Mobile

Official iOS and Android operator client for Automonique. The app is a thin,
fail-closed consumer: it never embeds an agent runtime, provider credentials,
routing policy, privileged tools, direct database access, or an alternative
authority model.

## Current baseline

The checked-in vertical slice is synthetic by design. It demonstrates bounded
session discovery, an authoritative/preview/synthetic timeline, exact-session
follow-up, exact-run stop, approval decisions, stale read-only behavior,
durable receipts, idempotent reconciliation, cached reads, and persisted
drafts. It does not connect to a live Automonique installation.

Production networking remains unavailable until the server supplies scoped
mobile authentication, refresh/revocation, stable server identity, negotiated
actor-authorized actions and remotely resumable sanitized history. The app
does not ask for or persist a live credential before those contracts exist.

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
- Credentials, once supported, are stored only with `expo-secure-store`.
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
