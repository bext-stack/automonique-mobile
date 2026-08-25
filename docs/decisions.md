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

## Exact decimal revisions

Revisions and event sequences are validated canonical decimal strings in the
mobile model. Arithmetic converts them to `bigint` transiently, preventing
precision loss across React Native JavaScript engines.

## Production networking gate

The canonical SDK transport is necessary but not sufficient. Navigation to a
live surface also requires server identity plus actor-scoped actions and limits.
Method presence alone never grants authority.
