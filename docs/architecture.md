# Architecture

Automonique Mobile is a presentation client, not an execution node.

```text
screens → MobileAutomoniqueGateway → @automonique/sdk → HTTPS Platform route
            ↘ cached reads/drafts     ↘ canonical Platform v1
```

Screens can list and attach sessions, consume typed event pages, send a bound
follow-up, decide an exact approval revision, stop an exact run, and reconcile
a receipt by idempotency key. There is deliberately no generic `execute`
method in the mobile gateway.

The checked-in `createMockGateway` supplies deterministic synthetic data. A
production gateway constructor is absent until the server contract provides:

1. scoped mobile credential issuance, refresh, expiry, and revocation;
2. stable server identity and endpoint discovery;
3. actor-authorized action and limit negotiation;
4. bounded, sanitized, resumable session event pages; and
5. receipt reconciliation without replaying ambiguous writes.

## Data boundaries

Async Storage may retain a bounded read projection, endpoint draft, and
operator message drafts. It must never hold bearer credentials or an offline
mutation queue. Secure Store is the only credential boundary. Provider
credentials and raw provider/tool output never cross the server boundary.

Timeline events carry explicit provenance: `authoritative`, `preview`, or
`synthetic`. Unknown event kinds remain visible as unknown and are never
interpreted as success. Cursor gaps and conflicting duplicates require a fresh
snapshot.
