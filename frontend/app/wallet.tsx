import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/src/auth/auth-context";
import { apiGet, apiPost } from "@/src/api/client";
import { Body, Display, Divider, EmptyState, Loading, Overline } from "@/src/components/ui";
import { ScreenHeader } from "@/src/components/header";
import { Icon } from "@/src/components/icon";
import { useToast } from "@/src/components/toast";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { formatDateTime } from "@/src/lib/time";

type Txn = { id: string; type: string; amount: number; label: string; created_at: string };
type Wallet = { balance: number; gift_costs: Record<string, number>; transactions: Txn[] };

const PACKS = [120, 700, 1600];
const PRICES: Record<number, string> = { 120: "$1.99", 700: "$9.99", 1600: "$19.99" };

export default function WalletScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const qc = useQueryClient();
  const { updateUser } = useAuth();

  const { data, isLoading } = useQuery({ queryKey: ["wallet"], queryFn: () => apiGet<Wallet>("/api/wallet") });

  const buy = async (amount: number) => {
    try {
      const res = await apiPost<{ balance: number }>("/api/wallet/buy", { amount });
      updateUser({ coins: res.balance });
      qc.invalidateQueries({ queryKey: ["wallet"] });
      toast.show(`Added ${amount} coins`, "success");
    } catch {
      toast.show("Purchase failed", "error");
    }
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Wallet" showBack />
      {isLoading || !data ? (
        <Loading />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + spacing["2xl"] }} showsVerticalScrollIndicator={false}>
          <View style={styles.balanceCard}>
            <Overline>Your balance</Overline>
            <View style={styles.balanceRow}>
              <Icon name="circle" size={28} color={colors.brandPrimary} />
              <Display size={48} weight="semibold">{data.balance}</Display>
            </View>
            <Body size={13} color={colors.muted}>coins to send as gifts</Body>
          </View>

          <View style={styles.section}>
            <Overline>Buy coins</Overline>
            <View style={styles.packs}>
              {PACKS.map((p) => (
                <Pressable key={p} testID={`buy-${p}`} style={styles.pack} onPress={() => buy(p)}>
                  <Icon name="circle" size={22} color={colors.brandPrimary} />
                  <Display size={20} weight="medium">{p}</Display>
                  <View style={styles.priceTag}>
                    <Body size={12} weight="medium" color={colors.onBrandPrimary} style={{ fontFamily: fonts.textMedium }}>{PRICES[p]}</Body>
                  </View>
                </Pressable>
              ))}
            </View>
          </View>

          <Divider />

          <View style={{ padding: spacing.lg, gap: spacing.md }}>
            <Overline>Recent activity</Overline>
            {data.transactions.length === 0 ? (
              <EmptyState icon="file-text" title="No activity yet" message="Your purchases and gifts will appear here." />
            ) : (
              data.transactions.map((t) => (
                <View key={t.id} style={styles.txn} testID={`txn-${t.id}`}>
                  <View style={[styles.txnIcon, { backgroundColor: t.amount > 0 ? colors.surfaceSecondary : colors.brandTertiary }]}>
                    <Icon name={t.amount > 0 ? "arrow-down-left" : "arrow-up-right"} size={16} color={t.amount > 0 ? colors.success : colors.onBrandTertiary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Body size={14} color={colors.onSurface}>{t.label}</Body>
                    <Body size={12} color={colors.muted}>{formatDateTime(t.created_at)}</Body>
                  </View>
                  <Body size={15} weight="medium" color={t.amount > 0 ? colors.success : colors.onSurface} style={{ fontFamily: fonts.textMedium }}>
                    {t.amount > 0 ? "+" : ""}{t.amount}
                  </Body>
                </View>
              ))
            )}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  balanceCard: { alignItems: "center", paddingVertical: spacing["2xl"], gap: spacing.xs },
  balanceRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  section: { padding: spacing.lg, gap: spacing.md },
  packs: { flexDirection: "row", gap: spacing.md },
  pack: {
    flex: 1,
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
  },
  priceTag: { backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill, marginTop: spacing.xs },
  txn: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  txnIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
}));
