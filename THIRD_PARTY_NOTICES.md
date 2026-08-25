# Third-party notices

Automonique Mobile's complete resolved npm dependency inventory and available
bundled license/notice texts are recorded in
`THIRD_PARTY_NOTICES.generated.md`. The generated file covers every dependency
location in `package-lock.json`, rejects missing license metadata, groups
identical texts without dropping package identity, and is checked by CI.

The canonical `@automonique/sdk` package is vendored from the pinned Automonique
source commit recorded in `vendor/automonique-sdk.json`. It is licensed under
Apache-2.0 and carries its license inside the package archive.

The Automonique icon and splash mark were generated specifically for this
project with OpenAI's image-generation tool. They do not reuse the removed Expo
template artwork.

Regenerate after dependency changes with `npm run notices:generate`. A pull
request fails `npm run notices:check` when the committed inventory is stale.
Native CocoaPods and Maven inventories must be captured from each immutable EAS
build before a distributable release; the current simulator evidence profile is
not a production release.
