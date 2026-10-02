# node-forge security backport

`node-forge-1.4.1-automonique.1.tgz` is a downstream backport, **not an upstream
1.4.1 release**. It starts from the integrity-pinned npm `node-forge@1.4.0`
archive and applies the nested DigestAlgorithm child-count check proposed in
[upstream PR #1152](https://github.com/digitalbazaar/forge/pull/1152), commit
`ceba34402e329f0365134f23fe19898756527d65`. This addresses
[CVE-2026-85393](https://github.com/advisories/GHSA-86w9-cpqp-85rv).
No fixed npm release was available when the backport was prepared.

Only `lib/rsa.js` and the package version change. RSA verification now rejects
extra children inside DigestAlgorithm as well as extra outer DigestInfo
children. Existing optional NULL parameters remain supported. The upstream
license files remain in the archive; distribution uses its BSD-3-Clause option.
The downstream prerelease version identifies these patched bytes explicitly.

Rebuild using the pinned project Node/npm toolchain:

```sh
node scripts/vendor-node-forge.mjs
git diff -- vendor/node-forge.json
```

The source archive SHA-512, original and patched RSA SHA-256, upstream patch
commit, output archive digest, and npm integrity are recorded in
`node-forge.json`. The root dependency and npm override ensure Expo's CLI and
code-signing tooling resolve this same archive. It is not imported by app code.

`scripts/verify-node-forge.mjs` runs during installation and security validation.
It verifies every installed lockfile copy's version, integrity, and patched RSA
digest, then generates a temporary RSA key to test valid signatures, a wrong
message, optional parameters, and malformed nested DigestAlgorithm values.
Node/OpenSSL independently confirms that the malformed signatures are invalid.
The high-severity npm audit gate remains unchanged; no advisory is suppressed.

Replace this archive and override with an upstream fixed release once published
and reviewed. Retain the malformed-signature regression when doing so.
