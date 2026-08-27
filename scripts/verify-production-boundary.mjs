// SPDX-License-Identifier: Elastic-2.0

import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const productionEntries = ['src/app/_layout.tsx'];
const forbidden = [
  'createMockGateway',
  'syntheticSnapshot',
  '@/core/mock-gateway',
  '@/core/fixtures',
  '@/core/workspace-fixtures',
  'workspace-fixtures',
  'workspaceCompanionFixture',
  '@automonique/sdk/testing',
  'DeterministicPlatformV2Adapter',
];

const sourceExtensions = ['', '.ts', '.tsx', '.js', '.jsx'];
const visited = new Set();
const pending = productionEntries.map((entry) => join(root, entry));

async function existingSource(base) {
  for (const suffix of sourceExtensions) {
    const candidate = `${base}${suffix}`;
    if ((await stat(candidate).catch(() => null))?.isFile()) return candidate;
  }
  for (const suffix of sourceExtensions.slice(1)) {
    const candidate = join(base, `index${suffix}`);
    if ((await stat(candidate).catch(() => null))?.isFile()) return candidate;
  }
  return null;
}

while (pending.length > 0) {
  const absolute = pending.pop();
  if (visited.has(absolute)) continue;
  visited.add(absolute);
  const source = await readFile(absolute, 'utf8');
  const sourceName = relative(root, absolute);
  for (const marker of forbidden) {
    if (source.includes(marker)) {
      throw new Error(
        `production_mock_boundary_failed:${sourceName}:${marker}`,
      );
    }
  }
  for (const match of source.matchAll(
    /(?:from\s+|import\s*\()(['"])([^'"]+)\1/g,
  )) {
    const specifier = match[2];
    if (!specifier.startsWith('.') && !specifier.startsWith('@/')) continue;
    const base = specifier.startsWith('@/')
      ? join(root, 'src', specifier.slice(2))
      : resolve(dirname(absolute), specifier);
    const dependency = await existingSource(base);
    if (dependency !== null) pending.push(dependency);
  }
}

async function emittedFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    () => [],
  );
  const files = [];
  for (const entry of entries) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await emittedFiles(absolute)));
    else if (['.hbc', '.js', '.map'].includes(extname(entry.name)))
      files.push(absolute);
  }
  return files;
}

const requireBundle = process.argv.includes('--require-bundle');
const bundles = await emittedFiles(join(root, 'dist'));
if (requireBundle && bundles.length === 0) {
  throw new Error('production_bundle_missing');
}
for (const bundle of bundles) {
  const source = await readFile(bundle, 'utf8');
  for (const marker of forbidden) {
    if (source.includes(marker)) {
      throw new Error(
        `production_bundle_mock_boundary_failed:${relative(root, bundle)}:${marker}`,
      );
    }
  }
}

const layout = await readFile(join(root, 'src/app/_layout.tsx'), 'utf8');
if (!layout.includes('ProductionMobileProvider')) {
  throw new Error('production_mobile_provider_missing');
}

console.log(
  `verified ${visited.size} reachable production modules and ${bundles.length} emitted bundles have no mock transport`,
);
