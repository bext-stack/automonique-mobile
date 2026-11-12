// SPDX-License-Identifier: Elastic-2.0
import { requireOptionalNativeModule } from 'expo';
import { fromByteArray, toByteArray } from 'base64-js';
import { PermissionsAndroid, Platform } from 'react-native';

import type { CallAudioPort } from './agent-call';

interface NativeCallAudio {
  requestPermissionAsync?(): Promise<boolean>;
  startAsync(): Promise<void>;
  play(pcmBase64: string): void;
  flush(): void;
  stopAsync(): Promise<void>;
  addListener(
    event: 'onFrame',
    listener: (frame: { pcm: string }) => void,
  ): { remove(): void };
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
    return result === PermissionsAndroid.RESULTS.GRANTED;
  }
  return (await native.requestPermissionAsync?.()) ?? false;
}

/**
 * The platform's microphone and speaker as a call sees them. The native
 * module keeps the call audible and the microphone live while the app is in
 * the background, behind an ongoing system notification on Android.
 */
export function createCallAudio(): CallAudioPort {
  let subscription: { remove(): void } | null = null;
  return {
    async start(onFrame) {
      if (native === null) throw new Error('call_audio_unavailable');
      subscription = native.addListener('onFrame', (frame) =>
        onFrame(toByteArray(frame.pcm)),
      );
      await native.startAsync();
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
      await native?.stopAsync();
    },
  };
}
