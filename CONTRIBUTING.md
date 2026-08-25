# Contributing

Use Node.js 24 LTS and install with `npm ci`. Before opening a change, run:

```sh
npm run validate
```

Do not disable npm lifecycle scripts. The reviewed Expo SDK 57 dependency graph
still includes `xcode@3.0.1`; installation replaces its sole UUID call with
Node's `crypto.randomUUID` and validation rejects missing or drifted hardening.

Keep screens behind `MobileAutomoniqueGateway`. Do not add generic execution,
provider credentials, direct database access, offline mutation queues, or
cleartext production endpoints. New protocol behavior belongs in the canonical
Automonique SDK and Rust contract tests first.

Never commit credentials, private endpoint addresses, customer content, logs,
sessions, or generated native signing material. Preserve accessibility labels,
semantic roles, Dynamic Type behavior, reduced-motion behavior, and both light
and dark color schemes.

All changes use pull requests and the ownership, immutable-build, signing, and
rollback controls in [docs/release-governance.md](docs/release-governance.md).
Run `node scripts/verify-native-policy.mjs` when native configuration changes.
