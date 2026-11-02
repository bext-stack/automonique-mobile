// SPDX-License-Identifier: Elastic-2.0

import { useLanguage } from '@/i18n/language';

import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { SectionTabs } from '@/components/section-tabs';
import { Screen } from '@/components/screen';
import { presentWorkspaceCatalog } from '@/core/workspace-presentation';
import type { ServerIdentity } from '@/core/workspace-companion';
import { useWorkspaces } from '@/providers/workspace-provider';
import { usePalette } from '@/theme/palette';

function freshnessLabel(state: 'fresh' | 'delayed' | 'unknown'): string {
  return state === 'fresh'
    ? 'Current'
    : state === 'delayed'
      ? 'Delayed'
      : 'Unknown freshness';
}

export default function WorkspacesScreen() {
  const { t } = useLanguage();

  const palette = usePalette();
  const router = useRouter();
  const { catalog, status, refresh, selectServer } = useWorkspaces();
  const [query, setQuery] = useState('');
  const [scopeOpen, setScopeOpen] = useState(false);
  const [attentionOnly, setAttentionOnly] = useState(false);
  const cards = useMemo(
    () =>
      presentWorkspaceCatalog(catalog, query).filter(
        (card) =>
          query.trim().length > 0 ||
          catalog.selectedServerIdentity === null ||
          card.serverIdentity === catalog.selectedServerIdentity,
      ),
    [catalog, query],
  );
  const selectedServer = catalog.servers.find(
    (server) => server.serverIdentity === catalog.selectedServerIdentity,
  );

  return (
    <Screen showConnectionBanner={false}>
      <TextInput
        accessibilityLabel={t(
          'Search projects, hosts, workspaces, and external tasks',
        )}
        onChangeText={setQuery}
        placeholder={t('Search projects, hosts, tasks…')}
        placeholderTextColor={palette.textMuted}
        style={[
          styles.search,
          {
            backgroundColor: palette.surface,
            borderColor: palette.border,
            color: palette.text,
          },
        ]}
        value={query}
      />
      <SectionTabs
        value={attentionOnly ? 'attention' : 'all'}
        onChange={(value) => setAttentionOnly(value === 'attention')}
        items={[
          { id: 'all', label: `${t('All')} (${cards.length})` },
          { id: 'attention', label: t('Needs attention') },
        ]}
      />
      <View
        accessibilityLiveRegion="polite"
        style={[
          styles.status,
          { backgroundColor: palette.surface, borderColor: palette.border },
        ]}
      >
        <View style={styles.statusText}>
          <Text style={[styles.statusTitle, { color: palette.text }]}>
            {status.phase === 'live'
              ? t('Live workspace inventory')
              : t('Read-only workspace inventory')}
          </Text>
          {status.phase !== 'live' && (
            <Text style={[styles.subtitle, { color: palette.textMuted }]}>
              {t(status.message)}
            </Text>
          )}
          {status.coverage === 'partial' && (
            <Text style={[styles.warning, { color: palette.warning }]}>
              {t('Partial coverage ·') + ' '}
              {status.omittedProjectCount} {' ' + t('projects,')}{' '}
              {status.omittedHostCount} {' ' + t('hosts,') + ' '}
              {status.omittedWorkspaceCount} {t('workspaces,') + ' '}
              {status.omittedSessionCount} {' ' + t('sessions, and')}{' '}
              {status.omittedDetailCount} {' ' + t('details omitted ·')}{' '}
              {status.failedProjectCount} {' ' + t('project reads and')}{' '}
              {status.failedDetailCount} {' ' + t('detail reads unavailable')}
            </Text>
          )}
        </View>
        <Pressable
          accessibilityLabel={t('Refresh workspace inventory')}
          accessibilityRole="button"
          disabled={status.phase === 'loading'}
          onPress={() => void refresh()}
          style={[styles.refresh, { borderColor: palette.border }]}
        >
          <Text style={{ color: palette.text, fontWeight: '800' }}>
            {t('Refresh')}
          </Text>
        </Pressable>
      </View>

      {catalog.servers.length > 0 && (
        <View
          accessibilityLabel={t('Authorized server identities')}
          style={styles.serverFilters}
        >
          {catalog.servers.map((server) => {
            const selected =
              server.serverIdentity === catalog.selectedServerIdentity;
            return (
              <Pressable
                key={server.serverIdentity}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`${server.label}, ${server.authorization} authorization`}
                onPress={() =>
                  void selectServer(server.serverIdentity as ServerIdentity)
                }
                style={[
                  styles.serverFilter,
                  {
                    backgroundColor: selected
                      ? palette.accent
                      : palette.surface,
                    borderColor: selected ? palette.accent : palette.border,
                  },
                ]}
              >
                <Text
                  style={{
                    color: selected ? palette.accentText : palette.text,
                    fontWeight: '800',
                  }}
                >
                  {server.label}
                </Text>
                <Text
                  style={{
                    color: selected ? palette.accentText : palette.textMuted,
                    fontSize: 11,
                  }}
                >
                  {server.authorization === 'active'
                    ? t('current grant')
                    : t('cached · read only')}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {selectedServer !== undefined && (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: scopeOpen }}
            onPress={() => setScopeOpen(!scopeOpen)}
            style={{
              minHeight: 44,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Text style={{ color: palette.textMuted, fontSize: 13 }}>
              {t('Access details')} · {selectedServer.projects.length}{' '}
              {t('projects')}
            </Text>
            <Text style={{ color: palette.textMuted }}>
              {scopeOpen ? '−' : '+'}
            </Text>
          </Pressable>
          {scopeOpen && (
            <View
              accessibilityLabel={t('Delegated project and host discovery')}
              style={[
                styles.scope,
                {
                  backgroundColor: palette.surface,
                  borderColor: palette.border,
                },
              ]}
            >
              <Text style={[styles.statusTitle, { color: palette.text }]}>
                {t('Delegated scope')}
              </Text>
              <Text style={[styles.subtitle, { color: palette.textMuted }]}>
                {selectedServer.projects.length} {' ' + t('projects ·')}{' '}
                {selectedServer.hosts.length} {' ' + t('hosts ·')}{' '}
                {selectedServer.workspaces.length} {' ' + t('workspaces')}
              </Text>
              <View style={styles.scopeRows}>
                {selectedServer.projects.map((project) => (
                  <Text
                    key={project.id}
                    style={[styles.scopeItem, { color: palette.text }]}
                  >
                    {t('Project ·') + ' '}
                    {project.label}
                  </Text>
                ))}
                {selectedServer.hosts.map((host) => (
                  <Text
                    key={host.id}
                    style={[styles.scopeItem, { color: palette.textMuted }]}
                  >
                    {t('Host ·') + ' '}
                    {host.label} · {host.state}
                  </Text>
                ))}
              </View>
            </View>
          )}
        </>
      )}

      <View style={styles.list}>
        {cards
          .filter((card) => !attentionOnly || card.unreadAttention > 0)
          .map((card) => (
            <Pressable
              key={card.key}
              accessibilityRole="button"
              accessibilityLabel={`Open ${card.title} on ${card.hostLabel}`}
              onPress={() => {
                void (async () => {
                  await selectServer(card.serverIdentity as ServerIdentity);
                  router.push({
                    pathname: '/workspace/[server]/[workspace]',
                    params: {
                      server: card.serverIdentity,
                      workspace: card.workspaceId,
                      revision: card.workspaceRevision,
                    },
                  });
                })();
              }}
              style={{
                backgroundColor: palette.surface,
                borderColor: palette.border,
                borderRadius: 18,
                borderWidth: 1,
                gap: 6,
                minHeight: 80,
                padding: 12,
              }}
            >
              <View style={styles.cardTop}>
                <View style={styles.cardTitleGroup}>
                  <Text
                    numberOfLines={2}
                    style={[styles.cardTitle, { color: palette.text }]}
                  >
                    {card.title}
                  </Text>
                  <Text style={[styles.meta, { color: palette.textMuted }]}>
                    {card.projectLabel} · {card.hostLabel}
                  </Text>
                </View>
                {card.unreadAttention > 0 && (
                  <View
                    accessibilityLabel={`${card.unreadAttention} unread`}
                    style={[styles.badge, { backgroundColor: palette.accent }]}
                  >
                    <Text
                      style={{ color: palette.accentText, fontWeight: '900' }}
                    >
                      {card.unreadAttention}
                    </Text>
                  </View>
                )}
              </View>
              <View style={styles.states}>
                <Text style={[styles.state, { color: palette.text }]}>
                  {t('Orchestration:') + ' '}
                  {card.orchestrationStatus}
                </Text>
                <Text style={[styles.state, { color: palette.textMuted }]}>
                  {t('External:')}{' '}
                  {card.externalWorkItem === null
                    ? t('not reported')
                    : `${card.externalWorkItem.label} · ${card.externalWorkItem.status}`}
                </Text>
              </View>
              <Text style={[styles.meta, { color: palette.textMuted }]}>
                {t(freshnessLabel(card.freshness.state))} · {card.sessionCount}{' '}
                {t('retained session')}
                {card.sessionCount === 1 ? '' : 's'} {' ' + t('· read only')}
              </Text>
            </Pressable>
          ))}
        {cards.filter((card) => !attentionOnly || card.unreadAttention > 0)
          .length === 0 && (
          <View
            style={[
              styles.empty,
              { backgroundColor: palette.surface, borderColor: palette.border },
            ]}
          >
            <Text style={[styles.cardTitle, { color: palette.text }]}>
              {attentionOnly
                ? t('No projects need attention in this view.')
                : query.trim()
                  ? t('No matching projects')
                  : t('No projects available')}
            </Text>
            <Text style={[styles.subtitle, { color: palette.textMuted }]}>
              {t('Only projects shared with this phone appear here.')}
            </Text>
            {(query || attentionOnly) && (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setQuery('');
                  setAttentionOnly(false);
                }}
                style={{ minHeight: 44, justifyContent: 'center' }}
              >
                <Text style={{ color: palette.accent }}>
                  {t('Clear filters')}
                </Text>
              </Pressable>
            )}
          </View>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { gap: 4 },
  title: { fontSize: 30, fontWeight: '800', lineHeight: 36 },
  subtitle: { fontSize: 13, lineHeight: 19 },
  status: {
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    padding: 10,
  },
  statusText: { flex: 1, gap: 3 },
  statusTitle: { fontSize: 15, fontWeight: '800' },
  warning: { fontSize: 12, lineHeight: 17, fontWeight: '700' },
  refresh: {
    alignItems: 'center',
    alignSelf: 'center',
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 14,
  },
  serverFilters: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  serverFilter: {
    borderRadius: 14,
    borderWidth: 1,
    gap: 2,
    minHeight: 48,
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  scope: { borderRadius: 16, borderWidth: 1, gap: 5, padding: 14 },
  scopeRows: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  scopeItem: { fontSize: 12, fontWeight: '700' },
  search: {
    borderRadius: 14,
    borderWidth: 1,
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: 14,
  },
  list: { gap: 12 },
  cardTop: { alignItems: 'flex-start', flexDirection: 'row', gap: 12 },
  cardTitleGroup: { flex: 1, gap: 2 },
  cardTitle: { fontSize: 17, fontWeight: '800', lineHeight: 22 },
  meta: { fontSize: 12, lineHeight: 17 },
  badge: {
    borderRadius: 14,
    minWidth: 28,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  states: { gap: 3 },
  state: { fontSize: 13, lineHeight: 18, textTransform: 'capitalize' },
  empty: { borderRadius: 18, borderWidth: 1, gap: 6, padding: 18 },
});
