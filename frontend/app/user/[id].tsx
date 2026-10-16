import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";

import { useAuth } from "@/src/auth/auth-context";
import { apiGet, apiPost } from "@/src/api/client";
import { Avatar, Body, Button, Display, Loading, Overline } from "@/src/components/ui";
import { ScreenHeader } from "@/src/components/header";
import { useToast } from "@/src/components/toast";
import { makeStyles, spacing, useTheme } from "@/src/theme";

type PublicProfile = {
  id: string;
  name: string;
  bio: string;
  avatar_url: string | null;
  interests: string[];
  post_count: number;
  circle_count: number;
};

const GIFTS: { type: string; icon: string; cost: number }[] = [
  { type: "Heart", icon: "❤", cost: 10 },
  { type: "Flower", icon: "✿", cost: 25 },
  { type: "Star", icon: "★", cost: 50 },
];

export default function UserProfile() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { user, updateUser } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["user", id],
    queryFn: () => apiGet<PublicProfile>(`/api/users/${id}`),
  });

  const message = async () => {
    try {
      const conv = await apiPost<{ id: string }>("/api/conversations/direct", { user_id: id });
      router.push(`/chat/${conv.id}?title=${encodeURIComponent(data?.name ?? "Chat")}`);
    } catch {
      toast.show("Could not open chat", "error");
    }
  };

  const sendGift = async (type: string) => {
    try {
      const res = await apiPost<{ balance: number }>("/api/gifts", { recipient_id: id, gift_type: type });
      updateUser({ coins: res.balance });
      toast.show(`Sent a ${type}!`, "success");
    } catch (e: any) {
      toast.show(e?.message ?? "Could not send gift", "error");
    }
  };

  if (isLoading || !data) return <View style={styles.root}><Loading /></View>;
  const isMe = user?.id === data.id;

  return (
    <View style={styles.root}>
      <ScreenHeader title="Profile" showBack />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + spacing["2xl"] }} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <Avatar uri={data.avatar_url} name={data.name} size={96} />
          <Display size={24} weight="semibold" style={{ marginTop: spacing.md }}>{data.name}</Display>
          {data.bio ? <Body size={14} color={colors.onSurfaceSecondary} style={{ textAlign: "center", marginTop: spacing.xs, paddingHorizontal: spacing.xl }}>{data.bio}</Body> : null}

          <View style={styles.stats}>
            <View style={styles.stat}>
              <Display size={20} weight="medium">{data.post_count}</Display>
              <Body size={12} color={colors.muted}>posts</Body>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.stat}>
              <Display size={20} weight="medium">{data.circle_count}</Display>
              <Body size={12} color={colors.muted}>circles</Body>
            </View>
          </View>
        </View>

        {!isMe ? (
          <View style={styles.actions}>
            <Button testID="message-user" label="Message" icon="message-circle" onPress={message} style={{ flex: 1 }} />
          </View>
        ) : null}

        {!isMe ? (
          <View style={styles.giftSection}>
            <Overline>Send a gift</Overline>
            <View style={styles.gifts}>
              {GIFTS.map((g) => (
                <Button
                  key={g.type}
                  testID={`gift-${g.type}`}
                  small
                  variant="secondary"
                  label={`${g.icon}  ${g.cost}`}
                  onPress={() => sendGift(g.type)}
                />
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  hero: { alignItems: "center", paddingVertical: spacing.xl },
  stats: { flexDirection: "row", alignItems: "center", gap: spacing.xl, marginTop: spacing.lg },
  stat: { alignItems: "center" },
  statDivider: { width: 1, height: 32, backgroundColor: colors.divider },
  actions: { flexDirection: "row", paddingHorizontal: spacing.lg, gap: spacing.sm },
  giftSection: { padding: spacing.lg, gap: spacing.md },
  gifts: { flexDirection: "row", gap: spacing.sm },
}));
