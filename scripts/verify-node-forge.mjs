// SPDX-License-Identifier: Elastic-2.0

import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const metadata = JSON.parse(readFileSync(join(root, 'vendor/node-forge.json')));
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json')));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
assert.equal(
  sha256(readFileSync(join(root, 'vendor', metadata.archive))),
  metadata.archiveSha256,
);
const copies = Object.entries(lock.packages).filter(([path]) =>
  path.endsWith('/node-forge'),
);
assert.ok(copies.length > 0, 'node-forge backport must be installed');
for (const [path, entry] of copies) {
  assert.equal(entry.version, metadata.version);
  assert.equal(entry.integrity, metadata.integrity);
  assert.equal(
    JSON.parse(readFileSync(join(root, path, 'package.json'))).version,
    metadata.version,
  );
  assert.equal(
    sha256(readFileSync(join(root, path, 'lib/rsa.js'))),
    metadata.patchedRsaSha256,
  );

  // Independent OpenSSL oracle plus a malformed nested DigestAlgorithm regression.
  const forge = require(join(root, path));
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const key = forge.pki.privateKeyFromPem(
    privateKey.export({ type: 'pkcs1', format: 'pem' }),
  );
  const verifier = forge.pki.publicKeyFromPem(
    publicKey.export({ type: 'spki', format: 'pem' }),
  );
  const message = Buffer.from('Automonique RSA verification regression');
  const digest = createHash('sha256').update(message).digest('latin1');
  const valid = sign('sha256', message, privateKey);
  assert.equal(verifier.verify(digest, valid.toString('latin1')), true);
  assert.equal(
    verifier.verify(
      createHash('sha256').update('wrong message').digest('latin1'),
      valid.toString('latin1'),
    ),
    false,
  );
  const { asn1 } = forge;
  const node = (type, constructed, value) =>
    asn1.create(asn1.Class.UNIVERSAL, type, constructed, value);
  for (const includeNull of [true, false]) {
    const algorithm = [
      node(
        asn1.Type.OID,
        false,
        asn1.oidToDer(forge.pki.oids.sha256).getBytes(),
      ),
    ];
    if (includeNull) algorithm.push(node(asn1.Type.NULL, false, ''));
    const encode = () =>
      asn1
        .toDer(
          node(asn1.Type.SEQUENCE, true, [
            node(asn1.Type.SEQUENCE, true, algorithm),
            node(asn1.Type.OCTETSTRING, false, digest),
          ]),
        )
        .getBytes();
    assert.equal(verifier.verify(digest, key.sign(encode(), 'NONE')), true);
    // This extra child was silently accepted by upstream 1.4.0.
    algorithm.push(
      node(asn1.Type.OCTETSTRING, false, 'unvalidated extra child'),
    );
    const malformed = key.sign(encode(), 'NONE');
    assert.equal(
      verify('sha256', message, publicKey, Buffer.from(malformed, 'latin1')),
      false,
    );
    assert.throws(() => verifier.verify(digest, malformed), /DigestInfo/);
  }
}
console.log(
  `Verified ${copies.length} node-forge backport(s): pinned bytes and RSA regression passed.`,
);
