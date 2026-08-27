# Security policy

Please report vulnerabilities privately through GitHub Security Advisories for
`bext-stack/automonique-mobile`. Do not open a public issue containing secrets,
private endpoints, customer data, or exploit details.

The supported line is the latest commit on the default branch until tagged
mobile releases begin. The application includes the production SDK transport
and scoped pairing, refresh, revocation, server-identity, authorization, and
resumable-history boundaries. It ships with no configured endpoint or
credential, and operational navigation remains unavailable until an operator
supplies an origin- and identity-bound one-time pairing offer.

Automated contract, security, native-policy, and bundle verification does not
establish live-environment or release acceptance. No authorized
non-production connection, EAS artifact, signed device build, app-store
release, or production deployment is currently claimed by this repository.

Security invariants include HTTPS-only production endpoints, OS secure storage
for credentials, no offline mutation outbox, exact revision/idempotency binding,
server-owned authority, bounded cached reads, and fail-closed unknown events.
The read-only workspace expansion and every decision that changes a historical
first-slice non-goal are reviewed in
[docs/workspace-companion-threat-model.md](docs/workspace-companion-threat-model.md).
Workspace visibility never implies host paths, credentials, shell, terminal,
or repository mutation authority.
The Expo SDK 57 native tooling hardens the pinned `xcode@3.0.1` dependency at
install time: an exact-digest patch replaces its CommonJS `uuid.v4()` call with
Node's `crypto.randomUUID()`, while npm resolves `uuid@14.0.2`. Installation and
validation fail closed if either reviewed dependency or source digest drifts.
Native signing custody, immutable build evidence, production authorization, and
incident rollback follow [docs/release-governance.md](docs/release-governance.md).
