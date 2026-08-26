// SPDX-License-Identifier: Elastic-2.0

import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';

/** A stable app-owned boundary around the native speech module. */
export const VoiceDictationModule = {
  abort(): void {
    ExpoSpeechRecognitionModule.abort();
  },
  requestPermissionsAsync() {
    return ExpoSpeechRecognitionModule.requestPermissionsAsync();
  },
  start(
    options: Parameters<typeof ExpoSpeechRecognitionModule.start>[0],
  ): void {
    ExpoSpeechRecognitionModule.start(options);
  },
  stop(): void {
    ExpoSpeechRecognitionModule.stop();
  },
  supportsOnDeviceRecognition(): boolean {
    return ExpoSpeechRecognitionModule.supportsOnDeviceRecognition();
  },
};

export const useVoiceDictationEvent = useSpeechRecognitionEvent;
