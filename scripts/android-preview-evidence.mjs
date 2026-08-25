// SPDX-License-Identifier: Elastic-2.0

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

const CONFIG = Object.freeze({
  schema: 'automonique.android-preview-build/v1',
  packageName: 'dev.bext.automonique',
  artifactName: 'automonique-mobile-0.1.0-preview.1.apk',
  nodeVersion: '24.19.0',
  npmVersion: '11.10.1',
  javaDistribution: 'temurin',
  javaVersion: '21.0.12.1+1',
  androidPlatform: 'android-36',
  androidBuildTools: '36.0.0',
  androidNdk: '27.1.12297006',
  gradleVersion: '9.3.1',
  gradleDistributionSha256:
    'b266d5ff6b90eada6dc3b20cb090e3731302e553a27c5d3e4df1f0d76beaff06',
  commands: [
    'npm ci',
    'npm run validate',
    'npm run native:verify',
    'npx expo prebuild --platform android --clean --no-install',
    'sdkmanager --install "platforms;android-36" "build-tools;36.0.0" "platform-tools" "ndk;27.1.12297006" "emulator" "system-images;android-36;google_apis;x86_64"',
    'sudo apt-get install --yes --no-install-recommends libpulse0',
    'ldd "$ANDROID_SDK_ROOT/emulator/emulator"',
    './android/gradlew -p android --no-daemon --console=plain --stacktrace :app:assembleRelease',
    './android/gradlew -p android --no-daemon --console=plain :app:dependencies --configuration releaseRuntimeClasspath',
    './android/gradlew -p android --no-daemon --console=plain -I "$GITHUB_WORKSPACE/scripts/android-preview-inventory.init.gradle" :app:previewRuntimeInventory',
    'apkanalyzer manifest print automonique-mobile-0.1.0-preview.1.apk',
    'apkanalyzer files list automonique-mobile-0.1.0-preview.1.apk',
    'apksigner verify --verbose --print-certs automonique-mobile-0.1.0-preview.1.apk',
    'ANDROID_AVD_HOME="$PREVIEW_WORK_DIR/avd" emulator -avd automonique-preview -accel on -gpu software -no-window -no-audio -no-boot-anim -no-snapshot -wipe-data -no-metrics -camera-back none -memory 4096 -cores 4',
    'adb install --no-streaming -r automonique-mobile-0.1.0-preview.1.apk',
    'adb shell am start -W dev.bext.automonique/.MainActivity',
  ],
});

const LICENSE_ALLOWLIST = Object.freeze([
  'Apache-2.0',
  'MIT',
  'BSD-2-Clause/BSD-3-Clause',
  'ISC',
  'Unicode/ICU',
  'CC0/Public-Domain',
]);

function fail(message) {
  throw new Error(message);
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`preview_environment_missing:${name}`);
  }
  return value;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? ROOT,
    encoding: options.encoding ?? 'utf8',
    env: process.env,
    maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const stderr =
      typeof result.stderr === 'string' ? result.stderr.trim() : '';
    fail(
      `preview_command_failed:${command}:${result.status}:${stderr.slice(0, 1_000)}`,
    );
  }
  return result;
}

