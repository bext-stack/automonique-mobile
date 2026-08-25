# Release governance

Automonique Mobile currently produces internal Android emulator and iOS
Simulator artifacts only. Those artifacts are test evidence, not production
releases, and must never be submitted to an app store or presented as signed
device builds. There is intentionally no `production` EAS profile or submit
configuration.

## Reproducible native evidence

The `simulator` profile locks the EAS CLI, Node.js, Android image, iOS image,
distribution type, version source, and credential-free build intent. JavaScript
dependencies and the canonical SDK archive are locked by `package-lock.json`
and `vendor/automonique-sdk.json`. EAS image names can still receive minor
updates, so every build record must also preserve the resolved image and
toolchain versions printed by EAS.

Before requesting builds:

1. Work from a clean, reviewed commit on a protected branch.
2. Run `npm ci`, `npm run validate`, and
   `node scripts/verify-native-policy.mjs`.
3. Authenticate with the authorized Expo organization and verify that
   `app.json` contains its reviewed `owner` and `extra.eas.projectId` values.
4. Run the repository-pinned EAS CLI, not a globally installed or floating
   version:

   ```sh
   npx --yes eas-cli@22.4.0 build --platform all --profile simulator --non-interactive --wait
   ```

5. Download both artifacts without publishing a GitHub or app-store release.
   Hash each artifact with `sha256sum` and attach the evidence to MOB-200.

The evidence record must contain the source commit and tree SHA, lockfile and
vendored SDK SHA-256 digests, Expo project ID, EAS CLI version, build profile,
Android and iOS EAS build UUIDs and URLs, resolved builder image/tool versions,
artifact filenames and SHA-256 digests, and the native-policy verification
output. A rebuild is comparable only when all of those inputs match; signed
binaries are not expected to be bit-for-bit identical.

## Native transport policy

Application code admits HTTPS production endpoints only. Native release
configuration independently denies cleartext traffic:

- Android's generated main manifest must contain
  `android:usesCleartextTraffic="false"`.
- iOS ATS must set both `NSAllowsArbitraryLoads` and
  `NSAllowsLocalNetworking` to `false`.

`scripts/verify-native-policy.mjs` creates clean native projects in a temporary
directory and checks these effective generated values. Expo's generated Android
debug manifest intentionally enables cleartext traffic for Metro; that debug
variant is not the `simulator` profile's release APK and must not be used as
release evidence.

After downloading artifacts, verify the packaged policy as well. Inspect the
APK's effective manifest with Android Studio's APK Analyzer or `apkanalyzer`,
and inspect the simulator `.app/Info.plist` with `plutil`. Preserve that output
with the build record. Any broader exception, domain exception, or cleartext
permission blocks distribution.

## Repository controls

The default branch must be governed by an active GitHub ruleset with no routine
administrator bypass:

- require a pull request, one independent approval, CODEOWNERS approval,
  dismissal of stale approvals, approval after the most recent push, and all
  conversations resolved;
- require the `validate`, `secrets`, and `review` checks from GitHub Actions,
  with the branch up to date before merge;
- block force pushes and deletion of `main`;
- require full-length commit SHAs for Actions and allow only reviewed actions;
- retain read-only default `GITHUB_TOKEN` permissions and prevent workflows
  from approving pull requests; and
- protect release tags matching `v*` from deletion or movement.

`CODEOWNERS` records ownership but is not enforcement by itself. The organization
must add at least one qualified reviewer who is not the change author before the
independent-review rule can be activated without deadlocking the repository.
Direct pushes are emergency-only, must be auditable, and require a follow-up
review and incident record.

Workflow actions and scanner images are pinned to immutable commits or OCI
digests. Dependabot may propose updates, but a reviewer must verify the upstream
release and update the adjacent version comment together with the pin. GitHub
secret scanning, push protection, dependency alerts, and automated security
updates should be enabled at repository or organization level.

## Third-party notices

Every npm dependency must have a resolved package/version and declared license
represented by `THIRD_PARTY_NOTICES.md` and
`THIRD_PARTY_NOTICES.generated.md`; bundled license and notice texts are retained
where packages ship them. Regenerate and verify the inventory after any
dependency or lockfile change. Before distributing a native binary, additionally
produce CocoaPods and Maven dependency/license inventories from the immutable
native build and add every required attribution and notice to the release
record. Missing, unknown, copyleft, source-available, or conflicting metadata
requires human review before merge. Legal approval, when required by the
distributor, is an external release gate.

## Signing custody

Simulator evidence does not require Apple signing. The Android emulator APK is
credential-free and non-production; its generated debug key is not an app-store
identity and must never be promoted.

A store release requires a separately authorized change that adds explicit
store profiles, environments, and submission controls. Before that change:

- designate Apple Developer/App Store Connect and Google Play owners plus a
  backup custodian;
- use EAS-managed remote credentials or an approved secrets manager, with
  least-privilege App Store Connect and Play service-account roles;
- require MFA, record certificate/profile/key identifiers and expiry dates,
  and test rotation and revocation;
- never commit or upload private keys, keystores, provisioning profiles,
  service-account JSON, passwords, or recovery material to issues or logs; and
- separate build authority from approval and store-promotion authority.

Creating store applications, accepting legal agreements, purchasing developer
memberships, and authorizing signing credentials require account-owner action.
No agent, workflow, or contributor may infer that authority from a simulator
build request.

## Release and rollback

Before promotion, record the approved commit, immutable build ID and artifact
digest, test evidence, notice digest, signing identity, store version/build
numbers, approver, staged rollout plan, monitoring owner, and last-known-good
version. Releases must originate from the protected commit that passed the
required checks; artifacts are never rebuilt from a tag after approval.

Native stores do not support safely downgrading an installed binary. To roll
back:

1. Halt or pause the staged App Store/Play rollout and disable affected server
   capabilities or mobile credentials when safety is at risk.
2. Preserve logs, receipts, build provenance, and the immutable release tag;
   open a private security advisory if secrets or customer data may be involved.
3. Rebuild the last-known-good source with a new, monotonically increasing iOS
   build number and Android version code, run the complete gates, obtain fresh
   approval, and submit it as a new release.
4. Rotate or revoke compromised signing and service credentials through the
   owning account, then verify that old credentials can no longer publish.
5. Document the recovery and follow-up controls before resuming rollout.

EAS Update is not configured, so no over-the-air rollback path exists. Adding
one requires a separate runtime-version, channel, signing, retention, and
rollback design; it must not be treated as an implicit native rollback.

## External gates

The following cannot be completed by repository changes alone:

- link an authorized Expo organization/project and supply a scoped build token;
- provide EAS build capacity and preserve the resulting build records;
- add an independent organization reviewer and activate the GitHub ruleset;
- enable organization/repository security settings that require administrator
  authority; and
- create store accounts, accept agreements, authorize signing identities, and
  approve any production release.

Until each applicable gate has named ownership and evidence, the app remains an
internal, non-production mobile client.
