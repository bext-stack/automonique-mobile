// SPDX-License-Identifier: Elastic-2.0

import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import {
  launchImageLibraryAsync,
  requestCameraPermissionsAsync,
} from 'expo-image-picker';
import { useEffect, useRef, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { decodePairingQrJpeg } from '@/core/qr-image';
import {
  dismissPairingScanner,
  scanPairingQr,
} from '@/core/native-pairing-scanner';
import { MAX_PAIRING_OFFER_BYTES } from '@/core/pairing-offer';
import { usePalette } from '@/theme/palette';

interface PairingScannerProps {
  readonly visible: boolean;
  readonly onCancel: () => void;
  readonly onScan: (value: string) => void;
}

const MAX_CAPTURE_PIXELS = 2_400_000;

/** Scan live with native camera decoding; keep saved-image import as a fallback. */
export function PairingScanner({
  visible,
  onCancel,
  onScan,
}: PairingScannerProps) {
  const palette = usePalette();
  const generation = useRef(0);
  const inFlight = useRef(false);
  const [locked, setLocked] = useState(false);
  const [message, setMessage] = useState(
    'Point the camera at the pairing QR code. It will be read automatically.',
  );

  useEffect(() => {
    generation.current += 1;
    inFlight.current = false;
    return () => {
      generation.current += 1;
      void dismissPairingScanner().catch(() => undefined);
    };
  }, [visible]);

  function cancel() {
    generation.current += 1;
    inFlight.current = false;
    setLocked(false);
    void dismissPairingScanner().catch(() => undefined);
    onCancel();
  }

  async function readPairingQr(source: 'camera' | 'library') {
    if (inFlight.current || !visible) return;
    inFlight.current = true;
    const operation = generation.current;
    const active = () => generation.current === operation;
    setLocked(true);
    try {
      if (source === 'camera') {
        if (Platform.OS === 'web') {
          setMessage(
            'Live scanning is available in the mobile app. Import the downloaded QR image here.',
          );
          return;
        }
        const permission = await requestCameraPermissionsAsync();
        if (!active()) return;
        if (!permission.granted) {
          setMessage(
            permission.canAskAgain
              ? 'Allow camera access, or import a saved QR image below.'
              : 'Camera access is disabled in system settings. You can import a QR image instead.',
          );
          return;
        }
        const value = await scanPairingQr();
        if (!active()) return;
        if (value === null) {
          setMessage('Scanning stopped. Try again or import a saved QR image.');
          return;
        }
        if (value.length === 0 || value.length > MAX_PAIRING_OFFER_BYTES) {
          throw new Error('mobile_pairing_qr_invalid');
        }
        generation.current += 1;
        onScan(value);
        return;
      }
      const capture = await launchImageLibraryAsync({
        allowsEditing: false,
        base64: false,
        exif: false,
        mediaTypes: ['images'],
        quality: 0.8,
      });
      if (!active()) return;
      if (capture.canceled) {
        setMessage(
          'Selection canceled. Scan the code or choose a saved QR image when ready.',
        );
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
      if (!active()) return;
      const value = decodePairingQrJpeg(resized.base64);
      generation.current += 1;
      onScan(value);
    } catch {
      if (!active()) return;
      setMessage(
        source === 'camera'
          ? 'Live scanning is unavailable. Try again, import the QR image downloaded from Monique, or cancel and paste the invite.'
          : 'No pairing QR code was found. Choose the QR image downloaded from Monique, or try live scanning.',
      );
    } finally {
      if (active()) {
        inFlight.current = false;
        setLocked(false);
      }
    }
  }

  return (
    <Modal
      animationType="slide"
      onRequestClose={cancel}
      presentationStyle="fullScreen"
      visible={visible}
    >
      <SafeAreaView
        style={[styles.screen, { backgroundColor: palette.background }]}
      >
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.heading}>
            <Text
              accessibilityRole="header"
              style={[styles.title, { color: palette.text }]}
            >
              Open pairing QR code
            </Text>
            <Text style={[styles.copy, { color: palette.textMuted }]}>
              Point your camera at the code on another screen. It scans
              automatically, without taking a photo. You can also import the
              downloaded QR image. Review the server before connecting.
            </Text>
          </View>

          <View
            accessibilityLabel="Pairing QR scanner"
            style={[
              styles.captureCard,
              { backgroundColor: palette.surface, borderColor: palette.border },
            ]}
          >
            <Text style={[styles.captureTitle, { color: palette.text }]}>
              QR
            </Text>
            <Text style={[styles.copy, { color: palette.textMuted }]}>
              QR images are read on this device and are never uploaded.
              Downloaded invitations expire after five minutes.
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
            onPress={() => void readPairingQr('camera')}
            style={[
              styles.primary,
              {
                backgroundColor: palette.accent,
                opacity: locked ? 0.55 : 1,
              },
            ]}
          >
            <Text style={{ color: palette.accentText, fontWeight: '800' }}>
              {locked ? 'Reading QR code…' : 'Scan with camera'}
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            disabled={locked}
            onPress={() => void readPairingQr('library')}
            style={[
              styles.secondary,
              { borderColor: palette.border, opacity: locked ? 0.55 : 1 },
            ]}
          >
            <Text style={{ color: palette.text, fontWeight: '800' }}>
              Import QR image
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={cancel}
            style={[styles.secondary, { borderColor: palette.border }]}
          >
            <Text style={{ color: palette.text, fontWeight: '800' }}>
              Cancel
            </Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flexGrow: 1, padding: 20, gap: 20 },
  heading: { gap: 8 },
  title: { fontSize: 28, lineHeight: 34, fontWeight: '800' },
  copy: { fontSize: 14, lineHeight: 21 },
  captureCard: {
    flex: 1,
    minHeight: 140,
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
