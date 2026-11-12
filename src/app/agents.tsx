// SPDX-License-Identifier: Elastic-2.0

import { useLanguage } from '@/i18n/language';

import type { MobileAgent, MobileAgentScope } from '@automonique/sdk';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/screen';
import { useMobile } from '@/providers/mobile-provider';
import { usePalette } from '@/theme/palette';

/** Scope label. Identifiers are shown as issued, never parsed or translated. */
export function agentScopeLabel(
  scope: MobileAgentScope,
  t: (text: string) => string,
): string {
  switch (scope.level) {
    case 'infra':
      return t('Whole installation');
    case 'tenant':
      return `${t('Tenant')} · ${scope.tenantId}`;
    case 'site':
      return `${t('Site')} · ${scope.siteId}`;
  }
}

export default function AgentsScreen() {
  const { t } = useLanguage();
  const palette = usePalette();
  const { agentsGateway, snapshot, projectionReady } = useMobile();
  const [agents, setAgents] = useState<readonly MobileAgent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const live = projectionReady && snapshot.connection.phase === 'live';

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!agentsGateway) return;
      setLoading(true);
      setError(null);
      try {
        const view = await agentsGateway.list({ action: 'list' }, signal);
        setAgents(view.agents);
      } catch {
        if (!signal?.aborted) setError('The agent list could not be loaded.');
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [agentsGateway],
  );

  useEffect(() => {
    if (!live) return;
    const controller = new AbortController();
    // Deferred so the first state change happens after this effect returns.
    void Promise.resolve().then(() => load(controller.signal));
    return () => controller.abort();
  }, [live, load]);

  return (
    <Screen bottomInset>
      <View style={styles.heading}>
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: palette.text }]}
        >
          {t('Agents')}
        </Text>
        <Text style={[styles.copy, { color: palette.textMuted }]}>
          {t(
            'Persistent agents registered on this server. Each keeps one long-lived conversation you can return to by voice.',
          )}
        </Text>
      </View>
      {!agentsGateway ? (
        <Text style={[styles.copy, { color: palette.textMuted }]}>
          {t(
            'This phone was not granted agent calls. Pair it again from the dashboard with agent calls allowed.',
          )}
        </Text>
      ) : !live ? (
        <Text style={[styles.copy, { color: palette.textMuted }]}>
          {t('Agents are available once the connection is live.')}
        </Text>
      ) : (
        <>
          {error !== null && (
            <Text accessibilityRole="alert" style={{ color: palette.danger }}>
              {t(error)}
            </Text>
          )}
          {agents !== null && agents.length === 0 && (
            <Text style={[styles.copy, { color: palette.textMuted }]}>
              {t('No agent is registered on this server yet.')}
            </Text>
          )}
          {(agents ?? []).map((agent) => (
            <View
              key={agent.id}
              style={[
                styles.card,
                {
                  backgroundColor: palette.surface,
                  borderColor: palette.surfaceMuted,
                },
              ]}
            >
              <Text style={[styles.name, { color: palette.text }]}>
                {agent.name}
              </Text>
              <Text style={[styles.scope, { color: palette.textMuted }]}>
                {agentScopeLabel(agent.scope, t)}
              </Text>
              <Text style={[styles.copy, { color: palette.text }]}>
                {agent.identity}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${t('Call')} ${agent.name}`}
                onPress={() =>
                  router.push({
                    pathname: '/agent/[id]',
                    params: { id: agent.id, name: agent.name },
                  })
                }
                style={[styles.call, { backgroundColor: palette.accent }]}
              >
                <Text style={[styles.callText, { color: palette.accentText }]}>
                  {t('Call')}
                </Text>
              </Pressable>
            </View>
          ))}
          <Pressable
            accessibilityRole="button"
            disabled={loading}
            onPress={() => void load()}
            style={styles.refresh}
          >
            <Text style={{ color: palette.accent }}>
              {loading ? t('Loading…') : t('Refresh')}
            </Text>
          </Pressable>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { gap: 6, marginBottom: 12 },
  title: { fontSize: 24, fontWeight: '700' },
  copy: { fontSize: 15, lineHeight: 21 },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    gap: 6,
    marginBottom: 12,
    padding: 14,
  },
  name: { fontSize: 18, fontWeight: '700' },
  scope: { fontSize: 13 },
  call: {
    alignItems: 'center',
    borderRadius: 10,
    marginTop: 8,
    minHeight: 44,
    justifyContent: 'center',
  },
  callText: { fontSize: 16, fontWeight: '700' },
  refresh: { alignItems: 'center', minHeight: 44, justifyContent: 'center' },
});
