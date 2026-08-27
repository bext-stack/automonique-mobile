// SPDX-License-Identifier: Elastic-2.0

import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const defaultRoot = resolve(import.meta.dirname, '..');
const forbidden = [
  'createMockGateway',
  'syntheticSnapshot',
  '@/core/mock-gateway',
  '@/core/fixtures',
  '@/core/workspace-fixtures',
  'workspace-fixtures',
  'workspaceCompanionFixture',
  '@automonique/sdk/testing',
  '@automonique/sdk/testing/internal',
  'DeterministicPlatformV2Adapter',
  'PlatformV2CanonicalTestingTransport',
  'canonicalTestingTransports',
];

const sourceExtensions = ['', '.ts', '.tsx', '.js', '.jsx'];
const routeExtensions = new Set(sourceExtensions.slice(1));

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

async function filesRecursively(directory, extensions) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    () => [],
  );
  const files = [];
  for (const entry of entries) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await filesRecursively(absolute, extensions)));
    } else if (extensions.has(extname(entry.name))) {
      files.push(absolute);
    }
  }
  return files.sort();
}

/** Audit every Expo Router entry, its source graph, and all emitted bundles. */
export async function verifyProductionBoundary({
  root = defaultRoot,
  requireBundle = false,
} = {}) {
  const appRoot = join(root, 'src/app');
  const productionEntries = await filesRecursively(appRoot, routeExtensions);
  const layoutPath = join(appRoot, '_layout.tsx');
  if (!productionEntries.includes(layoutPath)) {
    throw new Error('production_layout_missing');
  }

  const visited = new Set();
  const pending = [...productionEntries];
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
    const specifiers = new Set();
    for (const pattern of [
      /(?:from\s+|import\s*\(\s*|\brequire\s*\(\s*)(['"])([^'"]+)\1/g,
      /\bimport\s+(['"])([^'"]+)\1/g,
    ]) {
      for (const match of source.matchAll(pattern)) specifiers.add(match[2]);
    }
    for (const specifier of specifiers) {
      if (!specifier.startsWith('.') && !specifier.startsWith('@/')) continue;
      const base = specifier.startsWith('@/')
        ? join(root, 'src', specifier.slice(2))
        : resolve(dirname(absolute), specifier);
      const dependency = await existingSource(base);
      if (dependency !== null) pending.push(dependency);
    }
  }

  const bundles = await filesRecursively(
    join(root, 'dist'),
    new Set(['.hbc', '.js', '.map']),
  );
  if (requireBundle && bundles.length === 0) {
    throw new Error('production_bundle_missing');
  }
  for (const bundle of bundles) {
    const source = await readFile(bundle);
    for (const marker of forbidden) {
      if (
        source.includes(Buffer.from(marker, 'utf8')) ||
        source.includes(Buffer.from(marker, 'utf16le'))
      ) {
        throw new Error(
          `production_bundle_mock_boundary_failed:${relative(root, bundle)}:${marker}`,
        );
      }
    }
  }

  const layout = await readFile(layoutPath, 'utf8');
  if (!layout.includes('ProductionMobileProvider')) {
    throw new Error('production_mobile_provider_missing');
  }
  return {
    bundles: bundles.length,
    modules: visited.size,
    routes: productionEntries.length,
  };
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  pathToFileURL(resolve(invokedPath)).href === import.meta.url
) {
  const result = await verifyProductionBoundary({
    requireBundle: process.argv.includes('--require-bundle'),
  });
  console.log(
    `verified ${result.routes} Expo Router entries, ${result.modules} reachable production modules, and ${result.bundles} emitted bundles have no mock transport`,
  );
}
