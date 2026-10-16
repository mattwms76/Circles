import { useState } from "react";
import { Modal, Pressable, ScrollView, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { apiGet, apiPost } from "@/src/api/client";
import { Body, Button, Display, EmptyState, Loading, Overline } from "@/src/components/ui";
import { ScreenHeader } from "@/src/components/header";
import { useToast } from "@/src/components/toast";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { formatDateTime } from "@/src/lib/time";

type Report = { id: string; target_type: string; category: string; status: string; created_at: string; resolution: { action: string; note: string } | null };
type Action = { id: string; action: string; reason: string; created_at: string; appealed: boolean; appeal_status: string | null };

export default function MyActivity() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const qc = useQueryClient();

  const reports = useQuery({ queryKey: ["my-reports"], queryFn: () => apiGet<Report[]>("/api/reports/mine") });
  const actions = useQuery({ queryKey: ["actions-mine"], queryFn: () => apiGet<Action[]>("/api/moderation/actions/mine") });

  const [appealFor, setAppealFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const submitAppeal = async () => {
    if (!appealFor || !reason.trim()) return;
    try {
      await apiPost(`/api/moderation/actions/${appealFor}/appeal`, { reason: reason.trim() });
      setAppealFor(null);
      setReason("");
      qc.invalidateQueries({ queryKey: ["actions-mine"] });
      toast.show("Appeal submitted", "success");
    } catch (e: any) {
      toast.show(e?.message ?? "Could not submit appeal", "error");
    }
  };

  const loading = reports.isLoading || actions.isLoading;

  return (
    <View style={styles.root}>
      <ScreenHeader title="Reports & decisions" showBack />
      {loading ? (
        <Loading />
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing["2xl"], gap: spacing.lg }} showsVerticalScrollIndicator={false}>
          <View style={{ gap: spacing.sm }}>
            <Overline>Reports you made</Overline>
            {(reports.data ?? []).length === 0 ? (
              <Body size={13} color={colors.muted}>You haven't reported anything.</Body>
            ) : (
              (reports.data ?? []).map((r) => (
                <View key={r.id} style={styles.card} testID={`myreport-${r.id}`}>
                  <Body size={14} weight="medium" color={colors.onSurface}>{r.category} · {r.target_type}</Body>
                  <Body size={12} color={colors.muted}>{formatDateTime(r.created_at)}</Body>
                  <Body size={13} color={r.status === "resolved" ? colors.success : colors.warning} style={{ marginTop: spacing.xs }}>
                    {r.status === "resolved" ? `Reviewed — ${r.resolution?.action ?? "closed"}` : "Under review"}
                  </Body>
                  {r.resolution?.note ? <Body size={13} color={colors.onSurfaceSecondary}>{r.resolution.note}</Body> : null}
                </View>
              ))
            )}
          </View>

          <View style={{ gap: spacing.sm }}>
            <Overline>Decisions about your content</Overline>
            {(actions.data ?? []).length === 0 ? (
              <Body size={13} color={colors.muted}>No moderation actions on your account.</Body>
            ) : (
              (actions.data ?? []).map((a) => (
                <View key={a.id} style={styles.card} testID={`myaction-${a.id}`}>
                  <Body size={14} weight="medium" color={colors.onSurface}>{a.action.replace(/_/g, " ")}</Body>
                  <Body size={12} color={colors.muted}>{formatDateTime(a.created_at)}</Body>
                  <Body size={13} color={colors.onSurfaceSecondary} style={{ marginTop: spacing.xs }}>{a.reason}</Body>
                  {a.appealed ? (
                    <Body size={13} color={colors.info} style={{ marginTop: spacing.xs }}>Appeal {a.appeal_status ?? "submitted"}</Body>
                  ) : (
                    <Button small variant="secondary" label="Appeal this decision" testID={`appeal-${a.id}`} onPress={() => setAppealFor(a.id)} style={{ marginTop: spacing.sm, alignSelf: "flex-start" }} />
                  )}
                </View>
              ))
            )}
          </View>
        </ScrollView>
      )}

      <Modal visible={!!appealFor} transparent animationType="fade" onRequestClose={() => setAppealFor(null)}>
        <Pressable style={styles.backdrop} onPress={() => setAppealFor(null)} />
        <View style={styles.sheet}>
          <Display size={18} weight="semibold">Appeal decision</Display>
          <Body size={13} color={colors.muted}>Tell us why you think this was a mistake. A moderator will review it.</Body>
          <TextInput
            testID="appeal-reason"
            value={reason}
            onChangeText={setReason}
            placeholder="Your explanation"
            placeholderTextColor={colors.muted}
            multiline
            style={styles.input}
          />
          <Button label="Submit appeal" testID="appeal-submit" onPress={submitAppeal} />
        </View>
      </Modal>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, gap: 2 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  input: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, minHeight: 90, textAlignVertical: "top", fontSize: 15, color: colors.onSurface },
}));
