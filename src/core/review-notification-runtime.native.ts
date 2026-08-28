// SPDX-License-Identifier: Elastic-2.0

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { NotificationPermission } from './review-notifications';
import type { ReviewNotificationRuntime } from './review-notification-runtime';

function permissionOf(
  value: Notifications.NotificationPermissionsStatus,
): NotificationPermission {
  return value.status === Notifications.PermissionStatus.GRANTED
    ? 'granted'
    : value.canAskAgain
      ? 'undetermined'
      : 'denied';
}

export const reviewNotificationRuntime: ReviewNotificationRuntime = {
  supported: true,
  async configure() {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldPlaySound: false,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('review-attention', {
        name: 'Review attention',
        importance: Notifications.AndroidImportance.DEFAULT,
        enableVibrate: false,
        sound: null,
      });
    }
  },
  async permission() {
    return permissionOf(await Notifications.getPermissionsAsync());
  },
  async requestPermission() {
    const current = await Notifications.getPermissionsAsync();
    return permissionOf(
      current.status === Notifications.PermissionStatus.GRANTED ||
        !current.canAskAgain
        ? current
        : await Notifications.requestPermissionsAsync(),
    );
  },
  async lastResponse() {
    const response = await Notifications.getLastNotificationResponseAsync();
    return response?.notification.request.content.data ?? null;
  },
  async clearLastResponse() {
    await Notifications.clearLastNotificationResponseAsync();
  },
  onResponse(listener) {
    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => listener(response.notification.request.content.data),
    );
    return () => subscription.remove();
  },
  async schedule(content) {
    await Notifications.scheduleNotificationAsync({
      content,
      trigger:
        Platform.OS === 'android' ? { channelId: 'review-attention' } : null,
    });
  },
};
