// SPDX-License-Identifier: Elastic-2.0

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.slice(2).includes('--check');
const deriveDigests = process.argv.slice(2).includes('--derive-digests');
const notificationsRoot = join(root, 'node_modules', 'expo-notifications');
const packagePath = join(notificationsRoot, 'package.json');
const EXPECTED_VERSION = '57.0.15';

const files = {
  gradle: {
    path: join(notificationsRoot, 'android', 'build.gradle'),
    pristine:
      '1c9afeb0e10915012febd59eab6534814c49b8732b33ce67309d019e4517b5ae',
    hardened:
      'cb59d4348dc25f73423b83eb7179a3a023795bf186cafe4749ba4b9e4738ea99',
    transform(contents) {
      contents = replaceExactlyOnce(
        contents,
        '  namespace "expo.modules.notifications"\n',
        `  namespace "expo.modules.notifications"\n  sourceSets {\n    main.java {\n      // Automonique is local-notifications-only. Remote push is excluded fail-closed.\n      exclude 'expo/modules/notifications/notifications/RemoteMessageSerializer.java'\n      exclude 'expo/modules/notifications/notifications/background/BackgroundRemoteNotificationTaskConsumer.kt'\n      exclude 'expo/modules/notifications/notifications/background/ExpoBackgroundNotificationTasksModule.kt'\n      exclude 'expo/modules/notifications/notifications/model/RemoteNotificationContent.kt'\n      exclude 'expo/modules/notifications/notifications/model/triggers/FirebaseNotificationTrigger.kt'\n      exclude 'expo/modules/notifications/service/ExpoFirebaseMessagingService.kt'\n      exclude 'expo/modules/notifications/service/delegates/FirebaseMessagingDelegate.kt'\n      exclude 'expo/modules/notifications/service/interfaces/FirebaseMessagingDelegate.kt'\n      exclude 'expo/modules/notifications/tokens/PushTokenModule.kt'\n      exclude 'expo/modules/notifications/tokens/interfaces/FirebaseTokenListener.kt'\n      exclude 'expo/modules/notifications/topics/TopicSubscriptionModule.kt'\n    }\n  }\n`,
      );
      return replaceExactlyOnce(
        contents,
        '  // release notes in https://firebase.google.com/support/release-notes/android - cmd + f "Cloud Messaging version"\n  implementation \'com.google.firebase:firebase-messaging:25.0.1\'\n\n',
        '',
      );
    },
  },
  config: {
    path: join(notificationsRoot, 'expo-module.config.json'),
    pristine:
      'a1559b061b54e1a9e2438d2484cf6fbfea1374de47a760b18b8c51acbed04c8c',
    hardened:
      '78f773d0337bb0d63ad9f64d55955042718d8763d119f848a2443ba0bdb680f4',
    transform(contents) {
      for (const moduleLine of [
        '      "expo.modules.notifications.notifications.background.ExpoBackgroundNotificationTasksModule",\n',
        '      "expo.modules.notifications.tokens.PushTokenModule",\n',
        '      "expo.modules.notifications.topics.TopicSubscriptionModule",\n',
      ]) {
        contents = replaceExactlyOnce(contents, moduleLine, '');
      }
      return contents;
    },
  },
  manifest: {
    path: join(
      notificationsRoot,
      'android',
      'src',
      'main',
      'AndroidManifest.xml',
    ),
    pristine:
      '08d7b7174ad2a11749980f2b759244afd66c95a8832b910ecc0067d6cfd98730',
    hardened:
      'e0e63d365611f67ccf955a06832113e77930385b90e7e4ad19f5e06061249d91',
    transform(contents) {
      return replaceExactlyOnce(
        contents,
        `    <service\n      android:name=".service.ExpoFirebaseMessagingService"\n      android:exported="false">\n      <intent-filter android:priority="-1">\n        <action android:name="com.google.firebase.MESSAGING_EVENT" />\n      </intent-filter>\n    </service>\n\n`,
        '',
      );
    },
  },
  serializer: {
    path: join(
      notificationsRoot,
      'android',
      'src',
      'main',
      'java',
      'expo',
      'modules',
      'notifications',
      'notifications',
      'NotificationSerializer.java',
    ),
    pristine:
      '73835adc3f69d6ba2109ff7cd25d9d545fcb140600b8a3cfec1f998fac7d7056',
    hardened:
      'e89b6047babe0b5d52086f26c07154d583907da33bca4a5e24ca8670861fb0bc',
    transform(contents) {
      for (const importLine of [
        'import com.google.firebase.messaging.RemoteMessage;\n\n',
        'import expo.modules.notifications.notifications.model.triggers.FirebaseNotificationTrigger;\n\n',
      ]) {
        contents = replaceExactlyOnce(contents, importLine, '');
      }
      const start = contents.indexOf(
        '    if (existingContentData == null) {\n',
      );
      const endMarker =
        '    serializedRequest.putBundle("content", content);\n';
      const end = contents.indexOf(endMarker, start);
      assert.notEqual(start, -1, 'notification content branch moved');
      assert.notEqual(end, -1, 'notification content branch end moved');
      const replacement = `    if (\n      existingContentData == null &&\n      (requestTrigger instanceof SchedulableNotificationTrigger ||\n        requestTrigger instanceof ChannelAwareTrigger ||\n        requestTrigger == null)\n    ) {\n      JSONObject body = request.getContent().getBody();\n      if (body != null) {\n        content.putString("dataString", body.toString());\n      }\n    }\n`;
      return `${contents.slice(0, start)}${replacement}${contents.slice(end)}`;
    },
  },
  debug: {
    path: join(
      notificationsRoot,
      'android',
      'src',
      'main',
      'java',
      'expo',
      'modules',
      'notifications',
      'notifications',
      'debug',
      'DebugLogging.kt',
    ),
    pristine:
      '6fe60b34983a145db8253cac672bf9bd6b19a1e92c7909642c0505f04e65c64a',
    hardened:
      '7eee9437ae259596fd0f707ade825511f69ab37d87359e066a1353f92b473650',
    transform(contents) {
      contents = replaceExactlyOnce(
        contents,
        'import com.google.firebase.messaging.RemoteMessage\n',
        '',
      );
      const start = contents.indexOf(
        '  fun logRemoteMessage(caller: String, message: RemoteMessage) {\n',
      );
      const end = contents.indexOf(
        '  fun logNotification(caller: String, notification: Notification) {\n',
        start,
      );
      assert.notEqual(start, -1, 'remote-message logger moved');
      assert.notEqual(end, -1, 'remote-message logger end moved');
      return `${contents.slice(0, start)}${contents.slice(end)}`;
    },
  },
  handling: {
    path: join(
      notificationsRoot,
      'android',
      'src',
      'main',
      'java',
      'expo',
      'modules',
      'notifications',
      'service',
      'delegates',
      'ExpoHandlingDelegate.kt',
    ),
    pristine:
      '0d49598a7d5290d68f296171a71786a2e35d99b9c25a6c72f41d5ab9cb0961f1',
    hardened:
      '9dd67d78a2546eb7004ea67afa4635cb21b42e729d7d0dd5e9c05a928e629a08',
    transform(contents) {
      contents = replaceExactlyOnce(
        contents,
        'import expo.modules.notifications.notifications.NotificationSerializer\n',
        '',
      );
      const start = contents.indexOf(
        '    // Run background tasks only for custom notification action buttons (not the default tap).\n',
      );
      const endMarker =
        '    // NOTE the listeners are not set up when the app is killed\n';
      const end = contents.indexOf(endMarker, start);
      assert.notEqual(start, -1, 'remote background-task block moved');
      assert.notEqual(end, -1, 'remote background-task block end moved');
      return `${contents.slice(0, start)}${contents.slice(end)}`;
    },
  },
  notificationsHandler: {
    path: join(
      notificationsRoot,
      'android',
      'src',
      'main',
      'java',
      'expo',
      'modules',
      'notifications',
      'notifications',
      'handling',
      'NotificationsHandler.kt',
    ),
    pristine:
      '5f1603ce28f061a3386bc9279eb2050b7a9eeba6b68071865f0704109f0254dc',
    hardened:
      'b29885ed83a345056dbc4a819c57aaeb3f2b1e3d11966cdc96e10d3a6bec0f50',
    transform(contents) {
      contents = replaceExactlyOnce(
        contents,
        'import expo.modules.notifications.notifications.model.RemoteNotificationContent\n',
        '',
      );
      const start = contents.indexOf(
        '    val content = notification.notificationRequest.content\n',
      );
      const end = contents.indexOf(
        '    val task = SingleNotificationHandlerTask(\n',
        start,
      );
      assert.notEqual(start, -1, 'remote notification content check moved');
      assert.notEqual(end, -1, 'remote notification content check end moved');
      return `${contents.slice(0, start)}${contents.slice(end)}`;
    },
  },
};

