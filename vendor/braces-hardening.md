# Braces depth-guard security patch

`braces-3.0.4-automonique.1.tgz` is a downstream patched build of npm
`braces@3.0.3`, **not an upstream 3.0.4 release**. It addresses
[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), for which
no fixed upstream release was available on 2026-10-04.

The parser bounds its explicit nesting stack before recursive helpers can run.
The compile, expand, and stringify walkers independently bound their recursion
at 128, including when passed an AST directly. Excessive nesting fails with a
controlled SyntaxError instead of exhausting the JavaScript stack. Ordinary
braces, numeric ranges, nested alternatives, quotes, and escaped literals retain
the upstream behavior. This does not claim to remove every possible expansion
resource limit; upstream range limits remain in place.

Only those four source files and the package version change; the upstream MIT
license is retained. `scripts/vendor-braces.mjs` reconstructs the archive from
SHA-512-pinned upstream bytes and records original/patched source digests and
the packed archive integrity in `braces.json`. `scripts/verify-braces.mjs` runs
at installation and security validation, verifies every locked installed copy,
and exercises deep strings and direct ASTs as well as normal globs. The root
override routes the Expo/Metro/Jest tooling through this exact archive. App
screens do not import it. No advisory is suppressed and the npm audit gate is
unchanged.

Rebuild with the repository Node/npm toolchain:

```sh
node scripts/vendor-braces.mjs
```

Replace the downstream archive with an upstream fixed release once available
and reviewed, retaining the nesting regressions.
