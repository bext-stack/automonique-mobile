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
The Platform v2 client is bound to the current credential generation and exact
HTTPS endpoint. It negotiates before use, requires explicit project roots,
keeps authority previews memory-only and single-use, and treats submission as a
refresh obligation rather than local proof of success.
The Expo SDK 57 native tooling uses `xcode@4.0.0`, which replaces the uuid
dependency upstream with Node's `crypto.randomUUID()`. Installation and
validation verify the reviewed source digest and UUID generation behavior.
The local-notifications-only patch remains pinned to expo-notifications
57.0.24; its Gradle changes from 57.0.21 only update the package version.
Security overrides pin decode-uri-component 0.5.1 and Zod 4.6.7; type checking,
linting, tests, and platform exports exercise their consumers before release.
Native signing custody, immutable build evidence, production authorization, and
incident rollback follow [docs/release-governance.md](docs/release-governance.md).
