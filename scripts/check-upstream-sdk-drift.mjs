// SPDX-License-Identifier: Elastic-2.0

import { appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const upstreamRepository = 'bext-stack/automonique';
const upstreamBranch = 'main';
const upstreamPackagePath = 'sdk/typescript/packages/sdk/package.json';
const maximumResponseBytes = 64 * 1024;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const commitPattern = /^[0-9a-f]{40}$/u;

function requireObject(value, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name}_invalid`);
  }
  return value;
}

function requireDigest(value, name) {
  if (typeof value !== 'string' || !digestPattern.test(value)) {
    throw new Error(`${name}_invalid`);
  }
  return value;
}

function requireCommit(value, name) {
  if (typeof value !== 'string' || !commitPattern.test(value)) {
    throw new Error(`${name}_invalid`);
  }
  return value;
}

export function compareSdkDigests(manifestValue, packageValue, upstreamCommit) {
  const manifest = requireObject(manifestValue, 'vendored_manifest');
  const upstreamPackage = requireObject(packageValue, 'upstream_package');
  const automonique = requireObject(
    upstreamPackage.automonique,
    'upstream_automonique_metadata',
  );

  if (
    manifest.package !== '@automonique/sdk' ||
    upstreamPackage.name !== '@automonique/sdk'
  ) {
    throw new Error('automonique_sdk_package_identity_invalid');
  }

  const localSchemaDigest = requireDigest(
    manifest.schemaDigest,
    'vendored_schema_digest',
  );
  const upstreamSchemaDigest = requireDigest(
    automonique.schemaDigest,
    'upstream_schema_digest',
  );

  return {
    drift: localSchemaDigest !== upstreamSchemaDigest,
    localSchemaDigest,
    upstreamSchemaDigest,
    localSourceCommit: requireCommit(
      manifest.sourceCommit,
      'vendored_source_commit',
    ),
    upstreamSourceCommit: requireCommit(
      upstreamCommit,
      'upstream_source_commit',
    ),
  };
}

function parseOptions(arguments_) {
  const options = {
    manifest: resolve('vendor', 'automonique-sdk.json'),
    upstreamPackage: undefined,
    upstreamCommit: undefined,
    githubOutput: undefined,
    json: false,
  };

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--json') {
      options.json = true;
      continue;
    }

    const value = arguments_[index + 1];
    if (value === undefined) {
      throw new Error(`missing_value_for_${argument}`);
    }
    index += 1;

    if (argument === '--manifest') {
      options.manifest = resolve(value);
    } else if (argument === '--upstream-package') {
      options.upstreamPackage = value;
    } else if (argument === '--upstream-commit') {
      options.upstreamCommit = value;
    } else if (argument === '--github-output') {
      options.githubOutput = resolve(value);
    } else {
      throw new Error(`unknown_argument_${argument}`);
    }
  }

  return options;
}

async function boundedJsonFromResponse(response, name) {
  if (!response.ok) {
    throw new Error(`${name}_http_${response.status}`);
  }
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > maximumResponseBytes) {
    throw new Error(`${name}_too_large`);
  }
  return JSON.parse(text);
}

function requestHeaders() {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'automonique-mobile-sdk-drift-check',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function resolveUpstreamPackageCommit() {
  const query = new URL(
    `https://api.github.com/repos/${upstreamRepository}/commits`,
  );
  query.searchParams.set('sha', upstreamBranch);
  query.searchParams.set('path', upstreamPackagePath);
  query.searchParams.set('per_page', '1');

  const response = await fetch(query, {
    headers: requestHeaders(),
    signal: AbortSignal.timeout(15_000),
  });
  const commits = await boundedJsonFromResponse(
    response,
    'upstream_commit_lookup',
  );
  if (!Array.isArray(commits) || commits.length !== 1) {
    throw new Error('upstream_commit_lookup_invalid');
  }
  return requireCommit(commits[0]?.sha, 'upstream_source_commit');
}

async function loadJson(source, name) {
  if (/^https:\/\//u.test(source)) {
    const response = await fetch(source, {
      headers: requestHeaders(),
      signal: AbortSignal.timeout(15_000),
    });
    return boundedJsonFromResponse(response, name);
  }

  const text = await readFile(resolve(source), 'utf8');
  if (Buffer.byteLength(text, 'utf8') > maximumResponseBytes) {
    throw new Error(`${name}_too_large`);
  }
  return JSON.parse(text);
}

async function writeGithubOutput(path, result) {
  const output = [
    `drift=${String(result.drift)}`,
    `local_schema_digest=${result.localSchemaDigest}`,
    `upstream_schema_digest=${result.upstreamSchemaDigest}`,
    `local_source_commit=${result.localSourceCommit}`,
    `upstream_source_commit=${result.upstreamSourceCommit}`,
  ].join('\n');
  await appendFile(path, `${output}\n`, 'utf8');
}

function formatHumanResult(result) {
  if (!result.drift) {
    return [
      'Automonique SDK schema is current.',
      `  vendored: ${result.localSchemaDigest} (${result.localSourceCommit})`,
      `  upstream: ${result.upstreamSchemaDigest} (${result.upstreamSourceCommit})`,
    ].join('\n');
  }

  return [
    'Automonique SDK schema drift detected (informational; compatibility is still negotiated by protocol version).',
    `  vendored: ${result.localSchemaDigest} (${result.localSourceCommit})`,
    `  upstream: ${result.upstreamSchemaDigest} (${result.upstreamSourceCommit})`,
  ].join('\n');
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const manifest = JSON.parse(await readFile(options.manifest, 'utf8'));
  const upstreamCommit =
    options.upstreamCommit ?? (await resolveUpstreamPackageCommit());
  const upstreamPackageSource =
    options.upstreamPackage ??
    `https://raw.githubusercontent.com/${upstreamRepository}/${upstreamCommit}/${upstreamPackagePath}`;
  const upstreamPackage = await loadJson(
    upstreamPackageSource,
    'upstream_package',
  );
  const result = compareSdkDigests(manifest, upstreamPackage, upstreamCommit);

  if (options.githubOutput) {
    await writeGithubOutput(options.githubOutput, result);
  }
  console.log(
    options.json ? JSON.stringify(result, null, 2) : formatHumanResult(result),
  );
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isEntrypoint) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
