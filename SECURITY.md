# Security policy

Please report vulnerabilities privately through GitHub Security Advisories for
`bext-stack/automonique-mobile`. Do not open a public issue containing secrets,
private endpoints, customer data, or exploit details.

The supported line is the latest commit on the default branch until tagged
mobile releases begin. The current baseline is synthetic and has no production
credential or live transport path.

Security invariants include HTTPS-only production endpoints, OS secure storage
for credentials, no offline mutation outbox, exact revision/idempotency binding,
server-owned authority, bounded cached reads, and fail-closed unknown events.
The Expo SDK 57 native tooling hardens the pinned `xcode@3.0.1` dependency at
install time: an exact-digest patch replaces its CommonJS `uuid.v4()` call with
Node's `crypto.randomUUID()`, while npm resolves `uuid@14.0.2`. Installation and
validation fail closed if either reviewed dependency or source digest drifts.
Native signing custody, immutable build evidence, production authorization, and
incident rollback follow [docs/release-governance.md](docs/release-governance.md).