const remoteOnlySources = {
  'notifications/RemoteMessageSerializer.java':
    '7e38e7e7936912b5c85708d13c11a88720d7c083b0cd2ffb3804b8bc1b60c95e',
  'notifications/background/BackgroundRemoteNotificationTaskConsumer.kt':
    'e2fe6b43a5e30f45d6acb8552804e2b3576f4cb49d7de74e68f560d8d193332c',
  'notifications/background/ExpoBackgroundNotificationTasksModule.kt':
    'ec5560cc037fd2ffb7417d4f7e4b28b931ee9e76fbec175d33c19f3689ef0e96',
  'notifications/model/RemoteNotificationContent.kt':
    '50cd5fd75a11517fae91d64e462bc3d3e3868799116d59ab13f0ee5de19cca33',
  'notifications/model/triggers/FirebaseNotificationTrigger.kt':
    '103abdca750225136f999534a862c6757ae46a1bceac7ecf9b39db432c1840f1',
  'service/ExpoFirebaseMessagingService.kt':
    '61d266837fac8925c192990b0019bcc4d6b80aea7715517877fbd40621b545d4',
  'service/delegates/FirebaseMessagingDelegate.kt':
    '51d866114bd62a329c05d45eeb6a18a532849056bec1068ef0101d319a769f32',
  'service/interfaces/FirebaseMessagingDelegate.kt':
    '096bd1145af48cd2a202d594e41f49eac1ac100d4e0a3897e3f50902f171101b',
  'tokens/PushTokenModule.kt':
    '102a9274962904a40090e945f2dfc22bc3f63abf5f1fc8f6dc9c8ba5fc2998f2',
  'tokens/interfaces/FirebaseTokenListener.kt':
    '3f50e57d74ed4b64b737e1e68bee13baaaded7995f702cbd7f74d7cea3a44cbf',
  'topics/TopicSubscriptionModule.kt':
    '7d231e755ca031f8bbf5fae7d179cb7407a51c35aa33b066da14627a67675d9d',
};

