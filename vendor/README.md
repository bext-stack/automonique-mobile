# Vendored Automonique SDK

`automonique-sdk-0.1.0.tgz` is the deterministic package produced by `npm pack`
in `sdk/typescript/packages/sdk` at the Automonique source commit recorded in
`automonique-sdk.json`.

The package is vendored because `@automonique/sdk` is not yet published to an
authorized registry. It retains its Apache-2.0 license inside the archive.
Product code in this repository remains Elastic-2.0.

Run `npm run sdk:verify` after installation. It checks the archive hash, the
installed package identity and license, the schema digest on all three of the
manifest, the installed `package.json` and the SDK's runtime constant, and the
presence of the mobile client surface.

Run `npm run sdk:drift` when preparing a release or reviewing upstream protocol
work. It compares the recorded digest with the latest Automonique `main` commit
that changed the SDK package metadata. A difference is informational and exits
successfully because compatibility is negotiated by protocol version. The
scheduled `Automonique SDK drift` workflow performs the same comparison and
reuses one tracking issue until the vendored digest catches up.

## What the recorded fields mean

| Field           | Meaning                                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sourceCommit`  | The Automonique revision the archive was built from. Provenance.                                                                                  |
| `schemaDigest`  | Which generated protocol surface that build carries. Evidence, never compared against a server; see [../docs/decisions.md](../docs/decisions.md). |
| `archiveSha256` | Supply-chain integrity of the archive in this directory.                                                                                          |

Server compatibility is decided by protocol version negotiation, not by these
fields. A server whose digest differs from the one recorded here is still
admitted when it advertises a protocol version this build speaks.

## Re-vendoring

Use the canonical SDK's own CI-verified packed-archive workflow
(`sdk/typescript/packages/sdk/README.md`, Automonique #121) from a clean
checkout of the revision you intend to pin.

```sh
# 1. Clean checkout of the revision to pin.
git -C /path/to/automonique worktree add /tmp/sdk-pack --detach origin/main
cd /tmp/sdk-pack/sdk/typescript/packages/sdk

# 2. The canonical package's own gates, then pack.
bun install --frozen-lockfile
npm run typecheck
npm test
npm pack --pack-destination /tmp/sdk-pack-out

# 3. Replace the archive and record what was pinned.
cd /path/to/automonique-mobile
cp /tmp/sdk-pack-out/automonique-sdk-0.1.0.tgz vendor/
sha256sum vendor/automonique-sdk-0.1.0.tgz          # -> archiveSha256
git -C /tmp/sdk-pack rev-parse HEAD                 # -> sourceCommit
tar -xzOf vendor/automonique-sdk-0.1.0.tgz package/package.json \
  | grep schemaDigest                               # -> schemaDigest
```

Edit `automonique-sdk.json` with those three values. Nothing else is
hand-written: `src/core/sdk-metadata.ts` imports the digest, protocol, schema
and media types from the installed package at runtime, so it follows the
archive without an edit.

`npm install` will not re-resolve a `file:` dependency whose path is unchanged.
Refresh the lockfile's `integrity` for `node_modules/@automonique/sdk` to the
new archive's sha512 and reinstall from scratch:

```sh
node -e 'const c=require("node:crypto"),f=require("node:fs");console.log("sha512-"+c.createHash("sha512").update(f.readFileSync("vendor/automonique-sdk-0.1.0.tgz")).digest("base64"))'
# put that value in package-lock.json, then:
rm -rf node_modules && npm ci && npm run sdk:verify
```

Finish with a clean mobile install, the SDK adapter contract tests, and
all-platform Expo export — `npm run validate` covers all three. Delete the
temporary checkout (`git -C /path/to/automonique worktree remove /tmp/sdk-pack`).

A re-vendor does not by itself require a new released build. It does when the
mobile protocol version this app can speak changes; see
[../docs/decisions.md](../docs/decisions.md).
