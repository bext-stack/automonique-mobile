# SPDX-License-Identifier: Elastic-2.0
"""Replace only JS in a verified native-compatible APK for private preflight.

This transformed APK must never be published or treated as release evidence.
The governed release workflow separately builds and tests the final artifact.
"""
import sys
import zipfile
from pathlib import Path

root = Path(sys.argv[1])
with zipfile.ZipFile(root / 'base.apk') as source, zipfile.ZipFile(root / 'unsigned.apk', 'w') as target:
    replaced = 0
    for entry in source.infolist():
        if entry.filename.startswith('META-INF/'):
            continue
        payload = source.read(entry)
        if entry.filename == 'assets/index.android.bundle':
            payload = (root / 'index.android.bundle').read_bytes()
            replaced += 1
        target.writestr(entry, payload)
    assert replaced == 1, 'Expected exactly one Android JavaScript bundle'
