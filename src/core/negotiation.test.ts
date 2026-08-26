// SPDX-License-Identifier: Elastic-2.0

import vendorManifest from '../../vendor/automonique-sdk.json';

import {
  SUPPORTED_MOBILE_PROTOCOL_VERSIONS,
  negotiateMobileProtocolVersion,
} from './negotiation';
import { AUTOMONIQUE_SDK_METADATA } from './sdk-metadata';

const { min, max } = SUPPORTED_MOBILE_PROTOCOL_VERSIONS;
const NEWER_THAN_THIS_BUILD = max + 1n;

test('admits a server that also advertises a version newer than this build', () => {
  expect(negotiateMobileProtocolVersion([max, NEWER_THAN_THIS_BUILD])).toBe(
    max,
  );
});

test('refuses a server whose only version this build cannot speak', () => {
  expect(() => negotiateMobileProtocolVersion([NEWER_THAN_THIS_BUILD])).toThrow(
    'mobile_protocol_unsupported',
  );
});

test('refuses a server that advertises no version at all', () => {
  expect(() => negotiateMobileProtocolVersion([])).toThrow(
    'mobile_protocol_unsupported',
  );
});

test('selects the highest mutually supported version, whatever the order', () => {
  expect(
    negotiateMobileProtocolVersion([NEWER_THAN_THIS_BUILD, min, max]),
  ).toBe(max);
});

test('refuses a version below the range this build supports', () => {
  expect(() => negotiateMobileProtocolVersion([min - 1n])).toThrow(
    'mobile_protocol_unsupported',
  );
});

test('records the vendored schema digest as evidence rather than negotiating on it', () => {
  // The manifest, the installed archive and the runtime constant must agree,
  // because the digest is this build's provenance record. Nothing in admission
  // reads it: a version the build supports is admitted no matter which
  // generated surface the server was built from.
  expect(AUTOMONIQUE_SDK_METADATA.schemaDigest).toBe(
    vendorManifest.schemaDigest,
  );
  expect(vendorManifest.sourceCommit).toMatch(/^[0-9a-f]{40}$/u);
  expect(negotiateMobileProtocolVersion([max])).toBe(max);
});
