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
