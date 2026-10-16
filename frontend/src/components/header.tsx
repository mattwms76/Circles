import { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { makeStyles, spacing, useTheme } from "@/src/theme";
import { Display } from "@/src/components/ui";
import { Icon, IconName } from "@/src/components/icon";

export function ScreenHeader({
  title,
  subtitle,
  right,
  showBack,
  large,
}: {
  title: string;
  subtitle?: ReactNode;
  right?: ReactNode;
  showBack?: boolean;
  large?: boolean;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={[styles.wrap, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.row}>
        {showBack ? (
          <Pressable testID="header-back" onPress={() => router.back()} hitSlop={10} style={styles.back}>
            <Icon name="arrow-left" size={24} color={colors.onSurface} />
          </Pressable>
        ) : null}
        <View style={{ flex: 1 }}>
          <Display size={large ? 30 : 24} weight="semibold" numberOfLines={1}>
            {title}
          </Display>
          {subtitle ? <View style={{ marginTop: 2 }}>{subtitle}</View> : null}
        </View>
        {right ? <View style={styles.right}>{right}</View> : null}
      </View>
    </View>
  );
}

export function HeaderIconButton({
  icon,
  onPress,
  badge,
  testID,
}: {
  icon: IconName;
  onPress: () => void;
  badge?: number;
  testID?: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable testID={testID} onPress={onPress} hitSlop={8} style={{ padding: spacing.xs }}>
      <Icon name={icon} size={22} color={colors.onSurface} />
      {badge && badge > 0 ? (
        <View
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            minWidth: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: colors.brandPrimary,
          }}
        />
      ) : null}
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  wrap: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  back: { marginLeft: -spacing.xs },
  right: { flexDirection: "row", alignItems: "center", gap: spacing.md },
}));
