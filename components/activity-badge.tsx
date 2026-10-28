import { controlAccessibilityProps } from "../lib/control-accessibility";
import { d28022ValidatedUnreadCount } from "../lib/d28-022-activity-badge-count";
import { Pressable, StyleSheet, View } from "react-native";
import { trpc } from "@/lib/trpc";
import {
  activityBadgeLabel,
  resolveActivityResponseUiState,
} from "@/lib/activity-ui";
import { C, Icon, T } from "./circles-ui";

type ActivityBadgeProps = {
  viewerId: number;
  onPress: () => void;
};

/**
 * A deliberately small, independent protected query. It shares the same durable unread
 * endpoint as the inbox and never asks for Activity data for a guest account.
 */
export function ActivityBadge({ viewerId, onPress }: ActivityBadgeProps) {
  const unread = trpc.activity.unreadCount.useQuery(
    { viewerScope: viewerId },
    {
      enabled: Number.isSafeInteger(viewerId) && viewerId > 0,
      refetchOnMount: "always",
      retry: false,
      staleTime: 0,
    },
  );
  const state = resolveActivityResponseUiState({
    value: unread.data,
    scope: { viewerId },
    queryEnabled: true,
    isError: unread.isError,
    isFetchedAfterMount: unread.isFetchedAfterMount,
    isFetching: unread.isFetching,
  });
  const unreadCount = d28022ValidatedUnreadCount(state.value?.count);
  const label = activityBadgeLabel(unreadCount);
  const accessibilityLabel =
    unreadCount === undefined
      ? "Open Updates"
      : `Open Updates, ${unreadCount} unread`;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      {...controlAccessibilityProps({ busy: unread.isFetching })}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <Icon name="notifications-outline" size={22} color={C.ink} />
      {label && (
        <View accessible={false} style={styles.badge}>
          <T style={styles.badgeText}>{label}</T>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minWidth: 44,
    minHeight: 44,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { opacity: 0.55 },
  badge: {
    position: "absolute",
    top: 3,
    right: 2,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.action,
    borderWidth: 1.5,
    borderColor: C.bg,
  },
  badgeText: {
    color: "#fff",
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "800",
  },
});