function text(command, args, options = {}) {
  const result = run(command, args, options);
  return `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
}

function sha256File(path) {
  const hash = createHash('sha256');
  hash.update(readFileSync(path));
  return hash.digest('hex');
}

function assertFile(path, category) {
  if (!existsSync(path) || !statSync(path).isFile()) fail(category);
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function refreshChecksums(outputDir) {
  const checksumFiles = readdirSync(outputDir)
    .filter((name) => name !== 'SHA256SUMS')
    .sort();
  const checksums = checksumFiles.map((name) => {
    const path = join(outputDir, name);
    assertFile(path, `preview_evidence_not_file:${name}`);
    return `${sha256File(path)}  ${name}`;
  });
  writeFileSync(
    join(outputDir, 'SHA256SUMS'),
    `${checksums.join('\n')}\n`,
    'utf8',
  );
}

function requireMatch(value, expression, category) {
  if (!expression.test(value)) fail(category);
}

function prepareNativeProject() {
  const wrapperPath = join(
    ROOT,
    'android/gradle/wrapper/gradle-wrapper.properties',
  );
  const appBuildPath = join(ROOT, 'android/app/build.gradle');
  const manifestPath = join(ROOT, 'android/app/src/main/AndroidManifest.xml');
  const gradlePropertiesPath = join(ROOT, 'android/gradle.properties');
  const versionsPath = join(
    ROOT,
    'node_modules/react-native/gradle/libs.versions.toml',
  );
  for (const [path, category] of [
    [wrapperPath, 'preview_gradle_wrapper_missing'],
    [appBuildPath, 'preview_app_build_missing'],
    [manifestPath, 'preview_source_manifest_missing'],
    [gradlePropertiesPath, 'preview_gradle_properties_missing'],
    [versionsPath, 'preview_react_native_versions_missing'],
  ]) {
    assertFile(path, category);
  }

  const versions = readFileSync(versionsPath, 'utf8');
  for (const [key, expected] of [
    ['targetSdk', '36'],
    ['compileSdk', '36'],
    ['buildTools', CONFIG.androidBuildTools],
    ['ndkVersion', CONFIG.androidNdk],
  ]) {
    requireMatch(
      versions,
      new RegExp(`^${key}\\s*=\\s*"${expected.replaceAll('.', '\\.')}"$`, 'm'),
      `preview_android_version_drift:${key}`,
    );
  }

  let wrapper = readFileSync(wrapperPath, 'utf8');
  requireMatch(
    wrapper,
    new RegExp(
      `^distributionUrl=https\\\\://services\\.gradle\\.org/distributions/gradle-${CONFIG.gradleVersion.replaceAll('.', '\\.')}-bin\\.zip$`,
      'm',
    ),
    'preview_gradle_distribution_drift',
  );
  const checksumLine = `distributionSha256Sum=${CONFIG.gradleDistributionSha256}`;
  const checksumPattern = /^distributionSha256Sum=.*$/m;
  if (checksumPattern.test(wrapper)) {
    requireMatch(
      wrapper,
      new RegExp(`^${checksumLine}$`, 'm'),
      'preview_gradle_checksum_drift',
    );
  } else {
    wrapper = `${wrapper.trimEnd()}\n${checksumLine}\n`;
    writeFileSync(wrapperPath, wrapper, 'utf8');
  }

  const appBuild = readFileSync(appBuildPath, 'utf8');
  requireMatch(
    appBuild,
    /release\s*\{[\s\S]*?signingConfig signingConfigs\.debug/,
    'preview_release_signing_not_debug',
  );
  requireMatch(
    appBuild,
    /applicationId ['"]dev\.bext\.automonique['"]/,
    'preview_application_id_drift',
  );

  const manifest = readFileSync(manifestPath, 'utf8');
  requireMatch(
    manifest,
    /android:usesCleartextTraffic="false"/,
    'preview_source_cleartext_not_false',
  );
  if (
    /android:networkSecurityConfig=|cleartextTrafficPermitted/i.test(manifest)
  ) {
    fail('preview_source_network_security_exception');
  }

  const gradleProperties = readFileSync(gradlePropertiesPath, 'utf8');
  const architectures = gradleProperties
    .match(/^reactNativeArchitectures=(.+)$/m)?.[1]
    ?.split(',')
    .map((value) => value.trim());
  if (
    !architectures?.includes('arm64-v8a') ||
    !architectures.includes('x86_64')
  ) {
    fail('preview_source_required_abis_missing');
  }

  process.stdout.write(
    `${JSON.stringify({ status: 'prepared', config: CONFIG })}\n`,
  );
}

function classifyLicense(license, coordinate) {
  const value =
    `${license.name ?? ''} ${license.url ?? ''} ${license.comments ?? ''}`.trim();
  if (value === '') fail(`preview_license_missing:${coordinate}`);
  if (
    /\b(?:AGPL|GPL|LGPL|SSPL|EPL|MPL|CDDL|CPAL)\b|elastic license|commons clause|business source|source[- ]available/i.test(
      value,
    )
  ) {
    fail(`preview_license_disallowed:${coordinate}:${value.slice(0, 160)}`);
  }
  if (
    !/apache(?: software)? license.*(?:2(?:\.0)?|version 2)|apache[- ]2(?:\.0)?\b|opensource\.org\/licenses\/(?:apache-2\.0|mit|bsd-[23]-clause|isc)|\bmit(?: license)?\b|\bbsd(?:[- ]?[23][- ]clause| license)?\b|\bisc(?: license)?\b|unicode|\bicu(?: license)?\b|\bcc0\b|public domain/i.test(
      value,
    )
  ) {
    fail(`preview_license_unknown:${coordinate}:${value.slice(0, 160)}`);
  }
}

function bundledNotices(artifactPath, coordinate) {
  const entries = text('unzip', ['-Z1', artifactPath])
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) =>
      /(^|\/)(?:LICENSE|NOTICE|COPYING|DEPENDENCIES)(?:\.[^/]*)?$/i.test(value),
    );
  if (entries.length > 128) fail(`preview_notice_entry_limit:${coordinate}`);

  let totalBytes = 0;
  return entries.map((entry) => {
    const result = run('unzip', ['-p', artifactPath, entry], {
      encoding: 'buffer',
      maxBuffer: 2 * 1024 * 1024,
    });
    const value = result.stdout;
    if (!Buffer.isBuffer(value))
      fail(`preview_notice_read_failed:${coordinate}`);
    if (value.length > 1024 * 1024) {
      fail(`preview_notice_too_large:${coordinate}:${entry}`);
    }
    totalBytes += value.length;
    if (totalBytes > 8 * 1024 * 1024) {
      fail(`preview_notice_total_too_large:${coordinate}`);
    }
    if (value.includes(0))
      fail(`preview_notice_not_text:${coordinate}:${entry}`);
    return {
      entry,
      sha256: createHash('sha256').update(value).digest('hex'),
      text: value.toString('utf8').replaceAll('\r\n', '\n').trim(),
    };
  });
}

