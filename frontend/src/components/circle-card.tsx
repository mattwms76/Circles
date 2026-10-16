import { Pressable, View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";

import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { mediaUrl } from "@/src/api/client";
import { Body, Button, Display } from "@/src/components/ui";
import { Icon } from "@/src/components/icon";

export type Circle = {
  id: string;
  name: string;
  description: string;
  category: string;
  cover_url: string | null;
  welcome_message?: string | null;
  is_private: boolean;
  owner_id: string;
  member_count: number;
  is_member: boolean;
  is_owner: boolean;
  my_role?: string | null;
};

export function CircleCard({
  circle,
  onToggleJoin,
  joining,
}: {
  circle: Circle;
  onToggleJoin: (c: Circle) => void;
  joining?: boolean;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();

  return (
    <Pressable
      testID={`circle-${circle.id}`}
      style={styles.card}
      onPress={() => router.push(`/circle/${circle.id}`)}
    >
      <View style={styles.coverWrap}>
        {circle.cover_url ? (
          <Image source={{ uri: mediaUrl(circle.cover_url) }} style={styles.cover} contentFit="cover" />
        ) : (
          <View style={[styles.cover, { backgroundColor: colors.brandTertiary }]} />
        )}
        <LinearGradient
          colors={["transparent", "rgba(42,37,34,0.78)"]}
          style={styles.scrim}
        />
        <View style={styles.coverContent}>
          <Body size={11} weight="medium" color="#F4D5CA" style={styles.category}>
            {circle.category.toUpperCase()}
          </Body>
          <Display size={22} weight="medium" style={{ color: "#FFFFFF" }} numberOfLines={2}>
            {circle.name}
          </Display>
        </View>
      </View>

      <View style={styles.footer}>
        <View style={{ flex: 1 }}>
          <Body size={13} color={colors.onSurfaceSecondary} numberOfLines={2}>
            {circle.description}
          </Body>
          <View style={styles.meta}>
            <Icon name="users" size={14} color={colors.muted} />
            <Body size={12} color={colors.muted}>
              {circle.member_count} {circle.member_count === 1 ? "member" : "members"}
            </Body>
          </View>
        </View>
        <Button
          testID={`join-${circle.id}`}
          small
          label={circle.is_member ? "Joined" : "Join"}
          variant={circle.is_member ? "secondary" : "primary"}
          onPress={() => onToggleJoin(circle)}
          loading={joining}
        />
      </View>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
    marginBottom: spacing.lg,
  },
  coverWrap: { height: 160, width: "100%" },
  cover: { ...({ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 } as const) },
  scrim: { position: "absolute", left: 0, right: 0, bottom: 0, height: "70%" },
  coverContent: { flex: 1, justifyContent: "flex-end", padding: spacing.lg, gap: 2 },
  category: { letterSpacing: 1.2, fontFamily: fonts.textMedium },
  footer: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg },
  meta: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: spacing.sm },
}));
