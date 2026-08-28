// SPDX-License-Identifier: Elastic-2.0

import { Link, useLocalSearchParams } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { ReviewAction } from '@automonique/sdk';

import { Screen } from '@/components/screen';
import { WorkspaceMutationConfirmation } from '@/components/workspace-mutation-confirmation';
import {
  admitWorkspaceDeepLink,
  type CompanionWorkspace,
  type ScopedServerProfile,
  type ServerIdentity,
  type WorkspaceDestination,
} from '@/core/workspace-companion';
import { decimalRevision } from '@/core/types';
import {
  admitReviewDeepLink,
  reviewActionAvailability,
  safeHunkPreview,
} from '@/core/review-attention';
import { projectReviewRenderSemantics } from '@/core/review-render-semantics';
import {
  loadReviewDrafts,
  MAX_REVIEW_DRAFT_BYTES,
  loadWorkspaceDraft,
  MAX_WORKSPACE_DRAFT_BYTES,
  persistWorkspaceDraft,
  persistReviewDraft,
  type ReviewDraftScope,
} from '@/core/workspace-storage';
import type { WorkspaceCatalogDetail } from '@/core/workspace-v2-catalog';
import type {
  PreparedWorkspaceMutation,
  WorkspaceMutationReconciliation,
} from '@/core/workspace-v2-gateway';
import {
  MOBILE_UNAVAILABLE_REVIEW_EFFECT_CATEGORIES,
  type MobileSupportedReviewAction,
} from '@/core/mobile-review-effects';
import { useMobile } from '@/providers/mobile-provider';
import { useMobileLifecycle } from '@/providers/production-mobile-provider';
import { useWorkspaces } from '@/providers/workspace-provider';
import { usePalette } from '@/theme/palette';

function destinationTitle(destination: WorkspaceDestination): string {
  return destination === 'source_control'
    ? 'Source control'
    : destination === 'review'
      ? 'Review'
      : destination[0]!.toUpperCase() + destination.slice(1);
}

function AnchoredDraftEditor({
  scope,
  initial,
  enabled,
  unavailableReason,
  prepare,
}: {
  readonly scope: ReviewDraftScope;
  readonly initial: string;
  readonly enabled: boolean;
  readonly unavailableReason: string;
  readonly prepare: (
    text: string,
    completed: () => Promise<void>,
    cancelled: () => void,
  ) => void;
}) {
  const palette = usePalette();
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [saveState, setSaveState] = useState<'persisted' | 'saving' | 'failed'>(
    'persisted',
  );
  const stableScope = useMemo(
    (): ReviewDraftScope => ({
      serverIdentity: scope.serverIdentity,
      authorizationRevision: scope.authorizationRevision,
      principalGeneration: scope.principalGeneration,
      projectId: scope.projectId,
      workspaceId: scope.workspaceId,
      workspaceRevision: scope.workspaceRevision,
      reviewRevision: scope.reviewRevision,
      fileId: scope.fileId,
      hunkId: scope.hunkId,
      side: scope.side,
      line: scope.line,
    }),
    [
      scope.authorizationRevision,
      scope.fileId,
      scope.hunkId,
      scope.line,
      scope.principalGeneration,
      scope.projectId,
      scope.reviewRevision,
      scope.serverIdentity,
      scope.side,
      scope.workspaceId,
      scope.workspaceRevision,
    ],
  );
  useEffect(() => {
    if (new TextEncoder().encode(text).byteLength > MAX_REVIEW_DRAFT_BYTES) {
      return;
    }
    let current = true;
    void persistReviewDraft(stableScope, text)
      .then(() => {
        if (current) setSaveState('persisted');
      })
      .catch(() => {
        if (current) setSaveState('failed');
      });
    return () => {
      current = false;
    };
  }, [stableScope, text]);
  const ready =
    enabled && !busy && text.length > 0 && saveState === 'persisted';
  return (
    <View style={styles.commentDraft}>
      <TextInput
        accessibilityLabel={`Comment draft for ${scope.fileId}, hunk ${scope.hunkId}, ${scope.side} line ${scope.line}`}
        multiline
        onChangeText={(value) => {
          if (
            new TextEncoder().encode(value).byteLength <= MAX_REVIEW_DRAFT_BYTES
          ) {
            setSaveState('saving');
            setText(value);
          }
        }}
        placeholder="Add a line-anchored comment…"
        placeholderTextColor={palette.textMuted}
        style={[
          styles.reviewDraft,
          {
            backgroundColor: palette.background,
            borderColor: palette.border,
            color: palette.text,
          },
        ]}
        value={text}
      />
      <View style={styles.draftFooter}>
        <Text style={[styles.subtitle, { color: palette.textMuted }]}>
          {saveState === 'persisted'
            ? 'Drafted locally · not sent'
            : saveState === 'saving'
              ? 'Saving local draft · not ready to send'
              : 'Local draft persistence failed · not ready to send'}{' '}
          · {new TextEncoder().encode(text).byteLength}/{MAX_REVIEW_DRAFT_BYTES}{' '}
          bytes
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{
            disabled: !ready,
          }}
          accessibilityLabel={`Add persisted comment${enabled ? '' : `, unavailable: ${unavailableReason.replaceAll('_', ' ')}`}`}
          disabled={!ready}
          onPress={() => {
            setBusy(true);
            prepare(
              text,
              async () => {
                await persistReviewDraft(scope, '');
                setText('');
                setSaveState('persisted');
                setBusy(false);
              },
              () => setBusy(false),
            );
          }}
          style={[
            styles.reviewAction,
            {
              borderColor: palette.accent,
              opacity: ready ? 1 : 0.48,
            },
          ]}
        >
          <Text style={{ color: palette.accent, fontWeight: '800' }}>
            {busy ? 'Recording…' : 'Add comment'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

type UnavailableReviewEffectKind = Exclude<
  ReviewAction['kind'],
  MobileSupportedReviewAction['kind']
>;

function UnavailableReviewEffect({
  kind,
  label,
}: {
  readonly kind: UnavailableReviewEffectKind;
  readonly label: string;
}) {
  const palette = usePalette();
  const category = MOBILE_UNAVAILABLE_REVIEW_EFFECT_CATEGORIES[kind];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: true }}
      accessibilityLabel={`${label}, unavailable: ${category}`}
      disabled
      style={[
        styles.reviewAction,
        { borderColor: palette.border, opacity: 0.48 },
      ]}
    >
      <Text style={{ color: palette.textMuted, fontWeight: '800' }}>
        {label} · unavailable
      </Text>
      <Text style={[styles.meta, { color: palette.textMuted }]}>
        {category}
      </Text>
    </Pressable>
  );
}

