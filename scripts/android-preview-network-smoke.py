# SPDX-License-Identifier: Elastic-2.0
"""Exercise real HTTPS discovery and pairing refusal in the exact Android APK.

The offer is deliberately fabricated: this never grants access or consumes a
real invitation. It tests the same discovery/exchange path used after scanning.
"""
import argparse
import json
import re
import secrets
import shlex
import subprocess
import time
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import urlparse

parser = argparse.ArgumentParser()
parser.add_argument('--adb', required=True)
parser.add_argument('--origin', required=True)
parser.add_argument('--output', required=True)
args = parser.parse_args()
parsed = urlparse(args.origin)
assert parsed.scheme == 'https' and parsed.netloc and not parsed.username
assert parsed.path in ('', '/') and not parsed.query and not parsed.fragment
origin = args.origin.rstrip('/')
output = Path(args.output)


def adb(*arguments):
    return subprocess.check_output([args.adb, *arguments], text=True, timeout=45)


def hierarchy():
    # Android can briefly have no accessibility root while the app starts or
    # a keyboard/window transition settles. Never reuse an older XML dump.
    for _ in range(6):
        adb('shell', 'rm', '-f', '/sdcard/automonique-network.xml')
        result = adb('shell', 'uiautomator', 'dump', '/sdcard/automonique-network.xml')
        if 'UI hierchary dumped' in result:
            xml = adb('shell', 'cat', '/sdcard/automonique-network.xml')
            (output / 'emulator-network-window.xml').write_text(xml)
            return ET.fromstring(xml)
        time.sleep(1)
    raise RuntimeError('Android accessibility hierarchy did not become available')


def scroll():
    width, height = map(int, re.findall(r'(\d+)x(\d+)', adb('shell', 'wm', 'size'))[-1])
    # Swipe through the screen gutter: the multiline invite input can consume
    # centered swipes, reopen the keyboard, and turn them into glide typing.
    x = max(1, width // 20)
    adb('shell', 'input', 'swipe', str(x), str(height * 3 // 4), str(x), str(height // 3), '350')


def find(label, tap=False, scrolling=False):
    for _ in range(18):
        root = hierarchy()
        for node in root.iter('node'):
            if label in (node.get('text'), node.get('content-desc')):
                x1, y1, x2, y2 = map(int, re.findall(r'\d+', node.get('bounds', '')))
                if x2 > x1 and y2 > y1:
                    if tap:
                        adb('shell', 'input', 'tap', str((x1 + x2) // 2), str((y1 + y2) // 2))
                    return node
        if scrolling:
            scroll()
        time.sleep(1)
    raise RuntimeError(f'Expected network control not found: {label}')


def enter(label, value, scrolling=False):
    field = find(label, tap=True, scrolling=scrolling)
    # The server input starts with https://. Replace its current value rather
    # than appending another origin. ADB accepts several key codes per call.
    time.sleep(1)  # Let focus and keyboard animations settle before editing.
    existing = field.get('text', '')
    if existing:
        adb('shell', 'input', 'keyevent', 'KEYCODE_MOVE_END', *(['KEYCODE_DEL'] * len(existing)))
    time.sleep(1)  # Let the controlled input acknowledge deletions.
    # shlex.quote protects JSON quotes from the Android shell. No real proof is
    # entered by this test, and subprocess receives an explicit argument vector.
    # A controlled input can rerender between injected key events. Pace each
    # character so Android does not drop stale events or race a prior edit.
    for character in value:
        adb('shell', 'input', 'text', shlex.quote(character))
        time.sleep(0.1)
    time.sleep(1)
    adb('shell', 'input', 'keyevent', 'KEYCODE_BACK')
    field = find(label)
    assert field.get('text') == value, f'Text input did not match the intended value: {label}'


request = urllib.request.Request(origin + '/.well-known/automonique-mobile', headers={'User-Agent': 'Automonique-Android-Preview-Smoke', 'Accept': 'application/vnd.automonique.mobile-auth.v1+json'})
with urllib.request.urlopen(request, timeout=25) as response:
    assert response.status == 200 and response.url == request.full_url
    discovery = json.loads(response.read(16385))
assert discovery['origin'] == origin
assert discovery['pairing_exchange_endpoint'] == origin + '/api/mobile/pairings/exchange'

# Reset only this disposable emulator installation, after the scanner smoke.
adb('shell', 'pm', 'clear', 'dev.bext.automonique')
adb('shell', 'am', 'start', '-W', 'dev.bext.automonique/.MainActivity')
enter('Automonique HTTPS endpoint', origin, scrolling=True)
find('Check this server', tap=True, scrolling=True)
find('Compatible Automonique server', scrolling=True)

# The native app must decode the actual server's refusal, not show an outage.
offer = {
    'exchange_endpoint': discovery['pairing_exchange_endpoint'],
    'expires_at_ms': int(time.time() * 1000) + 240000,
    'origin': origin,
    'pairing_id': 'pi_' + secrets.token_urlsafe(32),
    'pairing_token': 'mp_' + secrets.token_urlsafe(32),
    'schema': 'automonique.mobile-auth/v1',
    'server_identity': discovery['server_identity'],
}
enter('One-time pairing offer', json.dumps(offer, separators=(',', ':'), sort_keys=True), scrolling=True)
find('Review pasted invite', tap=True, scrolling=True)
find('Connect this server', tap=True, scrolling=True)
find('This invite is no longer available. It may have expired or already been used. Create a new invite in Monique.', scrolling=True)
assert adb('shell', 'pidof', 'dev.bext.automonique').strip()
(output / 'emulator-network-smoke.txt').write_text(
    'PASS: exact release APK verified the real HTTPS mobile discovery API, '
    'reviewed a fabricated invite, reached pairing exchange, and displayed the '
    'server refusal instead of a network error.\n'
    'No real invite or credential was used; authenticated app flows are covered separately.\n'
)
print('Android HTTPS discovery and pairing-refusal smoke passed.')
