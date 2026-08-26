// SPDX-License-Identifier: Elastic-2.0

import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { decodePairingQrJpeg } from '@/core/qr-image';
import { usePalette } from '@/theme/palette';

interface PairingScannerProps {
  readonly visible: boolean;
  readonly onCancel: () => void;
  readonly onScan: (value: string) => void;
}

function choosePictureSize(sizes: readonly string[]): string | null {
  const candidates = sizes
    .map((value) => {
      const match = /^(\d+)x(\d+)$/.exec(value);
      if (match === null) return null;
      return { value, pixels: Number(match[1]) * Number(match[2]) };
    })
    .filter(
      (value): value is { value: string; pixels: number } => value !== null,
    )
    .sort((left, right) => left.pixels - right.pixels);
  return (
    candidates.filter(({ pixels }) => pixels <= 2_500_000).at(-1)?.value ??
    candidates[0]?.value ??
    null
  );
}

/** Camera payloads stay in memory and are handed directly to strict decoding. */
export function PairingScanner({
  visible,
  onCancel,
  onScan,
}: PairingScannerProps) {
  const palette = usePalette();
  const camera = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [locked, setLocked] = useState(false);
  const [pictureSize, setPictureSize] = useState<string | null>(null);
  const [message, setMessage] = useState(
    'Center the QR code in the frame, then capture it.',
  );

  async function prepareCamera() {
    try {
      const sizes = await camera.current?.getAvailablePictureSizesAsync();
      const selected = choosePictureSize(sizes ?? []);
      if (selected === null) throw new Error('camera_picture_sizes_missing');
      setPictureSize(selected);
    } catch {
      setMessage('This camera could not provide a bounded capture size.');
    }
  }

  async function capturePairingQr() {
    if (locked || pictureSize === null || camera.current === null) return;
    setLocked(true);
    setMessage('Reading the QR code on this device…');
    try {
      const picture = await camera.current.takePictureAsync({
        base64: true,
        quality: 0.8,
        skipProcessing: false,
      });
      if (picture.base64 === undefined) {
        throw new Error('camera_base64_missing');
      }
      onScan(decodePairingQrJpeg(picture.base64));
    } catch {
      setLocked(false);
      setMessage(
        'No pairing QR code was found. Hold steady, fill the frame, and try again.',
      );
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

        {permission?.granted ? (
          <View
            accessibilityLabel="Pairing QR camera"
            style={[styles.cameraFrame, { borderColor: palette.border }]}
          >
            <CameraView
              facing="back"
              onCameraReady={() => void prepareCamera()}
              pictureSize={pictureSize ?? undefined}
              ref={camera}
              style={styles.camera}
            />
            <View pointerEvents="none" style={styles.guide} />
          </View>
        ) : (
          <View
            style={[
              styles.permission,
              { backgroundColor: palette.surface, borderColor: palette.border },
            ]}
          >
            <Text style={[styles.copy, { color: palette.textMuted }]}>
              Camera access is used only while this scanner is open.
            </Text>
            {permission?.canAskAgain !== false && (
              <Pressable
                accessibilityRole="button"
                onPress={() => void requestPermission()}
                style={[styles.primary, { backgroundColor: palette.accent }]}
              >
                <Text style={{ color: palette.accentText, fontWeight: '800' }}>
                  Allow camera
                </Text>
              </Pressable>
            )}
            {permission?.canAskAgain === false && (
              <Text style={[styles.copy, { color: palette.danger }]}>
                Camera permission is disabled in system settings. You can still
                paste the invite on the previous screen.
              </Text>
            )}
          </View>
        )}

        {permission?.granted && (
          <>
            <Text
              accessibilityLiveRegion="polite"
              style={[styles.copy, { color: palette.textMuted }]}
            >
              {message}
            </Text>
            <Pressable
              accessibilityRole="button"
              disabled={locked || pictureSize === null}
              onPress={() => void capturePairingQr()}
              style={[
                styles.primary,
                {
                  backgroundColor: palette.accent,
                  opacity: locked || pictureSize === null ? 0.55 : 1,
                },
              ]}
            >
              <Text style={{ color: palette.accentText, fontWeight: '800' }}>
                {locked ? 'Reading QR code…' : 'Capture QR code'}
              </Text>
            </Pressable>
          </>
        )}

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
  cameraFrame: {
    flex: 1,
    minHeight: 320,
    overflow: 'hidden',
    borderRadius: 24,
    borderWidth: 1,
  },
  camera: { flex: 1 },
  guide: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 22,
    borderWidth: 3,
    borderColor: '#FFFFFF',
    alignSelf: 'center',
    top: '25%',
  },
  permission: { borderWidth: 1, borderRadius: 18, padding: 18, gap: 16 },
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