function ReviewControlSurface({
  detail,
  server,
  workspace,
  exactReviewRevision,
  selectedFile,
  selectedHunk,
}: {
  readonly detail: WorkspaceCatalogDetail;
  readonly server: ScopedServerProfile;
  readonly workspace: CompanionWorkspace;
  readonly exactReviewRevision: boolean;
  readonly selectedFile: string | undefined;
  readonly selectedHunk: string | undefined;
}) {
  const palette = usePalette();
  const {
    status,
    executeReviewAction,
    reconcileReviewAction,
    reviewBusy,
    reviewReceipts,
    pendingReviewReceipts,
  } = useWorkspaces();
  const { workspaceGateway } = useMobileLifecycle();
  const review = detail.review!;
  const [drafts, setDrafts] = useState<
    Awaited<ReturnType<typeof loadReviewDrafts>>
  >([]);
  const [draftsLoaded, setDraftsLoaded] = useState(false);
  type LocalReviewAction = MobileSupportedReviewAction;
  const [pending, setPending] = useState<{
    readonly action: LocalReviewAction;
    readonly summary: string;
    readonly completed: () => Promise<void>;
    readonly cancelled: () => void;
    readonly idempotencyKey: string;
    readonly phase: 'confirm' | 'reconcile' | 'cleanup' | 'terminal';
    readonly outcome: string | null;
  } | null>(null);
  const [confirmationBusy, setConfirmationBusy] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const snapshot = review.snapshot;
  const renderSemantics = projectReviewRenderSemantics(snapshot);
  const scopedReceiptHandles = pendingReviewReceipts.filter(
    (handle) =>
      handle.project === workspace.projectId &&
      handle.workspace_id === workspace.id,
  );
  const scopedReceipts = reviewReceipts.filter(
    (projection) =>
      projection.projectId === workspace.projectId &&
      projection.workspaceId === workspace.id,
  );
  const draftBase = {
    serverIdentity: server.serverIdentity,
    authorizationRevision: server.authorizationRevision,
    principalGeneration: server.principalGeneration,
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    workspaceRevision: workspace.revision,
    reviewRevision: decimalRevision(review.revision),
  } as const;
  useEffect(() => {
    let active = true;
    void loadReviewDrafts({
      serverIdentity: server.serverIdentity,
      authorizationRevision: server.authorizationRevision,
      principalGeneration: server.principalGeneration,
      projectId: workspace.projectId,
      workspaceId: workspace.id,
      workspaceRevision: workspace.revision,
      reviewRevision: decimalRevision(review.revision),
    })
      .then((value) => {
        if (active) {
          setDrafts(value);
          setDraftsLoaded(true);
        }
      })
      .catch(() => {
        if (active) {
          setDrafts([]);
          setDraftsLoaded(true);
        }
      });
    return () => {
      active = false;
    };
  }, [
    server.serverIdentity,
    server.authorizationRevision,
    server.principalGeneration,
    workspace.id,
    workspace.projectId,
    workspace.revision,
    review.revision,
  ]);
  const live =
    status.phase === 'live' &&
    server.authorization === 'active' &&
    workspaceGateway?.authorizationScope.serverIdentity ===
      server.serverIdentity;
  const availability = (
    action: Parameters<typeof reviewActionAvailability>[0]['action'],
  ) =>
    reviewActionAvailability({
      action,
      delegatedActions: workspaceGateway?.authorizationScope.actions ?? [],
      effectKinds: workspaceGateway?.reviewEffectKinds ?? [],
      live,
      projectStale: server.staleProjectIds.includes(workspace.projectId),
      exactReviewRevision,
      snapshot,
    });
  const submit = async (action: LocalReviewAction) => {
    if (pending === null) throw new Error('review_confirmation_missing');
    return executeReviewAction({
      projectId: workspace.projectId,
      workspaceId: workspace.id,
      workspaceRevision: workspace.revision,
      reviewRevision: review.revision,
      authority: snapshot.review.authority,
      action,
      idempotencyKey: pending.idempotencyKey,
    });
  };
  const prepare = (
    action: LocalReviewAction,
    summary: string,
    completed: () => Promise<void> = async () => undefined,
    cancelled: () => void = () => undefined,
  ) => {
    if (pending !== null || reviewBusy) {
      cancelled();
      return;
    }
    setReviewError(null);
    setPending({
      action,
      summary,
      completed,
      cancelled,
      idempotencyKey: `mobile-review-${Crypto.randomUUID()}`,
      phase: 'confirm',
      outcome: null,
    });
  };
  const cancelPending = () => {
    if (pending?.phase === 'reconcile' || pending?.phase === 'cleanup') return;
    pending?.cancelled();
    setPending(null);
    setReviewError(null);
  };
  const completePendingLocally = async (
    current: NonNullable<typeof pending>,
  ) => {
    // A completed receipt is terminal server evidence. Publish that fact
    // before touching fallible local storage so no UI retry can cross the
    // network boundary again.
    setPending({
      ...current,
      phase: 'cleanup',
      outcome: 'completed',
    });
    try {
      await current.completed();
      setPending((value) =>
        value?.idempotencyKey === current.idempotencyKey &&
        value.phase === 'cleanup'
          ? null
          : value,
      );
    } catch (error) {
      setReviewError(
        error instanceof Error
          ? `review_local_cleanup_required:${error.message}`
          : 'review_local_cleanup_required',
      );
    }
  };
  const confirmPending = async () => {
    if (pending === null || pending.phase !== 'confirm' || confirmationBusy)
      return;
    const current = pending;
    setConfirmationBusy(true);
    setReviewError(null);
    try {
      const result = await submit(current.action);
      const receipt = result.receipt;
      if (receipt?.outcome === 'completed') {
        await completePendingLocally(current);
      } else if (
        receipt?.outcome === 'conflict' ||
        receipt?.outcome === 'refused'
      ) {
        setPending({
          ...current,
          phase: 'terminal',
          outcome: receipt.outcome,
        });
      } else {
        setPending({
          ...current,
          phase: 'reconcile',
          outcome: receipt?.outcome ?? 'ambiguous',
        });
      }
    } catch (error) {
      setReviewError(
        error instanceof Error ? error.message : 'review_action_refused',
      );
    } finally {
      setConfirmationBusy(false);
    }
  };
  const reconcilePending = async () => {
    if (pending === null || pending.phase !== 'reconcile' || confirmationBusy)
      return;
    const current = pending;
    setConfirmationBusy(true);
    setReviewError(null);
    try {
      const result = await reconcileReviewAction(current.idempotencyKey);
      if (result.receipt.outcome === 'completed') {
        await completePendingLocally(current);
      } else if (
        result.receipt.outcome === 'conflict' ||
        result.receipt.outcome === 'refused'
      ) {
        setPending({
          ...current,
          phase: 'terminal',
          outcome: result.receipt.outcome,
        });
      } else {
        setPending({ ...current, outcome: result.receipt.outcome });
      }
    } catch (error) {
      const recovered = scopedReceipts.find(
        (projection) =>
          projection.receipt.idempotency_key === current.idempotencyKey,
      )?.receipt;
      if (recovered?.outcome === 'completed') {
        await completePendingLocally(current);
      } else if (
        recovered?.outcome === 'conflict' ||
        recovered?.outcome === 'refused'
      ) {
        setPending({
          ...current,
          phase: 'terminal',
          outcome: recovered.outcome,
        });
      } else {
        setReviewError(
          error instanceof Error
            ? error.message
            : 'review_reconciliation_unavailable',
        );
      }
    } finally {
      setConfirmationBusy(false);
    }
  };
  const approveAction = {
    kind: 'approve_review' as const,
    payload: {
      expected_review_revision: snapshot.review.freshness.observed_revision,
    },
  };
  const approve = availability(approveAction);
  const addCommentPending = scopedReceiptHandles.some(
    (handle) => handle.action_kind === 'add_comment',
  );
  const approvePending = scopedReceiptHandles.some(
    (handle) => handle.action_kind === 'approve_review',
  );
  const agentDeliveryPending = scopedReceiptHandles.some(
    (handle) =>
      handle.action_kind === 'send_comment_to_agent' ||
      handle.action_kind === 'batch_send_comments_to_agent',
  );
  const batchTargets = snapshot.comments
    .filter((comment) => ['not_sent', 'refused'].includes(comment.agent_state))
    .map((comment) => ({
      comment_id: comment.id,
      expected_comment_revision: comment.revision,
    }));
  const batchAction = {
    kind: 'batch_send_comments_to_agent' as const,
    payload: { comments: batchTargets },
  };
  const batchTargetLabel = `${batchTargets.length} ${batchTargets.length === 1 ? 'comment' : 'comments'}`;
  const batchAvailability = availability(batchAction);
  if (renderSemantics === null) {
    return (
      <Text
        accessibilityLabel="Review render semantics unavailable"
        style={[styles.subtitle, { color: palette.warning }]}
      >
        Review unavailable: the server projection is not semantically coherent.
      </Text>
    );
  }
  return (
    <View style={styles.reviewSurface}>
      <View style={styles.reviewSummary}>
        <Text style={[styles.value, { color: palette.text }]}>
          {renderSemantics.attention.semantic_key} · {review.unread} unread
        </Text>
        <Text style={[styles.subtitle, { color: palette.textMuted }]}>
          {renderSemantics.attention.reason_key ?? 'No attention reason'} ·
          source revision{' '}
          {renderSemantics.attention.source_revision?.toString() ??
            'not applicable'}
        </Text>
        <Text style={[styles.subtitle, { color: palette.textMuted }]}>
          {renderSemantics.review.semantic_key} ·{' '}
          {renderSemantics.review.freshness_key} · source revision{' '}
          {renderSemantics.review.source_revision.toString()}
        </Text>
        {renderSemantics.checks.map((check) => (
          <Text
            key={check.id}
            style={[styles.subtitle, { color: palette.textMuted }]}
          >
            {check.semantic_key} · {check.freshness_key} · source revision{' '}
            {check.source_revision.toString()}
          </Text>
        ))}
        <Text style={[styles.subtitle, { color: palette.textMuted }]}>
          {renderSemantics.pull_request.semantic_key} ·{' '}
          {renderSemantics.pull_request.freshness_key} · source revision{' '}
          {renderSemantics.pull_request.source_revision.toString()}
        </Text>
        <Text style={[styles.subtitle, { color: palette.textMuted }]}>
          {renderSemantics.delivery.semantic_key} ·{' '}
          {renderSemantics.delivery.freshness_key} · source revision{' '}
          {renderSemantics.delivery.source_revision.toString()}
        </Text>
      </View>
      {review.files.map((file) => (
        <View
          key={file.id}
          style={[
            styles.reviewFile,
            {
              borderColor:
                selectedFile === file.id ? palette.accent : palette.border,
            },
          ]}
        >
          <Text style={{ color: palette.text, fontWeight: '800' }}>
            {file.path}
          </Text>
          <Text style={[styles.subtitle, { color: palette.textMuted }]}>
            {file.change} · {file.worktree} · conflict {file.conflict}
          </Text>
          <Text style={[styles.subtitle, { color: palette.textMuted }]}>
            {renderSemantics.previews.find((preview) => preview.id === file.id)
              ?.semantic_key ?? 'Preview semantics unavailable'}{' '}
            · source revision {renderSemantics.source_revision.toString()}
          </Text>
          {file.hunks.map((hunk) => {
            const preview = safeHunkPreview(hunk.preview, file.sanitized);
            const side: 'new' | 'old' =
              BigInt(hunk.newLines) > 0n ? 'new' : 'old';
            const line = decimalRevision(
              side === 'new' ? hunk.newStart : hunk.oldStart,
            );
            const scope: ReviewDraftScope = {
              ...draftBase,
              fileId: file.id,
              hunkId: hunk.id,
              side,
              line,
            };
            const actionFor = (body: string) => ({
              kind: 'add_comment' as const,
              payload: {
                anchor: {
                  file_id: file.id,
                  hunk_id: hunk.id,
                  line: BigInt(line),
                  side,
                },
                body,
                comment_id: `mobile-comment-${Crypto.randomUUID()}`,
              },
            });
            const commentAvailability = availability(actionFor('Draft'));
            return (
              <View
                key={hunk.id}
                style={[
                  styles.hunk,
                  {
                    backgroundColor: palette.background,
                    borderColor:
                      selectedHunk === hunk.id
                        ? palette.accent
                        : palette.border,
                  },
                ]}
              >
                <Text style={[styles.meta, { color: palette.textMuted }]}>
                  -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},
                  {hunk.newLines}
                </Text>
                {preview === null ? (
                  <Text style={[styles.subtitle, { color: palette.warning }]}>
                    Preview withheld: the server did not mark this content
                    sanitized.
                  </Text>
                ) : (
                  <Text
                    accessibilityLabel={`Sanitized diff preview for ${file.path}`}
                    style={[styles.diff, { color: palette.text }]}
                  >
                    {preview}
                  </Text>
                )}
                {draftsLoaded ? (
                  <AnchoredDraftEditor
                    key={[
                      server.serverIdentity,
                      server.authorizationRevision,
                      server.principalGeneration,
                      workspace.id,
                      workspace.revision,
                      review.revision,
                      file.id,
                      hunk.id,
                      side,
                      line,
                    ].join(':')}
                    enabled={
                      commentAvailability.enabled &&
                      !reviewBusy &&
                      !addCommentPending
                    }
                    initial={
                      drafts.find(
                        (draft) =>
                          draft.fileId === file.id &&
                          draft.hunkId === hunk.id &&
                          draft.side === side &&
                          draft.line === line,
                      )?.text ?? ''
                    }
                    scope={scope}
                    unavailableReason={commentAvailability.reason}
                    prepare={(body, completed, cancelled) =>
                      prepare(
                        actionFor(body),
                        `Add one line-anchored comment to ${file.path}, ${side} line ${line}. The authenticated server actor and review authority ${snapshot.review.authority.id} will be recorded.`,
                        completed,
                        cancelled,
                      )
                    }
                  />
                ) : (
                  <Text style={[styles.subtitle, { color: palette.textMuted }]}>
                    Loading exact-revision draft…
                  </Text>
                )}
              </View>
            );
          })}
        </View>
      ))}
      <View style={styles.reviewActions}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{
            disabled: !approve.enabled || reviewBusy || approvePending,
          }}
          accessibilityLabel={`Approve review${approve.enabled ? '' : `, unavailable: ${approve.reason.replaceAll('_', ' ')}`}`}
          disabled={!approve.enabled || reviewBusy || approvePending}
          onPress={() =>
            prepare(
              approveAction,
              `Approve review revision ${review.revision} under authority ${snapshot.review.authority.id}. This does not grant Git, CI, pull-request, filesystem, or provider-session authority.`,
            )
          }
          style={[
            styles.reviewAction,
            {
              borderColor: palette.accent,
              opacity:
                approve.enabled && !reviewBusy && !approvePending ? 1 : 0.48,
            },
          ]}
        >
          <Text style={{ color: palette.accent, fontWeight: '800' }}>
            Approve review
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{
            disabled:
              batchTargets.length === 0 ||
              !batchAvailability.enabled ||
              reviewBusy ||
              agentDeliveryPending,
          }}
          accessibilityLabel={`Batch send ${batchTargetLabel} to retained agent${batchTargets.length > 0 && batchAvailability.enabled ? '' : `, unavailable: ${(batchTargets.length === 0 ? 'target_already_settled' : batchAvailability.reason).replaceAll('_', ' ')}`}`}
          disabled={
            batchTargets.length === 0 ||
            !batchAvailability.enabled ||
            reviewBusy ||
            agentDeliveryPending
          }
          onPress={() =>
            prepare(
              batchAction,
              `Send ${batchTargetLabel} with exact persisted revisions to the retained agent session bound by the server to workspace ${workspace.id}. Each comment revision is fenced; no provider session, shell, Git, CI, or pull-request authority is delegated by this action.`,
            )
          }
          style={[
            styles.reviewAction,
            {
              borderColor: palette.accent,
              opacity:
                batchTargets.length > 0 &&
                batchAvailability.enabled &&
                !reviewBusy &&
                !agentDeliveryPending
                  ? 1
                  : 0.48,
            },
          ]}
        >
          <Text style={{ color: palette.accent, fontWeight: '800' }}>
            Batch send {batchTargetLabel} to agent
          </Text>
        </Pressable>
      </View>
      {pending !== null && (
        <View
          accessibilityLabel="Exact review action confirmation"
          style={[styles.confirmation, { borderColor: palette.warning }]}
        >
          <Text style={{ color: palette.text, fontWeight: '900' }}>
            Confirm exact review action
          </Text>
          <Text style={[styles.subtitle, { color: palette.textMuted }]}>
            {pending.summary}
          </Text>
          <Text style={[styles.meta, { color: palette.textMuted }]}>
            Workspace {workspace.id} · workspace revision {workspace.revision} ·
            review revision {review.revision} · action{' '}
            {pending.action.kind.replaceAll('_', ' ')}
          </Text>
          <Text style={[styles.meta, { color: palette.textMuted }]}>
            Receipt key {pending.idempotencyKey} · state {pending.phase}
            {pending.outcome === null ? '' : ` · outcome ${pending.outcome}`}
          </Text>
          {pending.action.kind === 'batch_send_comments_to_agent' && (
            <View accessibilityLabel="Exact batch review targets">
              <Text style={[styles.meta, { color: palette.text }]}>
                Exact persisted targets
              </Text>
              {pending.action.payload.comments.map((target) => (
                <Text
                  key={target.comment_id}
                  style={[styles.meta, { color: palette.textMuted }]}
                >
                  Comment {target.comment_id} · revision{' '}
                  {target.expected_comment_revision.toString()}
                </Text>
              ))}
            </View>
          )}
          <View style={styles.reviewActions}>
            {pending.phase === 'confirm' && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Confirm exact review action"
                accessibilityState={{ disabled: confirmationBusy }}
                disabled={confirmationBusy}
                onPress={() => void confirmPending()}
                style={[styles.reviewAction, { borderColor: palette.warning }]}
              >
                <Text style={{ color: palette.warning, fontWeight: '900' }}>
                  {confirmationBusy ? 'Submitting…' : 'Confirm'}
                </Text>
              </Pressable>
            )}
            {pending.phase === 'reconcile' && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Reconcile exact review receipt"
                accessibilityState={{ disabled: confirmationBusy }}
                disabled={confirmationBusy}
                onPress={() => void reconcilePending()}
                style={[styles.reviewAction, { borderColor: palette.warning }]}
              >
                <Text style={{ color: palette.warning, fontWeight: '900' }}>
                  {confirmationBusy ? 'Reconciling…' : 'Reconcile receipt'}
                </Text>
              </Pressable>
            )}
            {pending.phase === 'cleanup' && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Retry completed review local cleanup"
                accessibilityState={{ disabled: confirmationBusy }}
                disabled={confirmationBusy}
                onPress={() => {
                  setConfirmationBusy(true);
                  setReviewError(null);
                  void completePendingLocally(pending).finally(() =>
                    setConfirmationBusy(false),
                  );
                }}
                style={[styles.reviewAction, { borderColor: palette.warning }]}
              >
                <Text style={{ color: palette.warning, fontWeight: '900' }}>
                  {confirmationBusy
                    ? 'Cleaning local draft…'
                    : 'Retry local cleanup'}
                </Text>
              </Pressable>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                pending.phase === 'terminal'
                  ? 'Dismiss terminal review receipt'
                  : 'Cancel review action'
              }
              accessibilityState={{
                disabled:
                  confirmationBusy ||
                  pending.phase === 'reconcile' ||
                  pending.phase === 'cleanup',
              }}
              disabled={
                confirmationBusy ||
                pending.phase === 'reconcile' ||
                pending.phase === 'cleanup'
              }
              onPress={cancelPending}
              style={[styles.reviewAction, { borderColor: palette.border }]}
            >
              <Text style={{ color: palette.textMuted, fontWeight: '800' }}>
                {pending.phase === 'terminal'
                  ? 'Dismiss result'
                  : pending.phase === 'cleanup'
                    ? 'Completed · cleanup required'
                    : 'Cancel'}
              </Text>
            </Pressable>
          </View>
        </View>
      )}
      {reviewError !== null && (
        <Text
          accessibilityLiveRegion="assertive"
          style={{ color: palette.danger }}
        >
          Review action refused: {reviewError.replaceAll('_', ' ')}
        </Text>
      )}
      {(scopedReceiptHandles.length > 0 || scopedReceipts.length > 0) && (
        <View
          accessibilityLabel="Durable review receipts"
          style={[styles.confirmation, { borderColor: palette.border }]}
        >
          <Text style={{ color: palette.text, fontWeight: '900' }}>
            Durable review receipts
          </Text>
          {scopedReceiptHandles.map((handle) => (
            <Text
              key={handle.idempotency_key}
              style={[styles.meta, { color: palette.warning }]}
            >
              {handle.action_kind.replaceAll('_', ' ')} · pending exact receipt
              · {handle.idempotency_key}
            </Text>
          ))}
          {scopedReceipts.map(({ actionKind, receipt }) => (
            <Text
              key={receipt.idempotency_key}
              style={[styles.meta, { color: palette.textMuted }]}
            >
              {actionKind.replaceAll('_', ' ')} · {receipt.outcome} · actor{' '}
              {receipt.actor} · {receipt.reconciliation} ·{' '}
              {receipt.idempotency_key}
            </Text>
          ))}
        </View>
      )}
      <Text style={[styles.subtitle, { color: palette.textMuted }]}>
        Draft state is explicit: local drafts are not sent to an agent. Git
        stage, unstage, and commit remain unavailable. Persisted comments can be
        sent only through the exact retained-agent actions above. CI and
        pull-request effect families are shown below with the server adapter
        category that keeps each control inert.
      </Text>
      {snapshot.comments.map((comment) => (
        <View key={comment.id} style={styles.commentRow}>
          <Text style={{ color: palette.text }}>{comment.body}</Text>
          <Text style={[styles.meta, { color: palette.textMuted }]}>
            {comment.actor} · revision {comment.revision.toString()} ·{' '}
            {comment.agent_state.replaceAll('_', ' ')}
          </Text>
          {(() => {
            const action = {
              kind: 'send_comment_to_agent' as const,
              payload: {
                comment_id: comment.id,
                expected_comment_revision: comment.revision,
              },
            };
            const actionAvailability = availability(action);
            const enabled =
              actionAvailability.enabled &&
              !reviewBusy &&
              !agentDeliveryPending;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: !enabled }}
                accessibilityLabel={`Send comment ${comment.id} revision ${comment.revision.toString()} to retained agent${actionAvailability.enabled ? '' : `, unavailable: ${actionAvailability.reason.replaceAll('_', ' ')}`}`}
                disabled={!enabled}
                onPress={() =>
                  prepare(
                    action,
                    `Send comment ${comment.id} at exact revision ${comment.revision.toString()} to the retained agent session bound by the server to workspace ${workspace.id}. This does not grant a generic provider message or shell action.`,
                  )
                }
                style={[
                  styles.reviewAction,
                  {
                    borderColor: palette.accent,
                    opacity: enabled ? 1 : 0.48,
                  },
                ]}
              >
                <Text style={{ color: palette.accent, fontWeight: '800' }}>
                  Send exact comment to agent
                </Text>
              </Pressable>
            );
          })()}
        </View>
      ))}
      {snapshot.checks.map((check) => (
        <View key={check.id} style={styles.commentRow}>
          <Text style={{ color: palette.textMuted }}>
            Check {check.id}: {check.state} ·{' '}
            {check.required ? 'required' : 'optional'}
          </Text>
          <UnavailableReviewEffect
            kind="rerun_check"
            label={`Rerun check ${check.id}`}
          />
        </View>
      ))}
      <Text style={{ color: palette.textMuted }}>
        Pull request: {snapshot.pull_request.id ?? 'not reported'} ·{' '}
        {snapshot.pull_request.state} · {snapshot.pull_request.readiness}
      </Text>
      <View style={styles.reviewActions}>
        <UnavailableReviewEffect
          kind="open_pull_request"
          label="Open pull request"
        />
        <UnavailableReviewEffect
          kind="update_pull_request"
          label="Update pull request"
        />
        <UnavailableReviewEffect
          kind="merge_pull_request"
          label="Merge pull request"
        />
      </View>
    </View>
  );
}