function buildMavenEvidence(rawPath, outputDir) {
  const raw = JSON.parse(readFileSync(rawPath, 'utf8'));
  if (
    raw.schema !== 'automonique.android-preview-maven-raw/v1' ||
    raw.configuration !== 'releaseRuntimeClasspath' ||
    !Array.isArray(raw.artifacts) ||
    raw.artifacts.length === 0
  ) {
    fail('preview_maven_inventory_invalid');
  }

  const inventory = raw.artifacts.map((artifact) => {
    if (
      typeof artifact.coordinate !== 'string' ||
      !Array.isArray(artifact.licenses) ||
      artifact.licenses.length === 0
    ) {
      fail(
        `preview_maven_metadata_invalid:${artifact.coordinate ?? 'unknown'}`,
      );
    }
    const hasArtifact = artifact.artifactPath !== '';
    if (hasArtifact) {
      assertFile(
        artifact.artifactPath,
        `preview_maven_artifact_missing:${artifact.coordinate}`,
      );
    } else if (artifact.type !== 'pom') {
      fail(`preview_maven_artifact_missing:${artifact.coordinate}`);
    }
    for (const license of artifact.licenses) {
      classifyLicense(license, artifact.coordinate);
    }
    const notices = hasArtifact
      ? bundledNotices(artifact.artifactPath, artifact.coordinate)
      : [];
    return {
      coordinate: artifact.coordinate,
      type: artifact.type,
      classifier: artifact.classifier,
      artifactFile: hasArtifact ? basename(artifact.artifactPath) : null,
      artifactSha256: hasArtifact ? sha256File(artifact.artifactPath) : null,
      pomSha256: artifact.pomSha256,
      inheritedFrom: artifact.inheritedFrom || null,
      licenses: artifact.licenses,
      bundledNotices: notices.map(({ entry, sha256 }) => ({ entry, sha256 })),
      noticeContents: notices,
    };
  });

  writeJson(join(outputDir, 'maven-license-inventory.json'), {
    schema: 'automonique.android-preview-maven-licenses/v1',
    configuration: raw.configuration,
    policy: {
      allowlist: LICENSE_ALLOWLIST,
      unknownOrDisallowed: 'block',
    },
    artifacts: inventory.map(({ noticeContents, ...artifact }) => artifact),
  });

  const markdown = [
    '# Android preview Maven notices',
    '',
    'Generated from the exact `releaseRuntimeClasspath`. Unknown or disallowed',
    'license metadata blocks the preview workflow.',
    '',
  ];
  for (const artifact of inventory) {
    markdown.push(`## ${artifact.coordinate}`, '');
    markdown.push(
      artifact.artifactFile
        ? `- Artifact: \`${artifact.artifactFile}\``
        : '- Artifact: metadata-only Maven POM',
    );
    if (artifact.artifactSha256) {
      markdown.push(`- SHA-256: \`${artifact.artifactSha256}\``);
    }
    markdown.push(`- POM SHA-256: \`${artifact.pomSha256}\``);
    if (artifact.inheritedFrom) {
      markdown.push(`- License inherited from: \`${artifact.inheritedFrom}\``);
    }
    for (const license of artifact.licenses) {
      markdown.push(
        `- License: ${license.name || '(name omitted)'}${license.url ? ` — ${license.url}` : ''}`,
      );
    }
    if (artifact.noticeContents.length === 0) {
      markdown.push('- Bundled license/notice files: none');
    } else {
      for (const notice of artifact.noticeContents) {
        markdown.push('', `### ${notice.entry}`, '');
        markdown.push(...notice.text.split('\n').map((line) => `    ${line}`));
      }
    }
    markdown.push('');
  }
  writeFileSync(
    join(outputDir, 'MAVEN_THIRD_PARTY_NOTICES.md'),
    `${markdown.join('\n').trimEnd()}\n`,
    'utf8',
  );
}

