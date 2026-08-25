# Vendored Automonique SDK

`automonique-sdk-0.1.0.tgz` is the deterministic package produced by `npm pack` in `sdk/typescript/packages/sdk` at the Automonique source commit recorded in `automonique-sdk.json`.

The package is vendored because `@automonique/sdk` is not yet published to an authorized registry. It retains its Apache-2.0 license inside the archive. Product code in this repository remains Elastic-2.0.

Run `npm run sdk:verify` after installation. Updating the archive requires a reviewed canonical SDK commit, a new archive hash and schema digest, a clean mobile install, the SDK adapter contract tests, and all-platform Expo export.
