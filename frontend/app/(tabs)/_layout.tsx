import { Platform } from "react-native";
import { Tabs } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { useQuery } from "@tanstack/react-query";

import { apiGet } from "@/src/api/client";
import { usesNativeTabs } from "@/src/navigation";
import { useTheme, fonts } from "@/src/theme";
import { Icon, IconName } from "@/src/components/icon";

const TABS: { name: string; title: string; icon: IconName; sf: string }[] = [
  { name: "index", title: "Home", icon: "home", sf: "house.fill" },
  { name: "explore", title: "Circles", icon: "compass", sf: "circle.grid.2x2.fill" },
  { name: "live", title: "Rooms", icon: "radio", sf: "dot.radiowaves.left.and.right" },
  { name: "messages", title: "Messages", icon: "message-circle", sf: "bubble.left.fill" },
];

export default function TabsLayout() {
  const { colors } = useTheme();
  const { data: unread } = useQuery({
    queryKey: ["unread-total"],
    queryFn: () => apiGet<{ total: number }>("/api/conversations/unread/total"),
    refetchInterval: 8000,
  });
  const badge = unread?.total ?? 0;

  if (usesNativeTabs) {
    return (
      <NativeTabs>
        {TABS.map((t) => (
          <NativeTabs.Trigger key={t.name} name={t.name}>
            <NativeTabs.Trigger.Icon sf={t.sf as never} />
            <NativeTabs.Trigger.Label>{t.title}</NativeTabs.Trigger.Label>
          </NativeTabs.Trigger>
        ))}
      </NativeTabs>
    );
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brandPrimary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          ...(Platform.OS === "web" ? { height: 64 } : {}),
        },
        tabBarItemStyle: { alignSelf: "center" },
        tabBarLabelStyle: { fontFamily: fonts.textMedium, fontSize: 11 },
      }}
    >
      {TABS.map((t) => (
        <Tabs.Screen
          key={t.name}
          name={t.name}
          options={{
            title: t.title,
            tabBarBadge: t.name === "messages" && badge > 0 ? badge : undefined,
            tabBarBadgeStyle: { backgroundColor: colors.brandPrimary, color: colors.onBrandPrimary, fontSize: 10 },
            tabBarIcon: ({ color, size }) => <Icon name={t.icon} size={size ?? 22} color={color} />,
          }}
        />
      ))}
    </Tabs>
  );
}
