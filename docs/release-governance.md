# Release governance

Automonique Mobile currently produces a public non-production Android preview
and internal iOS Simulator artifacts. Those artifacts are test evidence, not production
releases, and must never be submitted to an app store or presented as signed
device builds. The owner has explicitly authorized a public, credential-free
Android preview on `automonique.fr` under the procedure below; the iOS Simulator
artifact remains evidence-only. There is intentionally no `production` EAS
profile or submit configuration.

## Reproducible native evidence

The `simulator` profile locks the EAS CLI, Node.js, Android image, iOS image,
distribution type, version source, and credential-free build intent. JavaScript
dependencies and the canonical SDK archive are locked by `package-lock.json`
and `vendor/automonique-sdk.json`. EAS image names can still receive minor
updates, so every build record must also preserve the resolved image and
toolchain versions printed by EAS.

Before requesting EAS builds:

1. Work from a clean, reviewed commit on a protected branch.
2. Run `npm ci`, `npm run validate`, `npm run sdk:drift`, and
   `node scripts/verify-native-policy.mjs`. SDK drift is an informational review
   prompt, not a failed build: inspect the upstream protocol change and
   re-vendor only when the mobile surface or supported version range requires
   it.
3. Authenticate with the authorized Expo organization and verify that
   `app.json` contains its reviewed `owner` and `extra.eas.projectId` values.
4. Run the repository-pinned EAS CLI, not a globally installed or floating
   version:

   ```sh
   npx --yes eas-cli@22.4.0 build --platform all --profile simulator --non-interactive --wait
   ```

5. Download both artifacts and hash them with `sha256sum`. Do not publish an
   app-store release. EAS artifacts are not eligible for the public Android
   preview unless they independently satisfy the complete procedure below.

The authorized Android preview may instead come from a reviewed, Android-only
CI build on the protected commit when Expo account access is unavailable. That
workflow must start from a clean generated native project, use the same
credential-free release intent and native transport policy, pin or record every
runner image and toolchain input, preserve its immutable run/artifact ID, and
run the complete inspection and notice gates below. An ad hoc local APK without
that provenance is not publishable. This exception does not authorize an iOS,
store, signed-device, or production build.

The reviewed preview dependency graph keeps `expo-notifications` for local,
operator-enabled attention notifications but does not use Expo Application's
Google Play Install Referrer API. The locked postinstall hardening removes that
unused function and its `com.android.installreferrer:installreferrer` Maven
dependency from the exact pinned MIT-licensed `expo-application` source before
native generation. Both pristine and hardened source digests are pinned; an
Expo update or partial patch fails validation and requires a fresh review. The
Maven inventory must prove that the Android SDK Terms dependency is absent.

The same preview build source-builds `expo-notifications` as a
local-notifications-only module. A locked, digest-pinned postinstall hardening
removes Firebase Cloud Messaging, the push-token/topic/background-remote
modules, and the Firebase service while retaining permission, channels, local
scheduling, presentation, and response handling. Automonique schedules only
locally derived attention reminders and does not use remote push. Unknown
package versions, pristine source digests, or hardened outputs fail closed; the
aggregate license gate remains unchanged.

The reviewed `.github/workflows/android-preview.yml` workflow implements that
CI path. It is manual-only, accepts no ref input, rejects any dispatch whose
selected source is not protected `main`, uploads the APK and complete evidence
as a retained Actions artifact and emulator-tests that same universal APK. It
performs no publication. A later publication operator must review that retained
evidence and mirror only the exact attested APK; the workflow itself does not
authorize publication.

Every evidence record must contain the source commit and tree SHA, lockfile and
vendored SDK SHA-256 digests, resolved builder image/tool versions, artifact
filenames and SHA-256 digests, and native-policy verification output. An EAS
record must additionally contain the Expo project ID, EAS CLI version, build
profile, and Android/iOS EAS build UUIDs and URLs. An Android-only CI preview
record instead contains the immutable workflow run and artifact IDs plus its
exact build command and resolved toolchains. A rebuild is comparable only when
all applicable inputs match; signed binaries are not expected to be
bit-for-bit identical.

## Authorized Android preview publication

The owner has authorized one public download surface on `automonique.fr` for the
credential-free Android preview APK. It is a non-production preview convenience,
not a production release, physical-device support claim, live-server acceptance
result, or app-store candidate. The universal APK must contain both `arm64-v8a`
and `x86_64`, and the exact publishable APK must be emulator-tested. No iOS
artifact, credential, pairing offer, endpoint, customer data, log, or signing
secret may be published.