function DestinationControl({
  destination,
  enabled,
  href,
}: {
  readonly destination: Exclude<WorkspaceDestination, 'chat'>;
  readonly enabled: boolean;
  readonly href: {
    readonly pathname: '/workspace/[server]/[workspace]';
    readonly params: Readonly<Record<string, string>>;
  };
}) {
  const palette = usePalette();
  const button = (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !enabled }}
      accessibilityLabel={`${destinationTitle(destination)}${enabled ? '' : ', unavailable without a separate current grant'}`}
      disabled={!enabled}
      style={{
        alignItems: 'center',
        backgroundColor: enabled ? palette.surface : palette.surfaceMuted,
        borderColor: palette.border,
        borderRadius: 12,
        borderWidth: 1,
        justifyContent: 'center',
        minHeight: 46,
        opacity: enabled ? 1 : 0.68,
        paddingHorizontal: 13,
      }}
    >
      <Text
        style={{
          color: enabled ? palette.text : palette.textMuted,
          fontWeight: '800',
        }}
      >
        {destinationTitle(destination)}
      </Text>
    </Pressable>
  );
  return enabled ? (
    <Link asChild href={href}>
      {button}
    </Link>
  ) : (
    button
  );
}

function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  const palette = usePalette();
  return (
    <View
      style={[
        styles.section,
        { backgroundColor: palette.surface, borderColor: palette.border },
      ]}
    >
      <Text
        accessibilityRole="header"
        style={[styles.sectionTitle, { color: palette.text }]}
      >
        {title}
      </Text>
      {children}
    </View>
  );
}

