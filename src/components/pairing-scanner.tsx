// SPDX-License-Identifier: Elastic-2.0

import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import {
  launchCameraAsync,
  requestCameraPermissionsAsync,
} from 'expo-image-picker';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { decodePairingQrJpeg } from '@/core/qr-image';
import { usePalette } from '@/theme/palette';

interface PairingScannerProps {
  readonly visible: boolean;
  readonly onCancel: () => void;
  readonly onScan: (value: string) => void;
}

const MAX_CAPTURE_PIXELS = 2_400_000;

/** Camera payloads stay in memory and are handed directly to strict decoding. */
export function PairingScanner({
  visible,
  onCancel,
  onScan,
}: PairingScannerProps) {
  const palette = usePalette();
  const [locked, setLocked] = useState(false);
  const [message, setMessage] = useState(
    'Open the system camera and fill the frame with the pairing QR code.',
  );

  async function capturePairingQr() {
    if (locked) return;
    setLocked(true);
    try {
      const permission = await requestCameraPermissionsAsync();
      if (!permission.granted) {
        setMessage(
          permission.canAskAgain
            ? 'Camera access is needed to capture the QR code.'
            : 'Camera permission is disabled in system settings. You can still paste the invite on the previous screen.',
        );
        return;
      }

      const capture = await launchCameraAsync({
        allowsEditing: false,
        base64: false,
        exif: false,
        mediaTypes: ['images'],
        quality: 0.8,
      });
      if (capture.canceled) {
        setMessage('Capture canceled. Open the camera when you are ready.');
        return;
      }

      setMessage('Reading the QR code on this device…');
      const image = capture.assets[0];
      if (image === undefined || image.width < 1 || image.height < 1) {
        throw new Error('camera_image_missing');
      }
      const scale = Math.min(
        1,
        Math.sqrt(MAX_CAPTURE_PIXELS / (image.width * image.height)),
      );
      const resized = await manipulateAsync(
        image.uri,
        scale < 1
          ? [
              {
                resize: {
                  width: Math.max(1, Math.floor(image.width * scale)),
                },
              },
            ]
          : [],
        { base64: true, compress: 0.8, format: SaveFormat.JPEG },
      );
      if (resized.base64 === undefined) {
        throw new Error('camera_base64_missing');
      }
      onScan(decodePairingQrJpeg(resized.base64));
    } catch {
      setMessage(
        'No pairing QR code was found. Fill the frame, hold steady, and try again.',
      );
    } finally {
      setLocked(false);
    }
  }

  return (
    <Modal
      animationType="slide"
      onRequestClose={onCancel}
      presentationStyle="fullScreen"
      visible={visible}
    >
      <SafeAreaView
        style={[styles.screen, { backgroundColor: palette.background }]}
      >
        <View style={styles.heading}>
          <Text
            accessibilityRole="header"
            style={[styles.title, { color: palette.text }]}
          >
            Scan pairing invite
          </Text>
          <Text style={[styles.copy, { color: palette.textMuted }]}>
            Capture the QR code shown by your Automonique server. It is decoded
            locally, the one-time secret is not saved, and you will review the
            server before connecting.
          </Text>
        </View>

        <View
          accessibilityLabel="Pairing QR camera capture"
          style={[
            styles.captureCard,
            { backgroundColor: palette.surface, borderColor: palette.border },
          ]}
        >
          <Text style={[styles.captureTitle, { color: palette.text }]}>QR</Text>
          <Text style={[styles.copy, { color: palette.textMuted }]}>
            Camera access is used only for this capture. The image is resized
            and decoded locally, then discarded.
          </Text>
        </View>

        <Text
          accessibilityLiveRegion="polite"
          style={[styles.copy, { color: palette.textMuted }]}
        >
          {message}
        </Text>
        <Pressable
          accessibilityRole="button"
          disabled={locked}
          onPress={() => void capturePairingQr()}
          style={[
            styles.primary,
            {
              backgroundColor: palette.accent,
              opacity: locked ? 0.55 : 1,
            },
          ]}
        >
          <Text style={{ color: palette.accentText, fontWeight: '800' }}>
            {locked ? 'Reading QR code…' : 'Open camera'}
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          onPress={onCancel}
          style={[styles.secondary, { borderColor: palette.border }]}
        >
          <Text style={{ color: palette.text, fontWeight: '800' }}>Cancel</Text>
        </Pressable>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 20, gap: 20 },
  heading: { gap: 8 },
  title: { fontSize: 28, lineHeight: 34, fontWeight: '800' },
  copy: { fontSize: 14, lineHeight: 21 },
  captureCard: {
    flex: 1,
    minHeight: 320,
    borderRadius: 24,
    borderWidth: 1,
    padding: 28,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
  },
  captureTitle: { fontSize: 64, lineHeight: 72, fontWeight: '900' },
  primary: {
    minHeight: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondary: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