function toolVersions(sdkRoot) {
  const sdkManager = join(sdkRoot, 'cmdline-tools/latest/bin/sdkmanager');
  const apkAnalyzer = join(sdkRoot, 'cmdline-tools/latest/bin/apkanalyzer');
  const apkSigner = join(
    sdkRoot,
    `build-tools/${CONFIG.androidBuildTools}/apksigner`,
  );
  const ndkProperties = join(
    sdkRoot,
    `ndk/${CONFIG.androidNdk}/source.properties`,
  );
  const emulator = join(sdkRoot, 'emulator/emulator');
  const adb = join(sdkRoot, 'platform-tools/adb');
  const systemImageProperties = join(
    sdkRoot,
    'system-images/android-36/google_apis/x86_64/source.properties',
  );
  for (const [path, category] of [
    [sdkManager, 'preview_sdkmanager_missing'],
    [apkAnalyzer, 'preview_apkanalyzer_missing'],
    [apkSigner, 'preview_apksigner_missing'],
    [ndkProperties, 'preview_ndk_missing'],
    [emulator, 'preview_emulator_missing'],
    [adb, 'preview_adb_missing'],
    [systemImageProperties, 'preview_system_image_missing'],
  ]) {
    assertFile(path, category);
  }
  return {
    sdkManager,
    apkAnalyzer,
    apkSigner,
    values: {
      node: text(process.execPath, ['--version']),
      npm: text('npm', ['--version']),
      java: text('java', ['-version']),
      gradle: text(join(ROOT, 'android/gradlew'), [
        '-p',
        join(ROOT, 'android'),
        '--version',
      ]),
      sdkManager: text(sdkManager, ['--version']),
      apkAnalyzer: text(apkAnalyzer, ['--version']),
      apkSigner: text(apkSigner, ['version']),
      ndk: readFileSync(ndkProperties, 'utf8').trim(),
      emulator: text(emulator, ['-version']),
      adb: text(adb, ['version']),
      systemImage: readFileSync(systemImageProperties, 'utf8').trim(),
      ubuntuEmulatorRuntime: text('dpkg-query', [
        '--show',
        '--showformat=${Package}=${Version}',
        'libpulse0',
      ]),
    },
  };
}