function sha256(contents) {
  return createHash('sha256').update(contents).digest('hex');
}

function replaceExactlyOnce(contents, before, after) {
  assert.equal(
    contents.split(before).length - 1,
    1,
    `expo-notifications source must contain exactly one expected fragment: ${before.trim()}`,
  );
  return contents.replace(before, after);
}

function writeAtomically(path, contents) {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const mode = statSync(path).mode;
  try {
    writeFileSync(temporaryPath, contents, { encoding: 'utf8', mode });
    renameSync(temporaryPath, path);
  } finally {
    try {
      unlinkSync(temporaryPath);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

const notificationsPackage = JSON.parse(readFileSync(packagePath, 'utf8'));
const rootPackage = JSON.parse(
  readFileSync(join(root, 'package.json'), 'utf8'),
);
assert.deepEqual(rootPackage.expo?.autolinking?.android?.buildFromSource, [
  'expo-application',
  'expo-notifications',
]);
assert.equal(notificationsPackage.name, 'expo-notifications');
assert.equal(notificationsPackage.version, EXPECTED_VERSION);
assert.equal(notificationsPackage.license, 'MIT');

if (deriveDigests) {
  for (const [name, file] of Object.entries(files)) {
    const pristine = readFileSync(file.path, 'utf8');
    assert.equal(sha256(pristine), file.pristine, `${name} is not pristine`);
    console.log(`${name}: ${sha256(file.transform(pristine))}`);
  }
  process.exit(0);
}

for (const file of Object.values(files)) {
  const contents = readFileSync(file.path, 'utf8');
  const digest = sha256(contents);
  if (digest === file.pristine) {
    assert.equal(
      checkOnly,
      false,
      'expo-notifications is not hardened; run npm ci with lifecycle scripts enabled',
    );
    const hardened = file.transform(contents);
    assert.equal(
      sha256(hardened),
      file.hardened,
      `expo-notifications transformation drifted: ${file.path}`,
    );
    writeAtomically(file.path, hardened);
  } else {
    assert.equal(
      digest,
      file.hardened,
      `refusing to patch unreviewed expo-notifications source: ${file.path}`,
    );
  }
}

const javaRoot = join(
  notificationsRoot,
  'android',
  'src',
  'main',
  'java',
  'expo',
  'modules',
  'notifications',
);
const existingRemoteSourceCount = Object.keys(remoteOnlySources).filter(
  (relativePath) => existsSync(join(javaRoot, relativePath)),
).length;
assert.ok(
  existingRemoteSourceCount === 0 ||
    existingRemoteSourceCount === Object.keys(remoteOnlySources).length,
  'expo-notifications remote-only sources are partially removed',
);
if (checkOnly) {
  assert.equal(
    existingRemoteSourceCount,
    0,
    'expo-notifications remote-only sources remain',
  );
}
for (const [relativePath, pristineSha256] of Object.entries(
  remoteOnlySources,
)) {
  const path = join(javaRoot, relativePath);
  if (!existsSync(path)) {
    continue;
  }
  assert.equal(
    sha256(readFileSync(path)),
    pristineSha256,
    `refusing to remove unreviewed expo-notifications source: ${path}`,
  );
  unlinkSync(path);
}

for (const file of Object.values(files)) {
  const contents = readFileSync(file.path, 'utf8');
  assert.equal(sha256(contents), file.hardened);
  assert.doesNotMatch(contents, /com\.google\.firebase/u);
}

console.log(
  `expo-notifications ${EXPECTED_VERSION} is hardened for Automonique local notifications only.`,
);
