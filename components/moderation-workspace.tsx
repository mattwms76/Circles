import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { trpc } from "@/lib/trpc";
import { PostCard } from "@/components/post-card";
import {
  MODERATION_NOTE_MAX,
  MODERATION_PAGE_DEFAULT,
  moderationTextLength,
  type ModerationCase,
  type ModerationDecision,
  type ModerationFilter,
  type ModerationAction,
} from "@/shared/moderation";
import {
  boundModerationNote,
  isConfirmedModerationAuthorityLoss,
  isCurrentModerationScope,
  moderationDecisionLabel,
  moderationScopeKey,
  resolveModerationDetailUiState,
  resolveModerationPagesUiState,
  serializeModerationNote,
  validateModerationNote,
} from "@/lib/moderation-ui";
import { ago, Button, C, Empty, Icon, Loading, s, T } from "./circles-ui";

function CaseRow({
  item,
  disabled,
  onOpen,
}: {
  item: ModerationCase;
  disabled: boolean;
  onOpen: () => void;
}) {
  const isFinal = item.status !== "open";
  const statusLabel = isFinal
    ? item.status === "kept"
      ? "Kept — final"
      : "Removed — final"
    : "Open";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open report case ${item.id}`}
      accessibilityHint="Opens the current report details and review history."
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onOpen}
      style={({ pressed }) => [
        s.card,
        styles.caseRow,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <View style={styles.caseIcon} accessible={false}>
        <Icon
          name={isFinal ? "checkmark-circle-outline" : "flag-outline"}
          size={21}
          color={isFinal ? C.green : C.coral}
        />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <T style={styles.caseTitle}>
          {item.reportCount} {item.reportCount === 1 ? "report" : "reports"}
        </T>
        <T style={styles.caseDetail}>
          Last reported {ago(item.lastReportedAt)} · {statusLabel}
        </T>
      </View>
      <Icon name="chevron-forward" size={19} color={C.muted} />
    </Pressable>
  );
}

function ReviewHistory({ actions }: { actions: ModerationAction[] }) {
  if (actions.length === 0) {
    return <T style={styles.muted}>No final decision has been recorded yet.</T>;
  }

  return (
    <View style={styles.history}>
      {actions.map((action) => (
        <View key={action.id} style={styles.historyRow}>
          <View style={styles.historyIcon} accessible={false}>
            <Icon
              name={
                action.decision === "remove"
                  ? "trash-outline"
                  : "checkmark-outline"
              }
              size={16}
              color={action.decision === "remove" ? C.coral : C.green}
            />
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <T style={styles.historyTitle}>
              {moderationDecisionLabel(action.decision)} by{" "}
              {action.reviewer?.name ?? "a former reviewer"}
            </T>
            <T style={styles.historyTime}>{ago(action.createdAt)}</T>
            {action.note ? (
              <T style={styles.historyNote}>{action.note}</T>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

export function ModerationWorkspace({
  circleId,
  viewerId,
  onBack,
}: {
  circleId: number;
  viewerId: number;
  onBack: () => void;
}) {
  const scope = useMemo(
    () => ({ circleId, viewerScope: viewerId }),
    [circleId, viewerId],
  );
  const scopeKey = moderationScopeKey(scope);
  const [filter, setFilter] = useState<ModerationFilter>("open");
  const [selectedCaseId, setSelectedCaseId] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [pendingDecision, setPendingDecision] =
    useState<ModerationDecision | null>(null);
  const [webRemoveConfirmation, setWebRemoveConfirmation] = useState(false);
  const [clearedAuthorityScope, setClearedAuthorityScope] = useState<
    string | null
  >(null);
  const mounted = useRef(false);
  const mountedScope = useRef(scopeKey);
  const selectedCaseRef = useRef<number | null>(selectedCaseId);

  const queryEnabled =
    Number.isSafeInteger(circleId) &&
    circleId > 0 &&
    Number.isSafeInteger(viewerId) &&
    viewerId > 0;
  const queue = trpc.moderation.list.useInfiniteQuery(
    { circleId, viewerScope: viewerId, filter, limit: MODERATION_PAGE_DEFAULT },
    {
      enabled: queryEnabled,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      refetchOnMount: "always",
      retry: false,
      staleTime: 0,
    },
  );
  const queueState = resolveModerationPagesUiState({
    pages: queue.data?.pages,
    scope,
    queryEnabled,
    isError: queue.isError,
    isFetchedAfterMount: queue.isFetchedAfterMount,
    isFetching: queue.isFetching,
  });
  const detailEnabled = queryEnabled && selectedCaseId !== null;
  const detail = trpc.moderation.detail.useQuery(
    {
      circleId,
      viewerScope: viewerId,
      caseId: selectedCaseId ?? 0,
    },
    {
      enabled: detailEnabled,
      refetchOnMount: "always",
      retry: false,
      staleTime: 0,
    },
  );
  const detailState = resolveModerationDetailUiState({
    detail: detail.data,
    scope,
    caseId: selectedCaseId ?? 0,
    queryEnabled: detailEnabled,
    isError: detail.isError,
    isFetchedAfterMount: detail.isFetchedAfterMount,
    isFetching: detail.isFetching,
  });
  const resolve = trpc.moderation.resolve.useMutation();

  useEffect(() => {
    // Strict Mode setup must restore this after its development cleanup cycle.
    mounted.current = true;
    mountedScope.current = scopeKey;
    return () => {
      mounted.current = false;
    };
  }, [scopeKey]);

  const isCurrentCase = useCallback((capturedScope: string, caseId: number) => {
    return (
      isCurrentModerationScope(
        capturedScope,
        mountedScope.current,
        mounted.current,
      ) && selectedCaseRef.current === caseId
    );
  }, []);

  const confirmedNoLongerResolvable =
    detailState.isAuthorityAvailable &&
    detailState.detail?.item.canResolve === false;
  const authorityLossScope =
    selectedCaseId !== null &&
    (confirmedNoLongerResolvable ||
      isConfirmedModerationAuthorityLoss(detail.error))
      ? `${scopeKey}:case:${selectedCaseId}`
      : null;
  if (authorityLossScope && clearedAuthorityScope !== authorityLossScope) {
    // This guarded same-component transition converges once. Recoverable refetch errors do not
    // enter it, while a confirmed role/session loss immediately clears the sensitive draft.
    setClearedAuthorityScope(authorityLossScope);
    setNote("");
    setNoteError(null);
    setWebRemoveConfirmation(false);
  }

  const selectFilter = useCallback(
    (nextFilter: ModerationFilter) => {
      if (pendingDecision) return;
      selectedCaseRef.current = null;
      setFilter(nextFilter);
      setSelectedCaseId(null);
      setNote("");
      setNoteError(null);
      setWriteError(null);
      setWebRemoveConfirmation(false);
    },
    [pendingDecision],
  );

  const selectCase = useCallback(
    (caseId: number) => {
      if (!queueState.isAuthorityAvailable || pendingDecision) return;
      selectedCaseRef.current = caseId;
      setSelectedCaseId(caseId);
      setNote("");
      setNoteError(null);
      setWriteError(null);
      setWebRemoveConfirmation(false);
    },
    [pendingDecision, queueState.isAuthorityAvailable],
  );

  const closeDetail = useCallback(() => {
    if (pendingDecision) return;
    selectedCaseRef.current = null;
    setSelectedCaseId(null);
    setNote("");
    setNoteError(null);
    setWriteError(null);
    setWebRemoveConfirmation(false);
  }, [pendingDecision]);

  const updateNote = useCallback((value: string) => {
    setNote(boundModerationNote(value));
    setNoteError(null);
    setWriteError(null);
  }, []);

  const submitResolution = useCallback(
    (decision: ModerationDecision) => {
      const caseId = selectedCaseId;
      const item = detailState.detail?.item;
      if (
        !caseId ||
        !item ||
        !detailState.isAuthorityAvailable ||
        !item.canResolve ||
        pendingDecision ||
        !isCurrentCase(scopeKey, caseId)
      ) {
        return;
      }

      const validationError = validateModerationNote(note);
      if (validationError) {
        setNoteError(validationError);
        return;
      }

      const capturedScope = scopeKey;
      const submittedNote = serializeModerationNote(note);
      setPendingDecision(decision);
      setWriteError(null);
      setNoteError(null);
      setWebRemoveConfirmation(false);

      void (async () => {
        try {
          await resolve.mutateAsync({
            circleId,
            viewerScope: viewerId,
            caseId,
            decision,
            note: submittedNote,
          });
          if (!isCurrentCase(capturedScope, caseId)) return;

          // A scope-guarded fresh detail response, not a stale mutation completion, becomes the UI authority.
          setNote("");
          await Promise.all([detail.refetch(), queue.refetch()]);
        } catch (caught) {
          if (!isCurrentCase(capturedScope, caseId)) return;
          if (isConfirmedModerationAuthorityLoss(caught)) {
            setNote("");
            setNoteError(null);
            setWebRemoveConfirmation(false);
          }
          setWriteError(
            caught instanceof Error && caught.message
              ? caught.message
              : "We couldn’t record that decision. Please try again.",
          );
          // A recoverable error intentionally leaves the user-authored note in place.
        } finally {
          if (isCurrentCase(capturedScope, caseId)) {
            setPendingDecision(null);
          }
        }
      })();
    },
    [
      circleId,
      detail,
      detailState.detail?.item,
      detailState.isAuthorityAvailable,
      isCurrentCase,
      note,
      pendingDecision,
      queue,
      resolve,
      scopeKey,
      selectedCaseId,
      viewerId,
    ],
  );

  const requestRemoval = useCallback(() => {
    const caseId = selectedCaseId;
    if (
      !caseId ||
      !detailState.isAuthorityAvailable ||
      !detailState.detail?.item.canResolve ||
      pendingDecision ||
      !isCurrentCase(scopeKey, caseId)
    ) {
      return;
    }

    if (Platform.OS === "web") {
      setWebRemoveConfirmation(true);
      return;
    }

    Alert.alert(
      "Remove this moment?",
      "This records a final Remove decision and removes the current moment from the circle. It does not confirm provider-object erasure.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => submitResolution("remove"),
        },
      ],
    );
  }, [
    detailState.detail?.item.canResolve,
    detailState.isAuthorityAvailable,
    isCurrentCase,
    pendingDecision,
    scopeKey,
    selectedCaseId,
    submitResolution,
  ]);

  const selected = detailState.detail;
  const item = selected?.item;
  const isFinal = item?.status !== "open";
  const blockedBySelf = item?.blockedReason === "self_review";
  const controlsDisabled =
    !detailState.isAuthorityAvailable ||
    !item?.canResolve ||
    !!pendingDecision ||
    webRemoveConfirmation;

  return (
    <View style={styles.screen}>
      <View style={styles.screenHeader}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to circle"
          onPress={onBack}
          style={({ pressed }) => [
            styles.backButton,
            pressed && styles.pressed,
          ]}
        >
          <Icon name="arrow-back" size={18} color={C.green} />
          <T style={styles.backText}>Back to circle</T>
        </Pressable>
        <T style={s.eyebrow}>CIRCLE CARE</T>
      </View>

      {selectedCaseId !== null ? (
        <View style={{ gap: 16 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to Reports queue"
            accessibilityState={{ disabled: !!pendingDecision }}
            disabled={!!pendingDecision}
            onPress={closeDetail}
            style={({ pressed }) => [
              styles.queueBack,
              pressed && !pendingDecision && styles.pressed,
              !!pendingDecision && styles.disabled,
            ]}
          >
            <Icon name="chevron-back" size={18} color={C.green} />
            <T style={styles.backText}>Reports queue</T>
          </Pressable>

          {detailState.isLoading ? (
            <Loading />
          ) : detailState.isError || !selected || !item ? (
            <Empty
              icon="shield-outline"
              title="We couldn’t load this report."
              text="Reports are available only to current owners and moderators of this circle."
              action="Try again"
              onAction={() => void detail.refetch()}
            />
          ) : (
            <>
              <View style={{ gap: 6 }}>
                <T style={s.eyebrow}>REPORT CASE</T>
                <T style={s.title}>Review reports</T>
                <T style={styles.headingCopy}>
                  {item.reportCount}{" "}
                  {item.reportCount === 1 ? "report" : "reports"} · last
                  reported {ago(item.lastReportedAt)}
                </T>
              </View>

              <View style={[s.card, styles.section]}>
                <T style={styles.sectionTitle}>Current moment</T>
                {selected.post ? (
                  <PostCard post={selected.post} />
                ) : (
                  <View style={styles.unavailableTarget}>
                    <Icon
                      name="alert-circle-outline"
                      size={22}
                      color={C.muted}
                    />
                    <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                      <T style={styles.unavailableTitle}>
                        This moment is unavailable.
                      </T>
                      <T style={styles.muted}>
                        You can still record a final Keep or Remove decision for
                        this case.
                      </T>
                    </View>
                  </View>
                )}
              </View>

              <View style={[s.card, styles.section]}>
                <T style={styles.sectionTitle}>Why people reported this</T>
                {selected.reasons.length ? (
                  <View style={{ gap: 8 }}>
                    {selected.reasons.map((reason) => (
                      <View key={reason.reason} style={styles.reasonRow}>
                        <T style={styles.reasonText}>{reason.reason}</T>
                        <T style={styles.reasonCount}>
                          {reason.count}{" "}
                          {reason.count === 1 ? "report" : "reports"}
                        </T>
                      </View>
                    ))}
                  </View>
                ) : (
                  <T style={styles.muted}>No report reasons are available.</T>
                )}
              </View>

              <View style={[s.card, styles.section]}>
                <T style={styles.sectionTitle}>Decision</T>
                {isFinal ? (
                  <View style={styles.finalNotice}>
                    <Icon
                      name="lock-closed-outline"
                      size={19}
                      color={C.green}
                    />
                    <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                      <T style={styles.finalTitle}>
                        {item.status === "kept"
                          ? "Kept — final"
                          : "Removed — final"}
                      </T>
                      <T style={styles.muted}>
                        Final cases are read-only and later reports do not
                        reopen them automatically.
                      </T>
                    </View>
                  </View>
                ) : blockedBySelf ? (
                  <View style={styles.blockedNotice}>
                    <Icon name="person-outline" size={20} color="#B44335" />
                    <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                      <T style={styles.blockedTitle}>
                        You can’t review your own moment.
                      </T>
                      <T style={styles.muted}>
                        Another current owner or moderator can review this
                        report. It will remain open until then.
                      </T>
                    </View>
                  </View>
                ) : (
                  <>
                    <T style={styles.muted}>
                      Add an optional private reviewer note. It is limited to{" "}
                      {MODERATION_NOTE_MAX} characters.
                    </T>
                    <TextInput
                      accessibilityLabel="Resolution note"
                      accessibilityHint="Optional note for the circle’s reviewer history."
                      value={note}
                      onChangeText={updateNote}
                      editable={!controlsDisabled}
                      multiline
                      placeholder="Optional note for the review history"
                      placeholderTextColor="#A0A299"
                      style={[
                        styles.noteInput,
                        controlsDisabled && styles.disabled,
                      ]}
                    />
                    <T style={styles.noteCount}>
                      {moderationTextLength(note)}/{MODERATION_NOTE_MAX}
                    </T>
                    {noteError ? <T style={styles.error}>{noteError}</T> : null}
                    {writeError ? (
                      <T style={styles.error}>{writeError}</T>
                    ) : null}
                    <View style={styles.decisionActions}>
                      <Button
                        title={
                          pendingDecision === "keep"
                            ? "Keeping…"
                            : "Keep moment"
                        }
                        accessibilityLabel="Keep moment"
                        secondary
                        loading={pendingDecision === "keep"}
                        disabled={controlsDisabled}
                        icon="checkmark-outline"
                        onPress={() => submitResolution("keep")}
                        style={{ flex: 1 }}
                      />
                      <Button
                        title={
                          pendingDecision === "remove"
                            ? "Removing…"
                            : "Remove moment"
                        }
                        accessibilityLabel="Remove moment"
                        loading={pendingDecision === "remove"}
                        disabled={controlsDisabled}
                        icon="trash-outline"
                        onPress={requestRemoval}
                        style={{ flex: 1 }}
                      />
                    </View>
                    {webRemoveConfirmation ? (
                      <View
                        accessibilityRole="alert"
                        accessibilityLabel="Confirm removal"
                        style={styles.webConfirmation}
                      >
                        <T style={styles.confirmationTitle}>
                          Remove this moment?
                        </T>
                        <T style={styles.muted}>
                          This records a final Remove decision and removes the
                          current moment from the circle. It does not confirm
                          provider-object erasure.
                        </T>
                        <View style={styles.decisionActions}>
                          <Button
                            title="Cancel"
                            secondary
                            onPress={() => setWebRemoveConfirmation(false)}
                            style={{ flex: 1 }}
                          />
                          <Button
                            title="Confirm Remove"
                            icon="trash-outline"
                            onPress={() => submitResolution("remove")}
                            style={{ flex: 1 }}
                          />
                        </View>
                      </View>
                    ) : null}
                  </>
                )}
              </View>

              <View style={[s.card, styles.section]}>
                <T style={styles.sectionTitle}>Review history</T>
                <ReviewHistory actions={selected.history} />
              </View>
            </>
          )}
        </View>
      ) : (
        <View style={{ gap: 16 }}>
          <View style={{ gap: 6 }}>
            <T style={s.eyebrow}>CIRCLE CARE</T>
            <T style={s.title}>Reports</T>
            <T style={styles.headingCopy}>
              Review reported moments for this circle. Reporter identities are
              never shown here.
            </T>
          </View>
          <View accessibilityRole="tablist" style={styles.filters}>
            {(["open", "resolved"] as const).map((nextFilter) => {
              const selectedFilter = filter === nextFilter;
              const label = nextFilter === "open" ? "Open" : "Resolved";
              return (
                <Pressable
                  key={nextFilter}
                  accessibilityRole="tab"
                  accessibilityLabel={`Show ${label.toLowerCase()} reports`}
                  accessibilityState={{
                    selected: selectedFilter,
                    disabled: !!pendingDecision,
                  }}
                  disabled={!!pendingDecision}
                  onPress={() => selectFilter(nextFilter)}
                  style={({ pressed }) => [
                    styles.filter,
                    selectedFilter && styles.filterSelected,
                    pressed && !pendingDecision && styles.pressed,
                    !!pendingDecision && styles.disabled,
                  ]}
                >
                  <T
                    style={[
                      styles.filterText,
                      selectedFilter && styles.filterTextSelected,
                    ]}
                  >
                    {label}
                  </T>
                </Pressable>
              );
            })}
          </View>

          {queueState.isLoading ? (
            <Loading />
          ) : queueState.isError ? (
            <Empty
              icon="shield-outline"
              title="We couldn’t load Reports."
              text="Reports are available only to current owners and moderators of this circle."
              action="Try again"
              onAction={() => void queue.refetch()}
            />
          ) : queueState.items.length === 0 ? (
            <Empty
              icon="flag-outline"
              title={
                filter === "open" ? "No open reports." : "No resolved reports."
              }
              text={
                filter === "open"
                  ? "When this circle has a report to review, it will appear here."
                  : "Final Keep and Remove decisions will appear here."
              }
            />
          ) : (
            <View style={{ gap: 10 }}>
              {queueState.items.map((caseItem) => (
                <CaseRow
                  key={caseItem.id}
                  item={caseItem}
                  disabled={
                    !queueState.isAuthorityAvailable || !!pendingDecision
                  }
                  onOpen={() => selectCase(caseItem.id)}
                />
              ))}
              {queueState.pages.at(-1)?.nextCursor ? (
                <Button
                  title="Show more reports"
                  secondary
                  loading={queue.isFetchingNextPage}
                  disabled={
                    !queueState.isAuthorityAvailable ||
                    !!pendingDecision ||
                    queue.isFetchingNextPage
                  }
                  onPress={() => void queue.fetchNextPage()}
                  style={{ alignSelf: "center", marginTop: 4 }}
                />
              ) : (
                <T style={styles.endCopy}>
                  You’ve reached the end of these reports.
                </T>
              )}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { gap: 18 },
  screenHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  backButton: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  queueBack: {
    minHeight: 44,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  backText: { color: C.green, fontSize: 13, fontWeight: "700" },
  headingCopy: { color: C.muted, fontSize: 14, lineHeight: 21 },
  filters: { flexDirection: "row", gap: 8 },
  filter: {
    minHeight: 44,
    minWidth: 92,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.paper,
  },
  filterSelected: { backgroundColor: C.ink, borderColor: C.ink },
  filterText: { color: C.muted, fontSize: 13, fontWeight: "700" },
  filterTextSelected: { color: "#FFFFFF" },
  caseRow: {
    minHeight: 82,
    paddingHorizontal: 15,
    paddingVertical: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  caseIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.soft,
    flexShrink: 0,
  },
  caseTitle: { fontSize: 15, lineHeight: 21, fontWeight: "700" },
  caseDetail: { color: C.muted, fontSize: 12, lineHeight: 18 },
  section: { padding: 16, gap: 12 },
  sectionTitle: { fontSize: 17, lineHeight: 23, fontWeight: "700" },
  unavailableTarget: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: "#F4F4F0",
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  unavailableTitle: { fontSize: 14, lineHeight: 20, fontWeight: "700" },
  muted: { color: C.muted, fontSize: 13, lineHeight: 20 },
  reasonRow: {
    minHeight: 44,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: C.bg,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  reasonText: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: 19 },
  reasonCount: {
    color: C.green,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700",
  },
  finalNotice: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: C.sage,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  finalTitle: {
    color: C.green,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
  },
  blockedNotice: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: C.soft,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  blockedTitle: {
    color: "#8A3428",
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
  },
  noteInput: {
    minHeight: 112,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    backgroundColor: C.bg,
    color: C.ink,
    fontSize: 15,
    lineHeight: 22,
    padding: 13,
    textAlignVertical: "top",
  },
  noteCount: {
    color: C.muted,
    fontSize: 11,
    lineHeight: 16,
    textAlign: "right",
  },
  error: { color: "#B44335", fontSize: 13, lineHeight: 19 },
  decisionActions: { flexDirection: "row", alignItems: "stretch", gap: 9 },
  webConfirmation: {
    gap: 10,
    padding: 13,
    borderWidth: 1,
    borderColor: "#E2B7AD",
    borderRadius: 12,
    backgroundColor: "#FFF8F5",
  },
  confirmationTitle: { fontSize: 15, lineHeight: 21, fontWeight: "700" },
  history: { gap: 12 },
  historyRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  historyIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.sage,
    flexShrink: 0,
  },
  historyTitle: { fontSize: 13, lineHeight: 19, fontWeight: "700" },
  historyTime: { color: C.muted, fontSize: 11, lineHeight: 16 },
  historyNote: { color: C.muted, fontSize: 13, lineHeight: 19, marginTop: 2 },
  endCopy: {
    paddingVertical: 14,
    color: C.muted,
    textAlign: "center",
    fontSize: 12,
  },
  disabled: { opacity: 0.56 },
  pressed: { opacity: 0.7 },
});