Before publishing a preview:

1. Select a reviewed commit already merged to protected `main`; record its
   commit and tree SHA.
2. Run the full locked validation from that commit and preserve the run URL and
   results. Record the lockfile and vendored SDK SHA-256 digests, build system
   and immutable run/build ID, exact build command/profile, resolved builder
   image, Node, npm, Java, Gradle, Android SDK/build-tools, NDK, and EAS CLI
   versions as applicable.
3. Name the artifact
   `automonique-mobile-0.1.0-preview.3.apk` and compute its SHA-256 digest. The
   APK must be the exact artifact produced by the recorded build; do not
   rebuild or re-sign it for upload.
4. Inspect the packaged effective manifest with `apkanalyzer`, Android Studio
   APK Analyzer, or an equivalently reviewed Android build tool. Preserve the
   output proving `android:usesCleartextTraffic="false"` and the absence of any
   broader/domain cleartext exception.
5. Inspect the packaged ABI inventory and preserve evidence that both
   `arm64-v8a` and `x86_64` are present. Run the same exact APK on the reviewed
   Android emulator; a rebuild is not equivalent evidence.
6. Run `apksigner verify --verbose --print-certs` (or an equivalently reviewed
   Android signing verifier). Preserve the verification result, signer subject,
   certificate SHA-256 digest, and signing schemes. Confirm that the signer is
   only the generated non-production/debug identity described below, never an
   app-store or organization production identity. An unsigned or unverifiable
   APK must not be published.
7. Generate the Maven dependency tree and dependency/license inventory from the
   exact native project used for the APK. Include every required attribution
   and notice in the publication record alongside the npm notice digest. Missing,
   unknown, copyleft, source-available, or conflicting metadata blocks
   publication until explicit legal approval is recorded.
8. Retrieve the retained workflow artifact by its immutable run and artifact
   IDs. Verify its recorded SHA-256 and GitHub artifact attestation against
   `bext-stack/automonique-mobile`. Copy the verified APK bytes into protected
   website staging without rebuilding, re-signing, renaming to another version,
   or otherwise transforming them.
9. Publish those exact bytes on a versioned, content-addressed
   `automonique.fr` path containing both the preview version and APK SHA-256.
   Publish adjacent SHA-256 and provenance records that identify the source
   repository, commit and tree, workflow run and artifact IDs, attestation URL,
   signer certificate digest, ABI inventory, toolchains, and notice evidence.
   The path is immutable: never overwrite or reuse it for different bytes.
10. Re-download the APK from its public `automonique.fr` URL. Verify its SHA-256
    against both adjacent metadata and the workflow evidence, and verify the
    downloaded file against the original GitHub attestation. A redirect,
    content transformation, missing provenance record, or digest/attestation
    mismatch blocks publication.
11. Put the verified immutable URL and SHA-256 digest in the README. The download
    page, adjacent provenance, and README must say that this is a public,
    credential-free, non-production Android preview and does not establish an
    authorized live connection, physical-device support, production signing,
    app-store readiness, or deployment of Automonique itself.

The versioned content-addressed website path is the public immutability
boundary. Deployment records must connect it to the retained Actions artifact;
cache or CDN layers must return the exact bytes. A replaceable URL or asset that
cannot be re-downloaded and verified does not satisfy this policy.

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
- protect release tags matching `v*` from deletion or movement (the public
  Android preview hosting path does not depend on a tag).

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

Simulator evidence does not require Apple signing. The Android preview APK is
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
   safety requires it, and preserve the artifact attestation, APK
   digest, signing certificate digest, build provenance, and incident evidence.
2. Remove the README download link in a reviewed commit, mark the website
   download withdrawn, and prevent new downloads when safety requires it. Never
   replace the bytes at the content-addressed path or reuse the version or digest.
3. Publish a corrected APK only under a new preview version and content-addressed
   path after repeating every build, validation, transport, signing, dependency,
   and notice gate.
4. If a confirmed security, privacy, or legal issue requires public removal,
   the website owner may disable the content-addressed path after preserving an
   access-controlled evidence record. Permanently retire its version and digest
   path; do not later reuse either identifier.
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
2. Preserve logs, receipts, build provenance, and immutable publication records;
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
- produce the reviewed workflow artifact, deploy its exact attested bytes to the
  governed `automonique.fr` path, and complete live re-download verification;
- enable organization/repository security settings that require administrator
  authority; and
- create store accounts, accept agreements, authorize signing identities, and
  approve any production release.

Until each applicable gate has named ownership and evidence, the public preview
remains a non-production mobile client.
