# SPDX-License-Identifier: Elastic-2.0
"""Exercise the native scanner in the exact, fresh, unpaired preview APK.

The emulator supplies an emulated camera, not a pairing QR. This verifies the
native bridge, scanner activity, cancellation, and return to the pairing flow;
it does not establish physical-device decoding accuracy.
"""
import argparse
import re
import subprocess
import time
import xml.etree.ElementTree as ET
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--adb', required=True)
parser.add_argument('--output', required=True)
args = parser.parse_args()
output = Path(args.output)


def adb(*arguments):
    return subprocess.check_output([args.adb, *arguments], text=True, timeout=30)


def hierarchy():
    adb('shell', 'uiautomator', 'dump', '/sdcard/automonique-scanner.xml')
    xml = adb('shell', 'cat', '/sdcard/automonique-scanner.xml')
    return ET.fromstring(xml)


def tap_label(label, scroll=False):
    for _ in range(12):
        root = hierarchy()
        for node in root.iter('node'):
            if label in (node.get('text'), node.get('content-desc')):
                x1, y1, x2, y2 = map(int, re.findall(r'\d+', node.get('bounds', '')))
                if x2 > x1 and y2 > y1:
                    adb('shell', 'input', 'tap', str((x1 + x2) // 2), str((y1 + y2) // 2))
                    return
        if scroll:
            dimensions = adb('shell', 'wm', 'size')
            width, height = map(int, re.findall(r'(\d+)x(\d+)', dimensions)[-1])
            adb('shell', 'input', 'swipe', str(width // 2), str(height * 3 // 4), str(width // 2), str(height // 3), '350')
        time.sleep(1)
    raise RuntimeError(f'Expected scanner control not found: {label}')


adb('shell', 'pm', 'grant', 'dev.bext.automonique', 'android.permission.CAMERA')
tap_label('Scan or import QR code', scroll=True)
tap_label('Scan with camera')
for _ in range(20):
    activities = adb('shell', 'dumpsys', 'activity', 'activities')
    resumed = '\n'.join(line for line in activities.splitlines() if 'ResumedActivity' in line)
    if 'dev.bext.pairingscanner.PairingScannerActivity' in resumed:
        break
    time.sleep(1)
else:
    raise RuntimeError('The native pairing scanner did not become the resumed activity')

# Let camera initialization finish so a deferred startup crash is detected.
time.sleep(2)
assert adb('shell', 'pidof', 'dev.bext.automonique').strip()
adb('shell', 'input', 'keyevent', 'KEYCODE_BACK')
for _ in range(12):
    root = hierarchy()
    if any('Scanning stopped.' in node.get('text', '') for node in root.iter('node')):
        break
    time.sleep(1)
else:
    raise RuntimeError('Native cancellation did not return to the pairing scanner')

tap_label('Cancel')
assert adb('shell', 'pidof', 'dev.bext.automonique').strip()
(output / 'emulator-scanner-smoke.txt').write_text(
    'PASS: fresh unpaired release APK opened its native QR scanner activity and '
    'returned through cancellation to the pairing flow.\n'
    'Emulated camera only; no invite was scanned and no server was contacted.\n'
)
print('Native pairing scanner launch and cancellation smoke passed.')
