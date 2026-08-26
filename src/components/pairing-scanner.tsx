// SPDX-License-Identifier: Elastic-2.0

import { CameraView, useCameraPermissions } from 'expo-camera';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { usePalette } from '@/theme/palette';

interface PairingScannerProps {
  readonly visible: boolean;
  readonly onCancel: () => void;
  readonly onScan: (value: string) => void;
}

/** Camera payloads stay in memory and are handed directly to strict decoding. */
export function PairingScanner({
  visible,
  onCancel,
  onScan,
}: PairingScannerProps) {
  const palette = usePalette();
  const [permission, requestPermission] = useCameraPermissions();
  const [locked, setLocked] = useState(false);

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
            Scan the QR code shown by your Automonique server. The one-time
            secret is not saved, and you will review the server before
            connecting.
          </Text>
        </View>

        {permission?.granted ? (
          <View
            accessibilityLabel="Pairing QR camera"
            style={[styles.cameraFrame, { borderColor: palette.border }]}
          >
            <CameraView
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              facing="back"
              onBarcodeScanned={
                locked
                  ? undefined
                  : ({ data }) => {
                      setLocked(true);
                      onScan(data);
                    }
              }
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
