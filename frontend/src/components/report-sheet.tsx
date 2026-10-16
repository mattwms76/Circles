import { useState } from "react";
import { Modal, Pressable, View } from "react-native";

import { apiPost } from "@/src/api/client";
import { useToast } from "@/src/components/toast";
import { Body, Button, Display } from "@/src/components/ui";
import { Icon } from "@/src/components/icon";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

const CATEGORIES: { key: string; label: string }[] = [
  { key: "spam", label: "Spam or scam" },
  { key: "harassment", label: "Harassment or bullying" },
  { key: "hate", label: "Hate speech" },
  { key: "violence", label: "Violence or threats" },
  { key: "self_harm", label: "Self-harm" },
  { key: "csam", label: "Child sexual abuse / minor safety" },
  { key: "illegal", label: "Other illegal content" },
  { key: "other", label: "Something else" },
];

export function ReportSheet({
  visible,
  onClose,
  targetType,
  targetId,
}: {
  visible: boolean;
  onClose: () => void;
  targetType: "post" | "comment" | "message" | "user" | "room";
  targetId: string;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const submit = async (category: string) => {
    setBusy(true);
    try {
      const res = await apiPost<{ priority: boolean }>("/api/reports", {
        target_type: targetType,
        target_id: targetId,
        category,
        reason: `Reported ${targetType}`,
      });
      onClose();
      toast.show(
        res.priority
          ? "Thank you — this has been flagged as urgent for our safety team"
          : "Thanks — a moderator will review this",
        "success",
      );
    } catch {
      toast.show("Could not submit report", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <Display size={18} weight="semibold" style={{ marginBottom: spacing.xs }}>Report {targetType}</Display>
        <Body size={13} color={colors.muted} style={{ marginBottom: spacing.sm }}>Why are you reporting this?</Body>
        {CATEGORIES.map((c) => (
          <Pressable
            key={c.key}
            testID={`report-cat-${c.key}`}
            style={styles.item}
            disabled={busy}
            onPress={() => submit(c.key)}
          >
            <Body size={15} color={colors.onSurface} style={{ flex: 1 }}>{c.label}</Body>
            <Icon name="chevron-right" size={18} color={colors.muted} />
          </Pressable>
        ))}
        <Button label="Cancel" variant="ghost" onPress={onClose} style={{ marginTop: spacing.sm }} />
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing["2xl"],
  },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, marginBottom: spacing.md },
  item: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
}));
