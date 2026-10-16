import { Modal, Pressable, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/src/auth/auth-context";
import { apiPost } from "@/src/api/client";
import { Body, Display } from "@/src/components/ui";
import { Icon } from "@/src/components/icon";
import { useToast } from "@/src/components/toast";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const GIFTS: { type: string; glyph: string; cost: number }[] = [
  { type: "Heart", glyph: "❤", cost: 10 },
  { type: "Flower", glyph: "✿", cost: 25 },
  { type: "Star", glyph: "★", cost: 50 },
  { type: "Crown", glyph: "♛", cost: 120 },
  { type: "Rocket", glyph: "➤", cost: 300 },
];

export function GiftSheet({
  visible,
  onClose,
  recipientId,
  recipientName,
  postId,
  roomId,
}: {
  visible: boolean;
  onClose: () => void;
  recipientId: string;
  recipientName: string;
  postId?: string;
  roomId?: string;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { user, updateUser } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();

  const send = async (type: string, cost: number) => {
    if ((user?.coins ?? 0) < cost) {
      toast.show("Not enough coins — top up in your wallet", "error");
      return;
    }
    try {
      const res = await apiPost<{ balance: number }>("/api/gifts", {
        recipient_id: recipientId,
        gift_type: type,
        post_id: postId,
        room_id: roomId,
      });
      updateUser({ coins: res.balance });
      qc.invalidateQueries({ queryKey: ["feed"] });
      qc.invalidateQueries({ queryKey: ["wallet"] });
      toast.show(`Sent a ${type} to ${recipientName.split(" ")[0]} 🎉`, "success");
      onClose();
    } catch (e: any) {
      toast.show(e?.message ?? "Could not send gift", "error");
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <View style={styles.headerRow}>
          <View>
            <Display size={20} weight="semibold">Send a gift</Display>
            <Body size={13} color={colors.muted}>Cheer {recipientName.split(" ")[0]} · you have {user?.coins ?? 0} coins</Body>
          </View>
          <Pressable testID="gift-close" onPress={onClose} hitSlop={8}>
            <Icon name="x" size={22} color={colors.onSurface} />
          </Pressable>
        </View>

        <View style={styles.grid}>
          {GIFTS.map((g) => {
            const affordable = (user?.coins ?? 0) >= g.cost;
            return (
              <Pressable
                key={g.type}
                testID={`gift-opt-${g.type}`}
                style={[styles.gift, { opacity: affordable ? 1 : 0.45 }]}
                onPress={() => send(g.type, g.cost)}
              >
                <Display size={28} weight="regular" style={{ color: colors.brandPrimary }}>{g.glyph}</Display>
                <Body size={13} weight="medium" color={colors.onSurface} style={{ fontFamily: fonts.textMedium }}>{g.type}</Body>
                <View style={styles.costTag}>
                  <Body size={11} weight="medium" color={colors.onBrandTertiary} style={{ fontFamily: fonts.textMedium }}>{g.cost}</Body>
                </View>
              </Pressable>
            );
          })}
        </View>
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
  },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, marginBottom: spacing.md },
  headerRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: spacing.lg },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  gift: {
    width: "30%",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
  },
  costTag: { backgroundColor: colors.brandTertiary, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill },
}));
