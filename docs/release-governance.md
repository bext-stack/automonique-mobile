# Release governance

Automonique Mobile currently produces internal Android emulator and iOS
Simulator artifacts only. Those artifacts are test evidence, not production
releases, and must never be submitted to an app store or presented as signed
device builds. An explicitly authorized immutable GitHub prerelease may host
the credential-free Android emulator APK under the preview procedure below;
the iOS Simulator artifact remains evidence-only. There is intentionally no
`production` EAS profile or submit configuration.

## Reproducible native evidence

The `simulator` profile locks the EAS CLI, Node.js, Android image, iOS image,
distribution type, version source, and credential-free build intent. JavaScript
dependencies and the canonical SDK archive are locked by `package-lock.json`
and `vendor/automonique-sdk.json`. EAS image names can still receive minor
updates, so every build record must also preserve the resolved image and
toolchain versions printed by EAS.

Before requesting EAS builds:

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

5. Download both artifacts and hash them with `sha256sum`. Do not publish an
   app-store release. Do not publish a GitHub release except for the narrowly
   authorized Android preview procedure below.

The authorized Android preview may instead come from a reviewed, Android-only
CI build on the protected commit when Expo account access is unavailable. That
workflow must start from a clean generated native project, use the same
credential-free release intent and native transport policy, pin or record every
runner image and toolchain input, preserve its immutable run/artifact ID, and
run the complete inspection and notice gates below. An ad hoc local APK without
that provenance is not publishable. This exception does not authorize an iOS,
store, signed-device, or production build.

Every evidence record must contain the source commit and tree SHA, lockfile and
vendored SDK SHA-256 digests, resolved builder image/tool versions, artifact
filenames and SHA-256 digests, and native-policy verification output. An EAS
record must additionally contain the Expo project ID, EAS CLI version, build
profile, and Android/iOS EAS build UUIDs and URLs. An Android-only CI preview
record instead contains the immutable workflow run and artifact IDs plus its
exact build command and resolved toolchains. A rebuild is comparable only when
all applicable inputs match; signed binaries are not expected to be
bit-for-bit identical.

## Authorized Android preview prerelease

The owner has authorized one public download surface for the credential-free
Android emulator APK. It is an internal preview convenience, not a production
release, device-support claim, live-server acceptance result, or app-store
candidate. No iOS artifact, credential, pairing offer, endpoint, customer data,
log, or signing secret may be attached.

Before publishing a preview:

1. Select a reviewed commit already merged to protected `main`; record its
   commit and tree SHA. The release-specific `v*` tag must resolve to that exact
   commit and remains protected from movement or deletion.
2. Run the full locked validation from that commit and preserve the run URL and
   results. Record the lockfile and vendored SDK SHA-256 digests, build system
   and immutable run/build ID, exact build command/profile, resolved builder
   image, Node, npm, Java, Gradle, Android SDK/build-tools, NDK, and EAS CLI
   versions as applicable.
3. Name the artifact
   `automonique-mobile-0.1.0-preview.1.apk` and compute its SHA-256 digest. The
   APK must be the exact artifact produced by the recorded build; do not
   rebuild or re-sign it for upload.
4. Inspect the packaged effective manifest with `apkanalyzer`, Android Studio
   APK Analyzer, or an equivalently reviewed Android build tool. Preserve the
   output proving `android:usesCleartextTraffic="false"` and the absence of any
   broader/domain cleartext exception.
5. Run `apksigner verify --verbose --print-certs` (or an equivalently reviewed
   Android signing verifier). Preserve the verification result, signer subject,
   certificate SHA-256 digest, and signing schemes. Confirm that the signer is
   only the generated non-production/debug identity described below, never an
   app-store or organization production identity. An unsigned or unverifiable
   APK must not be published.
6. Generate the Maven dependency tree and dependency/license inventory from the
   exact native project used for the APK. Include every required attribution
   and notice in the prerelease record alongside the npm notice digest. Missing,
   unknown, copyleft, source-available, or conflicting metadata blocks
   publication until explicit legal approval is recorded.
7. Enable GitHub release immutability before creating this release and verify
   that the repository setting is active. Create the prerelease as a draft,
   attach the final APK and complete provenance/verification record, then
   publish it with `prerelease=true` and without marking it latest. After
   publication, verify that GitHub labels it immutable and verify the local APK
   against the immutable release attestation.
8. Put the immutable asset URL and SHA-256 digest in the README. The release
   notes and README must say that it is an internal non-production emulator
   preview, has no embedded endpoint or credential, and does not establish live
   acceptance, device support, signing custody, or store readiness.

GitHub release immutability protects the published tag and assets; it applies
only to releases published after the setting is enabled. Therefore the draft
must contain the complete final asset set before publication. A mutable release
or replaceable asset URL does not satisfy this policy.

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

The default branch is governed by active protection with no routine
administrator bypass. Current controls:

- require a pull request, dismissal of stale approvals, and all conversations
  resolved;
- require the `validate`, `secrets`, and `review` checks from GitHub Actions,
  with the branch up to date before merge;
- require linear history and block force pushes and deletion of `main`,
  including for administrators;
- require full-length commit SHAs for Actions and allow only reviewed actions;
- retain read-only default `GITHUB_TOKEN` permissions and prevent workflows
  from approving pull requests; and
- protect release tags matching `v*` from deletion or movement.

`CODEOWNERS` records ownership but is not enforcement by itself. The organization
must add at least one qualified reviewer who is not the change author before the
one-independent-approval, CODEOWNERS-review, and approval-after-last-push rules
can be activated without deadlocking the repository. That is the only pending
branch-review control. Direct pushes are emergency-only, must be auditable, and
require a follow-up review and incident record.

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

## Preview withdrawal and replacement

An installed preview APK cannot be remotely removed or safely downgraded. If a
preview is unsafe, incorrect, or no longer supportable:

1. Revoke or disable affected server-side mobile credentials/capabilities when
   safety requires it, and preserve the immutable release attestation, APK
   digest, signing certificate digest, build provenance, and incident evidence.
2. Remove the README download link in a reviewed commit and mark the prerelease
   withdrawn in its release notes if GitHub permits metadata updates. Never
   replace or delete the individual asset, move the tag, or reuse the version.
3. Publish a corrected APK only as a new preview version and tag after repeating
   every build, validation, transport, signing, dependency, and notice gate.
4. If a confirmed security, privacy, or legal issue requires public removal,
   the repository owner may delete the entire prerelease after preserving an
   access-controlled evidence record. Keep the protected tag when possible and
   permanently retire its tag/version name; GitHub does not permit reuse of a
   tag name from a deleted immutable release.
5. Open a private security advisory when secrets, customer data, signing
   material, or a practical exploit may be involved. Document the decision and
   verification before restoring any public download.

Withdrawal is not a production rollback and does not establish an update
channel. Users must uninstall the affected preview or install a separately
verified successor; EAS Update remains unconfigured.

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
- add an independent organization reviewer and activate the remaining
  approval/CODEOWNERS rules;
- enable repository release immutability before publishing the authorized
  Android preview prerelease;
- enable organization/repository security settings that require administrator
  authority; and
- create store accounts, accept agreements, authorize signing identities, and
  approve any production release.

Until each applicable gate has named ownership and evidence, the app remains an
internal, non-production mobile client.
