import { useState } from "react";
import { Modal, Platform, Pressable, TextInput, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useQueryClient } from "@tanstack/react-query";

import { apiPost } from "@/src/api/client";
import { Body, Button, Display } from "@/src/components/ui";
import { Icon } from "@/src/components/icon";
import { useToast } from "@/src/components/toast";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { formatDateTime } from "@/src/lib/time";

export function EventComposer({
  circleId,
  visible,
  onClose,
}: {
  circleId: string;
  visible: boolean;
  onClose: () => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const toast = useToast();
  const qc = useQueryClient();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(() => new Date(Date.now() + 3600_000));
  const [showPicker, setShowPicker] = useState(Platform.OS === "ios");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!title.trim()) return toast.show("Give your event a title", "error");
    setBusy(true);
    try {
      await apiPost(`/api/circles/${circleId}/events`, {
        title: title.trim(),
        description: description.trim(),
        starts_at: date.toISOString(),
      });
      qc.invalidateQueries({ queryKey: ["circle-events", circleId] });
      toast.show("Event scheduled", "success");
      setTitle("");
      setDescription("");
      onClose();
    } catch {
      toast.show("Could not schedule", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <View style={styles.headerRow}>
          <Display size={20} weight="semibold">Schedule an event</Display>
          <Pressable testID="event-close" onPress={onClose} hitSlop={8}>
            <Icon name="x" size={22} color={colors.onSurface} />
          </Pressable>
        </View>

        <TextInput
          testID="event-title"
          value={title}
          onChangeText={setTitle}
          placeholder="Event title"
          placeholderTextColor={colors.muted}
          style={styles.input}
        />
        <TextInput
          testID="event-desc"
          value={description}
          onChangeText={setDescription}
          placeholder="What's happening? (optional)"
          placeholderTextColor={colors.muted}
          style={[styles.input, { minHeight: 70, textAlignVertical: "top" }]}
          multiline
        />

        <Body size={12} weight="medium" color={colors.onSurfaceSecondary} style={{ fontFamily: fonts.textMedium }}>
          Starts
        </Body>
        {Platform.OS === "android" ? (
          <Pressable testID="event-date-btn" style={styles.dateBtn} onPress={() => setShowPicker(true)}>
            <Icon name="calendar" size={18} color={colors.brandPrimary} />
            <Body size={15} color={colors.onSurface}>{formatDateTime(date.toISOString())}</Body>
          </Pressable>
        ) : null}
        {showPicker ? (
          <DateTimePicker
            testID="event-datetime"
            value={date}
            mode="datetime"
            onChange={(_, d) => {
              if (Platform.OS === "android") setShowPicker(false);
              if (d) setDate(d);
            }}
          />
        ) : null}

        <Button testID="event-submit" label="Schedule" onPress={submit} loading={busy} style={{ marginTop: spacing.md }} />
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
    padding: spacing.lg,
    paddingBottom: spacing["2xl"],
    gap: spacing.sm,
  },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, marginBottom: spacing.sm },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm },
  input: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontFamily: fonts.textRegular,
    fontSize: 15,
    color: colors.onSurface,
    minHeight: 48,
  },
  dateBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: 48,
  },
}));