function WorkspaceDraftEditor({
  server,
  workspace,
}: {
  readonly server: ScopedServerProfile;
  readonly workspace: CompanionWorkspace;
}) {
  const palette = usePalette();
  const {
    catalog,
    serverStatuses,
    workspaceMutationBusy,
    pendingWorkspaceMutationReceipts,
    prepareWorkspaceMutation,
    confirmWorkspaceMutation,
    reconcileWorkspaceMutation,
  } = useWorkspaces();
  const { state: lifecycleState, workspaceGateway } = useMobileLifecycle();
  const [draft, setDraft] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [prepared, setPrepared] = useState<PreparedWorkspaceMutation | null>(
    null,
  );
  const [preparedKind, setPreparedKind] = useState<
    'create_attempt' | 'resume_attempt' | null
  >(null);
  const [reconcileKey, setReconcileKey] = useState<string | null>(null);
  const [mutationMessage, setMutationMessage] = useState<string | null>(null);

  const externalWorkItem = workspace.externalWorkItem;
  const scope = workspaceGateway?.authorizationScope;
  const live =
    lifecycleState.phase === 'ready' &&
    lifecycleState.profile.serverIdentity === server.serverIdentity &&
    catalog.selectedServerIdentity === server.serverIdentity &&
    serverStatuses[server.serverIdentity]?.phase === 'live' &&
    server.authorization === 'active' &&
    externalWorkItem !== null &&
    scope?.serverIdentity === server.serverIdentity &&
    scope.authorizationRevision?.toString() === server.authorizationRevision &&
    scope.principalGeneration?.toString() === server.principalGeneration &&
    scope.projectRoots?.includes(workspace.projectId) === true &&
    scope.actions.includes('prepare_mutation') &&
    !server.staleProjectIds.includes(workspace.projectId);

  useEffect(() => {
    let active = true;
    void loadWorkspaceDraft({
      serverIdentity: server.serverIdentity,
      authorizationRevision: server.authorizationRevision,
      workspaceId: workspace.id,
      workspaceRevision: workspace.revision,
    })
      .then((value) => {
        if (!active) return;
        setDraft(
          value.length > 0 || workspace.externalWorkItem === null
            ? value
            : `${workspace.externalWorkItem.provider} ${workspace.externalWorkItem.key}: ${workspace.externalWorkItem.title}`,
        );
        setLoaded(true);
      })
      .catch(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [server, workspace]);

  useEffect(() => {
    if (!loaded) return;
    if (
      new TextEncoder().encode(draft).byteLength <= MAX_WORKSPACE_DRAFT_BYTES
    ) {
      void persistWorkspaceDraft(
        {
          serverIdentity: server.serverIdentity,
          authorizationRevision: server.authorizationRevision,
          workspaceId: workspace.id,
          workspaceRevision: workspace.revision,
        },
        draft,
      ).catch(() => undefined);
    }
  }, [draft, loaded, server, workspace]);

  const prepare = async (
    kind: 'create_attempt' | 'resume_attempt',
  ): Promise<void> => {
    if (!live || externalWorkItem === null) return;
    setMutationMessage(null);
    setReconcileKey(null);
    try {
      const next = await prepareWorkspaceMutation({
        kind,
        projectId: workspace.projectId,
        workspaceId: workspace.id,
        workspaceRevision: workspace.revision,
        externalWorkItem: {
          provider: externalWorkItem.provider,
          key: externalWorkItem.key,
          title: externalWorkItem.title,
        },
        ...(kind === 'resume_attempt' && workspace.attempt !== null
          ? { targetId: workspace.attempt.id }
          : {}),
        idempotencyKey: `mobile-workspace-${Crypto.randomUUID()}`,
      });
      setPreparedKind(kind);
      setPrepared(next);
    } catch (error) {
      setMutationMessage(
        error instanceof Error
          ? error.message.replaceAll('_', ' ')
          : 'Workspace preview unavailable',
      );
    }
  };

  const confirm = async (decision: 'grant' | 'deny'): Promise<void> => {
    if (prepared === null) return;
    const exactPrepared = prepared;
    setPrepared(null);
    setPreparedKind(null);
    try {
      const result = await confirmWorkspaceMutation(exactPrepared, decision);
      if (result.kind === 'ambiguous') {
        setReconcileKey(result.idempotencyKey);
        setMutationMessage(
          'Delivery is ambiguous. Only receipt lookup is available; this change will not be replayed.',
        );
      } else if (result.kind === 'submitted') {
        setMutationMessage(`Workspace change ${result.receipt.outcome}.`);
        if (result.receipt.outcome === 'accepted') {
          setReconcileKey(result.idempotencyKey);
        }
      } else {
        setMutationMessage(
          result.kind === 'denied'
            ? 'Workspace change denied.'
            : 'Workspace change cancelled locally.',
        );
      }
    } catch (error) {
      setMutationMessage(
        `${error instanceof Error ? error.message.replaceAll('_', ' ') : 'Workspace confirmation unavailable'}. Prepare a new preview or reconcile its durable receipt; the prior confirmation will not be replayed.`,
      );
    }
  };

  const reconcile = async (idempotencyKey: string): Promise<void> => {
    try {
      const result: WorkspaceMutationReconciliation =
        await reconcileWorkspaceMutation(idempotencyKey);
      setMutationMessage(
        result.kind === 'accepted'
          ? 'Workspace change accepted; receipt lookup remains available.'
          : `Workspace change ${result.receipt.outcome}.${
              result.receipt.resulting_revision === null
                ? ''
                : ` Resulting revision ${result.receipt.resulting_revision.toString()}.`
            }`,
      );
      setReconcileKey(result.kind === 'accepted' ? idempotencyKey : null);
    } catch (error) {
      setMutationMessage(
        error instanceof Error
          ? error.message.replaceAll('_', ' ')
          : 'Receipt lookup unavailable',
      );
    }
  };

  const reloadHandles = pendingWorkspaceMutationReceipts.filter(
    (handle) => handle.project === workspace.projectId,
  );

  return (
    <Section title="Task context draft">
      <TextInput
        accessibilityLabel="Workspace task context draft"
        multiline
        onChangeText={(value) => {
          if (
            new TextEncoder().encode(value).byteLength <=
            MAX_WORKSPACE_DRAFT_BYTES
          )
            setDraft(value);
        }}
        placeholder="Keep notes for a later desktop create or resume action…"
        placeholderTextColor={palette.textMuted}
        style={[
          styles.draft,
          {
            backgroundColor: palette.background,
            borderColor: palette.border,
            color: palette.text,
          },
        ]}
        value={draft}
      />
      <Text style={[styles.subtitle, { color: palette.textMuted }]}>
        {new TextEncoder().encode(draft).byteLength} /{' '}
        {MAX_WORKSPACE_DRAFT_BYTES} bytes · stored locally for this exact
        authorization and workspace revision
      </Text>
      <View style={styles.mutations}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            live
              ? 'Create attempt from exact external task'
              : 'Create from task, unavailable: selected server is not live'
          }
          disabled={!live || workspaceMutationBusy}
          onPress={() => void prepare('create_attempt')}
          style={[
            styles.disabledMutation,
            {
              backgroundColor: palette.surfaceMuted,
              borderColor: palette.border,
            },
            (!live || workspaceMutationBusy) && styles.disabled,
          ]}
        >
          <Text style={{ color: palette.text, fontWeight: '800' }}>
            Create from task
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            live && workspace.attempt !== null
              ? 'Resume exact workspace attempt'
              : 'Resume workspace, unavailable: no exact live attempt'
          }
          disabled={
            !live || workspace.attempt === null || workspaceMutationBusy
          }
          onPress={() => void prepare('resume_attempt')}
          style={[
            styles.disabledMutation,
            {
              backgroundColor: palette.surfaceMuted,
              borderColor: palette.border,
            },
            (!live || workspace.attempt === null || workspaceMutationBusy) &&
              styles.disabled,
          ]}
        >
          <Text style={{ color: palette.text, fontWeight: '800' }}>
            Resume workspace
          </Text>
        </Pressable>
      </View>
      {!live && (
        <Text style={[styles.subtitle, { color: palette.textMuted }]}>
          Unavailable until this exact selected server and workspace revision
          are live. No offline mutation is queued.
        </Text>
      )}
      {prepared !== null &&
        preparedKind !== null &&
        externalWorkItem !== null && (
          <WorkspaceMutationConfirmation
            authorityPreview={{
              serverIdentity: server.serverIdentity,
              projectId: workspace.projectId,
              workspaceId: workspace.id,
              workspaceRevision: workspace.revision,
              externalWorkItem,
            }}
            busy={workspaceMutationBusy}
            onConfirm={() => void confirm('grant')}
            onDeny={() => void confirm('deny')}
            prepared={prepared}
          />
        )}
      {mutationMessage !== null && (
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.subtitle, { color: palette.text }]}
        >
          {mutationMessage}
        </Text>
      )}
      {[...reloadHandles.map((handle) => handle.idempotency_key), reconcileKey]
        .filter(
          (key, index, values): key is string =>
            key !== null && values.indexOf(key) === index,
        )
        .map((key) => (
          <Pressable
            key={key}
            accessibilityRole="button"
            accessibilityLabel={`Look up workspace change receipt ${key}`}
            disabled={!live || workspaceMutationBusy}
            onPress={() => void reconcile(key)}
            style={[
              styles.disabledMutation,
              {
                backgroundColor: palette.surfaceMuted,
                borderColor: palette.border,
              },
              (!live || workspaceMutationBusy) && styles.disabled,
            ]}
          >
            <Text style={{ color: palette.text, fontWeight: '800' }}>
              Reconcile pending workspace change
            </Text>
          </Pressable>
        ))}
    </Section>
  );
}

