// SPDX-License-Identifier: Elastic-2.0

import { useLanguage } from '@/i18n/language';

import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import { Screen } from '@/components/screen';
import {
  describeAccountSignInError,
  redeemAccountSignIn,
  signInGrant,
  takeAccountSignIn,
} from '@/core/account-signin';
import {
  decodePairingOfferText,
  describePairingError,
} from '@/core/pairing-offer';
import { useMobileLifecycle } from '@/providers/production-mobile-provider';
import { usePalette } from '@/theme/palette';

/**
 * Where the browser returns after an account sign-in
 * (`automonique://signin?grant=…`). It redeems the grant for a pairing offer
 * and connects, exactly as a scanned invite would.
 */
export default function SignInReturnScreen() {
  const { t } = useLanguage();
  const palette = usePalette();
  const { pair } = useMobileLifecycle();
  const params = useLocalSearchParams<{ grant?: string }>();
  const started = useRef(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const controller = new AbortController();
    void (async () => {
      try {
        const attempt = takeAccountSignIn();
        const grant = signInGrant(params.grant);
        if (attempt === null || grant === null) {
          throw new Error('account_signin_not_started');
        }
        const text = await redeemAccountSignIn(
          attempt,
          grant,
          controller.signal,
        );
        let offer;
        try {
          offer = decodePairingOfferText(text);
          // The offer must be for the server the person chose to sign in to.
          if (offer.origin !== attempt.origin) {
            throw new Error('mobile_server_identity_mismatch');
          }
          await pair(offer);
        } catch (error) {
          setFailure(describePairingError(error));
          return;
        }
        router.replace('/(tabs)');
      } catch (error) {
        setFailure(describeAccountSignInError(error));
      }
    })();
    // The redemption is single-use: it must finish even if this screen is
    // re-rendered, so it is not aborted on cleanup.
  }, [pair, params.grant]);

  return (
    <Screen>
      {failure === null ? (
        <>
          <ActivityIndicator color={palette.accent} />
          <Text
            accessibilityLiveRegion="polite"
            style={[styles.copy, { color: palette.text }]}
          >
            {t('Finishing sign-in…')}
          </Text>
        </>
      ) : (
        <>
          <Text
            accessibilityRole="alert"
            style={[styles.copy, { color: palette.text }]}
          >
            {t(failure)}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.replace('/settings')}
            style={[styles.button, { backgroundColor: palette.accent }]}
          >
            <Text style={{ color: palette.accentText, fontWeight: '800' }}>
              {t('Back to connection')}
            </Text>
          </Pressable>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  copy: { fontSize: 16, lineHeight: 23, marginVertical: 16 },
  button: {
    alignItems: 'center',
    borderRadius: 12,
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
});
