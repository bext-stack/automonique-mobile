// SPDX-License-Identifier: Elastic-2.0

import { Link } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

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
  const palette = usePalette();
  const { catalog, status, refresh, selectServer } = useWorkspaces();
  const [query, setQuery] = useState('');
  const cards = useMemo(
    () =>
      presentWorkspaceCatalog(catalog, query).filter(
        (card) =>
          catalog.selectedServerIdentity === null ||
          card.serverIdentity === catalog.selectedServerIdentity,
      ),
    [catalog, query],
  );
  const selectedServer = catalog.servers.find(
    (server) => server.serverIdentity === catalog.selectedServerIdentity,
  );

  return (
    <Screen>
      <View style={styles.heading}>
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: palette.text }]}
        >
          Workspaces
        </Text>
        <Text style={[styles.subtitle, { color: palette.textMuted }]}>
          Projects, hosts, tasks, and retained sessions from explicit delegated
          roots.
        </Text>
      </View>

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
              ? 'Live workspace inventory'
              : 'Read-only workspace inventory'}
          </Text>
          <Text style={[styles.subtitle, { color: palette.textMuted }]}>
            {status.message}
          </Text>
          {status.coverage === 'partial' && (
            <Text style={[styles.warning, { color: palette.warning }]}>
              Partial detail coverage · {status.omittedDetailCount} bounded out
              · {status.omittedWorkspaceCount} workspaces omitted ·{' '}
              {status.failedProjectCount} project reads and{' '}
              {status.failedDetailCount} detail reads unavailable
            </Text>
          )}
        </View>
        <Pressable
          accessibilityLabel="Refresh workspace inventory"
          accessibilityRole="button"
          disabled={status.phase === 'loading'}
          onPress={() => void refresh()}
          style={[styles.refresh, { borderColor: palette.border }]}
        >
          <Text style={{ color: palette.text, fontWeight: '800' }}>
            Refresh
          </Text>
        </Pressable>
      </View>

      {catalog.servers.length > 0 && (
        <View
          accessibilityLabel="Authorized server identities"
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
                  selectServer(server.serverIdentity as ServerIdentity)
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
                    ? 'current grant'
                    : 'cached · read only'}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {selectedServer !== undefined && (
        <View
          accessibilityLabel="Delegated project and host discovery"
          style={[
            styles.scope,
            { backgroundColor: palette.surface, borderColor: palette.border },
          ]}
        >
          <Text style={[styles.statusTitle, { color: palette.text }]}>
            Delegated scope
          </Text>
          <Text style={[styles.subtitle, { color: palette.textMuted }]}>
            {selectedServer.projects.length} projects ·{' '}
            {selectedServer.hosts.length} hosts ·{' '}
            {selectedServer.workspaces.length} workspaces
          </Text>
          <View style={styles.scopeRows}>
            {selectedServer.projects.map((project) => (
              <Text
                key={project.id}
                style={[styles.scopeItem, { color: palette.text }]}
              >
                Project · {project.label}
              </Text>
            ))}
            {selectedServer.hosts.map((host) => (
              <Text
                key={host.id}
                style={[styles.scopeItem, { color: palette.textMuted }]}
              >
                Host · {host.label} · {host.state}
              </Text>
            ))}
          </View>
        </View>
      )}

      <TextInput
        accessibilityLabel="Search projects, hosts, workspaces, and external tasks"
        onChangeText={setQuery}
        placeholder="Search projects, hosts, tasks…"
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

      <View style={styles.list}>
        {cards.map((card) => (
          <Link
            key={card.key}
            asChild
            href={{
              pathname: '/workspace/[server]/[workspace]',
              params: {
                server: card.serverIdentity,
                workspace: card.workspaceId,
                revision: card.workspaceRevision,
              },
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open ${card.title} on ${card.hostLabel}`}
              style={{
                backgroundColor: palette.surface,
                borderColor: palette.border,
                borderRadius: 18,
                borderWidth: 1,
                gap: 10,
                minHeight: 96,
                padding: 16,
              }}
            >
              <View style={styles.cardTop}>
                <View style={styles.cardTitleGroup}>
                  <Text style={[styles.cardTitle, { color: palette.text }]}>
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
                  Orchestration: {card.orchestrationStatus}
                </Text>
                <Text style={[styles.state, { color: palette.textMuted }]}>
                  External:{' '}
                  {card.externalWorkItem === null
                    ? 'not reported'
                    : `${card.externalWorkItem.label} · ${card.externalWorkItem.status}`}
                </Text>
              </View>
              <Text style={[styles.meta, { color: palette.textMuted }]}>
                {freshnessLabel(card.freshness.state)} · {card.sessionCount}{' '}
                retained session{card.sessionCount === 1 ? '' : 's'} · read only
              </Text>
            </Pressable>
          </Link>
        ))}
        {cards.length === 0 && (
          <View
            style={[
              styles.empty,
              { backgroundColor: palette.surface, borderColor: palette.border },
            ]}
          >
            <Text style={[styles.cardTitle, { color: palette.text }]}>
              No matching delegated workspaces
            </Text>
            <Text style={[styles.subtitle, { color: palette.textMuted }]}>
              Mobile does not infer project roots or host access from retained
              sessions.
            </Text>
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
    padding: 14,
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
  serverFilters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
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