export default function WorkspaceDetailScreen() {
  const params = useLocalSearchParams<{
    server: string;
    workspace: string;
    revision?: string;
    destination?: WorkspaceDestination;
    review_revision?: string;
    file?: string;
    hunk?: string;
  }>();
  const palette = usePalette();
  const {
    catalog,
    findServer,
    findWorkspace,
    findDetail,
    selectServer,
    status,
  } = useWorkspaces();
  const { snapshot } = useMobile();
  const { state: lifecycleState, workspaceGateway } = useMobileLifecycle();
  const server = findServer(params.server);
  const workspace = findWorkspace(params.server, params.workspace);
  const detail = findDetail(params.server, params.workspace);
  const exactRevision = workspace?.revision === params.revision;

  useEffect(() => {
    if (
      server?.authorization === 'active' &&
      lifecycleState.profile?.serverIdentity !== server.serverIdentity
    ) {
      void selectServer(server.serverIdentity).catch(() => undefined);
    }
  }, [lifecycleState.profile?.serverIdentity, selectServer, server]);

  if (server === null || workspace === null || !exactRevision) {
    return (
      <Screen>
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: palette.text }]}
        >
          Workspace unavailable
        </Text>
        <Text style={{ color: palette.textMuted }}>
          The exact server, workspace, and revision are not present in the
          admitted catalog.
        </Text>
      </Screen>
    );
  }

  const destination = params.destination;
  const renderSemantics =
    detail?.review === null || detail?.review === undefined
      ? null
      : projectReviewRenderSemantics(detail.review.snapshot);
  let destinationAdmitted = destination === undefined;
  if (destination !== undefined) {
    try {
      admitWorkspaceDeepLink(catalog, {
        serverIdentity: params.server as ServerIdentity,
        tenantId: server.tenantId,
        authorizationRevision: server.authorizationRevision,
        principalGeneration: server.principalGeneration,
        workspaceId: workspace.id,
        workspaceRevision: decimalRevision(workspace.revision),
        destination,
        workSessionId: null,
        sessionRelationRevision: null,
        retainedTarget: null,
      });
      destinationAdmitted = true;
    } catch {
      destinationAdmitted = false;
    }
  }
  const granted = (value: WorkspaceDestination) =>
    workspace.navigation.some(
      (grant) =>
        grant.destination === value && grant.revision === workspace.revision,
    );
  const liveDetail =
    status.phase === 'live' &&
    server.authorization === 'active' &&
    workspaceGateway?.authorizationScope.serverIdentity ===
      server.serverIdentity &&
    detail !== null;
  const routeParams = (value: WorkspaceDestination) => ({
    server: params.server,
    workspace: workspace.id,
    revision: workspace.revision,
    destination: value,
    ...(value === 'review' && detail?.review !== null
      ? { review_revision: detail?.review?.revision ?? '' }
      : {}),
  });

  return (
    <Screen>
      <View style={styles.heading}>
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: palette.text }]}
        >
          {workspace.title}
        </Text>
        <Text style={[styles.subtitle, { color: palette.textMuted }]}>
          {server.label} · revision {workspace.revision} ·{' '}
          {server.authorization === 'active'
            ? 'current grant'
            : 'cached read only'}
        </Text>
      </View>

      <Section title="Location">
        <Text style={[styles.value, { color: palette.text }]}>
          {server.projects.find((project) => project.id === workspace.projectId)
            ?.label ?? 'Unknown project'}
        </Text>
        <Text style={[styles.subtitle, { color: palette.textMuted }]}>
          Host:{' '}
          {server.hosts.find((host) => host.id === workspace.hostId)?.label ??
            'Unknown host'}
        </Text>
        <Text style={[styles.subtitle, { color: palette.textMuted }]}>
          Repository:{' '}
          {workspace.repository?.label ?? 'not reported by Platform v2'}
        </Text>
        <Text style={[styles.subtitle, { color: palette.textMuted }]}>
          Branch: {workspace.branch?.label ?? 'not reported by Platform v2'}
        </Text>
      </Section>

      <View style={styles.twoColumn}>
        <Section title="External work item">
          {workspace.externalWorkItem === null ? (
            <Text style={[styles.subtitle, { color: palette.textMuted }]}>
              No typed external work item was reported.
            </Text>
          ) : (
            <>
              <Text style={[styles.value, { color: palette.text }]}>
                {workspace.externalWorkItem.provider}{' '}
                {workspace.externalWorkItem.key}
              </Text>
              <Text style={[styles.subtitle, { color: palette.textMuted }]}>
                {workspace.externalWorkItem.title}
              </Text>
              <Text style={[styles.statusValue, { color: palette.text }]}>
                External work status: {workspace.externalWorkItem.status}
              </Text>
            </>
          )}
        </Section>
        <Section title="Orchestration status">
          <Text style={[styles.value, { color: palette.text }]}>
            {workspace.orchestrationStatus}
          </Text>
          <Text style={[styles.subtitle, { color: palette.textMuted }]}>
            Attempt:{' '}
            {workspace.attempt === null
              ? 'not reported'
              : `${workspace.attempt.state} · revision ${workspace.attempt.revision}`}
          </Text>
          <Text style={[styles.subtitle, { color: palette.textMuted }]}>
            Freshness: {workspace.freshness.state} ·{' '}
            {workspace.freshness.observedAt}
          </Text>
          <Text style={[styles.subtitle, { color: palette.textMuted }]}>
            {workspace.unreadAttention} unread attention
          </Text>
        </Section>
      </View>

      <Section title="Retained sessions">
        {workspace.sessions.map((session) => {
          const retained = snapshot.sessions.find(
            (candidate) =>
              candidate.target.coordinate.authority ===
                session.target.authority &&
              candidate.target.coordinate.kind === session.target.kind &&
              candidate.target.coordinate.id === session.target.id,
          );
          const currentServer =
            lifecycleState.profile?.serverIdentity === server.serverIdentity;
          let sessionHref: ReturnType<typeof admitWorkspaceDeepLink> | null =
            null;
          const linkCandidate =
            retained !== undefined &&
            currentServer &&
            status.phase === 'live' &&
            server.authorization === 'active' &&
            !server.staleProjectIds.includes(workspace.projectId) &&
            granted('chat');
          if (linkCandidate) {
            try {
              sessionHref = admitWorkspaceDeepLink(catalog, {
                serverIdentity: server.serverIdentity,
                tenantId: server.tenantId,
                authorizationRevision: server.authorizationRevision,
                principalGeneration: server.principalGeneration,
                workspaceId: workspace.id,
                workspaceRevision: workspace.revision,
                destination: 'chat',
                workSessionId: session.id,
                sessionRelationRevision: session.revision,
                retainedTarget: retained.target,
              });
            } catch {
              sessionHref = null;
            }
          }
          const enabled = sessionHref !== null;
          const sessionButton = (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !enabled }}
              disabled={!enabled}
              style={{
                backgroundColor: enabled
                  ? palette.surfaceMuted
                  : palette.background,
                borderRadius: 12,
                gap: 3,
                minHeight: 52,
                opacity: enabled ? 1 : 0.65,
                padding: 12,
              }}
            >
              <Text style={{ color: palette.text, fontWeight: '800' }}>
                {session.title}
              </Text>
              <Text style={{ color: palette.textMuted, fontSize: 12 }}>
                {session.state} · revision {session.revision}
                {retained !== undefined
                  ? ''
                  : ' · not in retained mobile projection'}
              </Text>
            </Pressable>
          );
          return enabled ? (
            <Link
              key={session.id}
              asChild
              href={{
                pathname: sessionHref!.pathname,
                params: sessionHref!.params,
              }}
            >
              {sessionButton}
            </Link>
          ) : (
            <View key={session.id}>{sessionButton}</View>
          );
        })}
        {workspace.sessions.length === 0 && (
          <Text style={[styles.subtitle, { color: palette.textMuted }]}>
            No typed retained-session relation was reported.
          </Text>
        )}
      </Section>

      <Section title="Read-only destinations">
        <View style={styles.destinations}>
          {(
            [
              'files',
              'preview',
              'review',
              'source_control',
              'terminal',
            ] as const
          ).map((value) => (
            <DestinationControl
              key={value}
              destination={value}
              enabled={liveDetail && granted(value)}
              href={{
                pathname: '/workspace/[server]/[workspace]',
                params: routeParams(value),
              }}
            />
          ))}
        </View>
        <Text style={[styles.subtitle, { color: palette.textMuted }]}>
          Files, preview, source control, and terminal are independent grants.
          Terminal relay is not granted by the current mobile v2 contract.
        </Text>
      </Section>

      {destination !== undefined && (
        <Section title={destinationTitle(destination)}>
          {!destinationAdmitted || !liveDetail ? (
            <Text style={[styles.subtitle, { color: palette.textMuted }]}>
              This destination is unavailable for the exact current workspace
              grant and revision.
            </Text>
          ) : destination === 'files' ? (
            detail.review?.files.length ? (
              detail.review.files.map((file) => (
                <View key={file.id} style={styles.fileRow}>
                  <Text style={{ color: palette.text, fontWeight: '700' }}>
                    {file.path}
                  </Text>
                  <Text style={{ color: palette.textMuted, fontSize: 12 }}>
                    {file.change} · {file.worktree} · {file.conflict}
                  </Text>
                </View>
              ))
            ) : (
              <Text style={{ color: palette.textMuted }}>
                No changed files reported.
              </Text>
            )
          ) : destination === 'preview' ? (
            renderSemantics === null ? (
              <Text style={{ color: palette.warning }}>
                Preview semantics unavailable.
              </Text>
            ) : (
              detail.review?.files
                .filter((file) => file.previewKind !== 'none')
                .map((file) => {
                  const preview = renderSemantics.previews.find(
                    (candidate) => candidate.id === file.id,
                  );
                  return preview === undefined ? null : (
                    <Text key={file.id} style={{ color: palette.text }}>
                      {file.path} · {preview.semantic_key} · source revision{' '}
                      {preview.source_revision.toString()}
                    </Text>
                  );
                })
            )
          ) : destination === 'source_control' ? (
            renderSemantics === null ? (
              <Text style={{ color: palette.warning }}>
                Source-control semantics unavailable.
              </Text>
            ) : (
              <>
                <Text style={{ color: palette.text }}>
                  Pull request: {detail.review?.pullRequestId ?? 'not reported'}
                </Text>
                <Text style={{ color: palette.textMuted }}>
                  {renderSemantics.pull_request.semantic_key} ·{' '}
                  {renderSemantics.pull_request.freshness_key} · source revision{' '}
                  {renderSemantics.pull_request.source_revision.toString()}
                </Text>
                <Text style={{ color: palette.textMuted }}>
                  {renderSemantics.review.semantic_key} ·{' '}
                  {renderSemantics.delivery.semantic_key}
                </Text>
              </>
            )
          ) : destination === 'review' && detail.review !== null ? (
            (() => {
              let exactReviewRoute = false;
              try {
                admitReviewDeepLink(catalog, [detail], {
                  serverIdentity: server.serverIdentity,
                  workspaceId: workspace.id,
                  workspaceRevision: workspace.revision,
                  reviewRevision: params.review_revision ?? '',
                  fileId: params.file ?? null,
                  hunkId: params.hunk ?? null,
                });
                exactReviewRoute = true;
              } catch {
                exactReviewRoute = false;
              }
              return exactReviewRoute ? (
                <ReviewControlSurface
                  key={`${server.serverIdentity}:${server.authorizationRevision}:${server.principalGeneration}:${workspace.revision}:${detail.review.revision}`}
                  detail={detail}
                  exactReviewRevision
                  selectedFile={params.file}
                  selectedHunk={params.hunk}
                  server={server}
                  workspace={workspace}
                />
              ) : (
                <Text style={[styles.subtitle, { color: palette.textMuted }]}>
                  The exact review revision, file, or hunk is no longer current.
                  Refresh before reviewing or commenting.
                </Text>
              );
            })()
          ) : (
            <Text style={{ color: palette.textMuted }}>
              No terminal relay authority is present.
            </Text>
          )}
        </Section>
      )}

      <WorkspaceDraftEditor
        key={`${server.serverIdentity}:${server.authorizationRevision}:${workspace.id}:${workspace.revision}`}
        server={server}
        workspace={workspace}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { gap: 4 },
  title: { fontSize: 28, fontWeight: '800', lineHeight: 34 },
  subtitle: { fontSize: 13, lineHeight: 19 },
  meta: { fontSize: 11, lineHeight: 16 },
  section: {
    borderRadius: 17,
    borderWidth: 1,
    flex: 1,
    gap: 8,
    minWidth: 260,
    padding: 16,
  },
  sectionTitle: { fontSize: 15, fontWeight: '800' },
  value: { fontSize: 17, fontWeight: '800', textTransform: 'capitalize' },
  statusValue: { fontSize: 13, fontWeight: '800', textTransform: 'capitalize' },
  twoColumn: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  destinations: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  fileRow: { gap: 2, paddingVertical: 5 },
  draft: {
    borderRadius: 12,
    borderWidth: 1,
    fontSize: 15,
    minHeight: 100,
    padding: 12,
    textAlignVertical: 'top',
  },
  mutations: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  disabledMutation: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 46,
    opacity: 0.7,
    paddingHorizontal: 14,
  },
  disabled: { opacity: 0.45 },
  reviewSurface: { gap: 14 },
  reviewSummary: { gap: 4 },
  reviewFile: { borderRadius: 14, borderWidth: 1, gap: 8, padding: 12 },
  hunk: { borderRadius: 12, borderWidth: 1, gap: 8, padding: 10 },
  diff: { fontFamily: 'monospace', fontSize: 12, lineHeight: 18 },
  commentDraft: { gap: 7 },
  reviewDraft: {
    borderRadius: 10,
    borderWidth: 1,
    minHeight: 76,
    padding: 10,
    textAlignVertical: 'top',
  },
  draftFooter: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'space-between',
  },
  reviewActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  confirmation: {
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
    padding: 12,
  },
  reviewAction: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 12,
  },
  commentRow: { gap: 3, paddingVertical: 5 },
});
