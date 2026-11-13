// SPDX-License-Identifier: Elastic-2.0
import { requireOptionalNativeModule } from 'expo';
import { fromByteArray, toByteArray } from 'base64-js';
import { PermissionsAndroid, Platform } from 'react-native';

import type { CallAudioPort } from './agent-call';

interface NativeCallAudio {
  requestPermissionAsync?(): Promise<boolean>;
  startAsync(name?: string | null): Promise<void>;
  play(pcmBase64: string): void;
  flush(): void;
  stopAsync(): Promise<void>;
  addListener(
    event: 'onFrame',
    listener: (frame: { pcm: string }) => void,
  ): { remove(): void };
  addListener(event: 'onHangUp', listener: () => void): { remove(): void };
}

const native = requireOptionalNativeModule<NativeCallAudio>('CallAudio');

/** Whether this build can capture and play call audio at all. */
export function callAudioAvailable(): boolean {
  return native !== null;
}

/** Ask for the microphone. Resolves false when the operator declines. */
export async function requestCallMicrophone(): Promise<boolean> {
  if (native === null) return false;
  if (Platform.OS === 'android') {
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    );
    if (result !== PermissionsAndroid.RESULTS.GRANTED) return false;
    // The call card in the notification shade and on the lock screen. A
    // refusal only hides the card; the call itself still works.
    if (Number(Platform.Version) >= 33) {
      await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
      ).catch(() => undefined);
    }
    return true;
  }
  return (await native.requestPermissionAsync?.()) ?? false;
}

/**
 * The platform's microphone and speaker as a call sees them. The native
 * module keeps the call audible and the microphone live while the app is in
 * the background, and presents the call to the system: a call card with the
 * agent's name, the duration and a hang-up button, shown in other apps and on
 * the lock screen.
 */
export function createCallAudio(
  options: {
    /** Who is called, shown on the system's call card. */
    readonly name?: string;
    /** The call was ended from the system's call card. */
    readonly onHangUp?: () => void;
  } = {},
): CallAudioPort {
  let subscription: { remove(): void } | null = null;
  let hangUp: { remove(): void } | null = null;
  return {
    async start(onFrame) {
      if (native === null) throw new Error('call_audio_unavailable');
      subscription = native.addListener('onFrame', (frame) =>
        onFrame(toByteArray(frame.pcm)),
      );
      hangUp = native.addListener('onHangUp', () => options.onHangUp?.());
      await native.startAsync(options.name ?? null);
    },
    play(pcm) {
      native?.play(fromByteArray(pcm));
    },
    flush() {
      native?.flush();
    },
    async stop() {
      subscription?.remove();
      subscription = null;
      hangUp?.remove();
      hangUp = null;
      await native?.stopAsync();
    },
  };
}
