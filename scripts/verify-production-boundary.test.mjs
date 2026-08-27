// SPDX-License-Identifier: Elastic-2.0

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { verifyProductionBoundary } from './verify-production-boundary.mjs';

async function fixture() {
  const root = await mkdtemp(
    join(tmpdir(), 'automonique-production-boundary-'),
  );
  await mkdir(join(root, 'src/app/(tabs)'), { recursive: true });
  await writeFile(
    join(root, 'src/app/_layout.tsx'),
    'const ProductionMobileProvider = true; export default ProductionMobileProvider;\n',
  );
  await writeFile(
    join(root, 'src/app/(tabs)/index.tsx'),
    'export default function Index() { return null; }\n',
  );
  return root;
}

test('seeds the audit with every Expo Router-discovered route entry', async () => {
  const root = await fixture();
  try {
    await writeFile(
      join(root, 'src/app/(tabs)/hidden.tsx'),
      "import { createMockGateway } from '@/core/mock-gateway'; export default createMockGateway;\n",
    );
    await assert.rejects(
      verifyProductionBoundary({ root }),
      /production_mock_boundary_failed:src\/app\/\(tabs\)\/hidden\.tsx:createMockGateway/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('reports every clean route and its reachable dependency once', async () => {
  const root = await fixture();
  try {
    await mkdir(join(root, 'src/core'), { recursive: true });
    await writeFile(
      join(root, 'src/core/shared.ts'),
      'export const shared = 1;\n',
    );
    await writeFile(
      join(root, 'src/app/settings.tsx'),
      "import { shared } from '@/core/shared'; export default shared;\n",
    );
    const result = await verifyProductionBoundary({ root });
    assert.deepEqual(result, { bundles: 0, modules: 4, routes: 3 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('follows side-effect imports and CommonJS requires from route source', async () => {
  const root = await fixture();
  try {
    await mkdir(join(root, 'src/core'), { recursive: true });
    await writeFile(
      join(root, 'src/core/side-effect.ts'),
      'export const syntheticSnapshot = true;\n',
    );
    await writeFile(
      join(root, 'src/core/required.ts'),
      'export const createMockGateway = true;\n',
    );
    await writeFile(
      join(root, 'src/app/settings.tsx'),
      "import '@/core/side-effect'; const dependency = require('@/core/required'); export default dependency;\n",
    );
    await assert.rejects(
      verifyProductionBoundary({ root }),
      /production_mock_boundary_failed:src\/core\/(?:required|side-effect)\.ts:(?:createMockGateway|syntheticSnapshot)/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