function verifyArtifact() {
  if (requiredEnvironment('GITHUB_EVENT_NAME') !== 'workflow_dispatch') {
    fail('preview_event_not_workflow_dispatch');
  }
  if (requiredEnvironment('GITHUB_REF') !== 'refs/heads/main') {
    fail('preview_ref_not_main');
  }

  const sourceCommit = text('git', ['rev-parse', 'HEAD']);
  const eventCommit = requiredEnvironment('GITHUB_SHA');
  if (sourceCommit !== eventCommit) fail('preview_checkout_commit_mismatch');
  const trackedStatus = text('git', [
    'status',
    '--porcelain',
    '--untracked-files=no',
  ]);
  if (trackedStatus !== '') fail('preview_tracked_tree_dirty');

  const outputDir = resolve(requiredEnvironment('PREVIEW_OUTPUT_DIR'));
  const rawInventory = resolve(requiredEnvironment('PREVIEW_MAVEN_RAW'));
  const sdkRoot = resolve(
    process.env.ANDROID_SDK_ROOT || requiredEnvironment('ANDROID_HOME'),
  );
  mkdirSync(outputDir, { recursive: true });

  const sourceApk = join(
    ROOT,
    'android/app/build/outputs/apk/release/app-release.apk',
  );
  assertFile(sourceApk, 'preview_release_apk_missing');
  const releaseDirectory = join(ROOT, 'android/app/build/outputs/apk/release');
  const releaseApks = readdirSync(releaseDirectory).filter((value) =>
    value.endsWith('.apk'),
  );
  if (releaseApks.length !== 1 || releaseApks[0] !== 'app-release.apk') {
    fail('preview_release_apk_ambiguous');
  }
  const finalApk = join(outputDir, CONFIG.artifactName);
  copyFileSync(sourceApk, finalApk);

  const tools = toolVersions(sdkRoot);
  if (tools.values.node !== `v${CONFIG.nodeVersion}`) {
    fail(`preview_node_version_drift:${tools.values.node}`);
  }
  if (tools.values.npm !== CONFIG.npmVersion) {
    fail(`preview_npm_version_drift:${tools.values.npm}`);
  }
  requireMatch(
    tools.values.java,
    /(?:openjdk|java) version "21\.0\.12(?:[+".\s])/i,
    'preview_java_version_drift',
  );
  requireMatch(
    tools.values.java,
    /Temurin-21\.0\.12\.1\+1/i,
    'preview_java_build_drift',
  );
  requireMatch(
    tools.values.gradle,
    new RegExp(`Gradle ${CONFIG.gradleVersion.replaceAll('.', '\\.')}`),
    'preview_gradle_version_drift',
  );
  requireMatch(
    tools.values.ndk,
    new RegExp(
      `Pkg.Revision\\s*=\\s*${CONFIG.androidNdk.replaceAll('.', '\\.')}`,
    ),
    'preview_ndk_version_drift',
  );
  requireMatch(
    tools.values.ubuntuEmulatorRuntime,
    /^libpulse0=\S+$/,
    'preview_ubuntu_emulator_runtime_missing',
  );

  const packagedManifest = text(tools.apkAnalyzer, [
    'manifest',
    'print',
    finalApk,
  ]);
  requireMatch(
    packagedManifest,
    /package="dev\.bext\.automonique"/,
    'preview_packaged_application_id_drift',
  );
  requireMatch(
    packagedManifest,
    /android:usesCleartextTraffic="false"/,
    'preview_packaged_cleartext_not_false',
  );
  if (
    /android:usesCleartextTraffic="true"|android:networkSecurityConfig=|cleartextTrafficPermitted/i.test(
      packagedManifest,
    )
  ) {
    fail('preview_packaged_network_security_exception');
  }
  writeFileSync(
    join(outputDir, 'packaged-android-manifest.xml'),
    `${packagedManifest}\n`,
    'utf8',
  );

  const packagedFiles = text(tools.apkAnalyzer, ['files', 'list', finalApk]);
  const packagedAbis = [
    ...new Set(
      [...packagedFiles.matchAll(/(?:^|\s|\/)lib\/([^/\s]+)\//gm)].map(
        (match) => match[1],
      ),
    ),
  ].sort();
  for (const requiredAbi of ['arm64-v8a', 'x86_64']) {
    if (!packagedAbis.includes(requiredAbi)) {
      fail(`preview_packaged_abi_missing:${requiredAbi}`);
    }
  }
  writeFileSync(
    join(outputDir, 'apk-abi-inventory.txt'),
    `${packagedAbis.join('\n')}\n`,
    'utf8',
  );

  const signing = text(tools.apkSigner, [
    'verify',
    '--verbose',
    '--print-certs',
    finalApk,
  ]);
  if (/DOES NOT VERIFY/i.test(signing)) {
    fail('preview_apk_signature_invalid');
  }
  requireMatch(
    signing,
    /Verified using v[234] scheme[^:]*: true/i,
    'preview_apk_modern_signature_missing',
  );
  const signerNumbers = [
    ...signing.matchAll(/Signer #(\d+) certificate DN:/g),
  ].map((match) => match[1]);
  if (signerNumbers.length !== 1 || signerNumbers[0] !== '1') {
    fail('preview_apk_signer_count_invalid');
  }
  requireMatch(
    signing,
    /Signer #1 certificate DN:.*CN\s*=\s*Android Debug/i,
    'preview_apk_signer_not_debug',
  );
  requireMatch(
    signing,
    /Signer #1 certificate SHA-256 digest:\s*[0-9a-f]{64}/i,
    'preview_apk_certificate_digest_missing',
  );
  writeFileSync(
    join(outputDir, 'apk-signing-verification.txt'),
    `${signing}\n`,
    'utf8',
  );

  buildMavenEvidence(rawInventory, outputDir);
  copyFileSync(
    join(ROOT, 'THIRD_PARTY_NOTICES.md'),
    join(outputDir, 'NPM_THIRD_PARTY_NOTICES.md'),
  );
  copyFileSync(
    join(ROOT, 'THIRD_PARTY_NOTICES.generated.md'),
    join(outputDir, 'NPM_THIRD_PARTY_NOTICES.generated.md'),
  );

  const sourceTree = text('git', ['rev-parse', 'HEAD^{tree}']);
  const inputFiles = [
    'package-lock.json',
    'vendor/automonique-sdk-0.1.0.tgz',
    'vendor/automonique-sdk.json',
    'app.json',
    'eas.json',
  ];
  const generatedFiles = [
    'android/gradle/wrapper/gradle-wrapper.properties',
    'android/gradle.properties',
    'android/app/build.gradle',
    'android/app/src/main/AndroidManifest.xml',
  ];
  const apkStat = statSync(finalApk);
  writeJson(join(outputDir, 'provenance.json'), {
    schema: CONFIG.schema,
    source: {
      repository: requiredEnvironment('GITHUB_REPOSITORY'),
      ref: requiredEnvironment('GITHUB_REF'),
      commit: sourceCommit,
      tree: sourceTree,
    },
    workflow: {
      event: requiredEnvironment('GITHUB_EVENT_NAME'),
      runId: requiredEnvironment('GITHUB_RUN_ID'),
      runAttempt: requiredEnvironment('GITHUB_RUN_ATTEMPT'),
      runUrl: `${requiredEnvironment('GITHUB_SERVER_URL')}/${requiredEnvironment('GITHUB_REPOSITORY')}/actions/runs/${requiredEnvironment('GITHUB_RUN_ID')}`,
      runner: {
        os: requiredEnvironment('RUNNER_OS'),
        arch: requiredEnvironment('RUNNER_ARCH'),
        imageOS: process.env.ImageOS ?? null,
        imageVersion: process.env.ImageVersion ?? null,
      },
    },
    configuration: CONFIG,
    commands: CONFIG.commands,
    toolchains: tools.values,
    inputs: Object.fromEntries(
      inputFiles.map((path) => [
        path,
        { sha256: sha256File(join(ROOT, path)) },
      ]),
    ),
    generatedNativeInputs: Object.fromEntries(
      generatedFiles.map((path) => [
        path,
        { sha256: sha256File(join(ROOT, path)) },
      ]),
    ),
    artifact: {
      name: CONFIG.artifactName,
      bytes: apkStat.size,
      sha256: sha256File(finalApk),
      distribution: 'public-non-production-android-preview',
      releaseCreated: false,
    },
    evidencePolicy: {
      mavenUnknownOrDisallowedLicense: 'block',
      allowedLicenseFamilies: LICENSE_ALLOWLIST,
      cleartextTraffic: false,
      customNetworkSecurityConfig: false,
      signer: 'generated-android-debug-only',
      requiredAbis: ['arm64-v8a', 'x86_64'],
      packagedAbis,
    },
  });

  refreshChecksums(outputDir);

  process.stdout.write(
    `${JSON.stringify({
      status: 'verified',
      artifact: relative(ROOT, finalApk),
      sha256: sha256File(finalApk),
      evidenceFiles: readdirSync(outputDir).sort(),
    })}\n`,
  );
}

function recordAttestation() {
  const outputDir = resolve(requiredEnvironment('PREVIEW_OUTPUT_DIR'));
  const bundlePath = resolve(requiredEnvironment('PREVIEW_ATTESTATION_BUNDLE'));
  assertFile(bundlePath, 'preview_attestation_bundle_missing');
  mkdirSync(outputDir, { recursive: true });
  const destination = join(outputDir, 'github-attestation.sigstore.json');
  copyFileSync(bundlePath, destination);
  writeJson(join(outputDir, 'github-attestation.json'), {
    schema: 'automonique.android-preview-attestation/v1',
    id: requiredEnvironment('PREVIEW_ATTESTATION_ID'),
    url: requiredEnvironment('PREVIEW_ATTESTATION_URL'),
    subject: CONFIG.artifactName,
    subjectSha256: sha256File(join(outputDir, CONFIG.artifactName)),
    bundle: basename(destination),
    bundleSha256: sha256File(destination),
  });
  refreshChecksums(outputDir);
}

const mode = process.argv[2];
if (mode === 'prepare-native') {
  prepareNativeProject();
} else if (mode === 'verify-artifact') {
  verifyArtifact();
} else if (mode === 'record-attestation') {
  recordAttestation();
} else {
  fail(
    'usage: android-preview-evidence.mjs <prepare-native|verify-artifact|record-attestation>',
  );
}
