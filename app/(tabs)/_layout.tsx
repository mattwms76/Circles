import React from "react";
import { Tabs, useRouter } from "expo-router";
import { Pressable, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { C, Icon, T, type IconName } from "@/components/circles-ui";
import { useCircles } from "@/hooks/circles-context";

type TabBarProps = {
  state: { index: number; routes: { key: string; name: string }[] };
  navigation: { navigate: (name: string) => void };
};
function TabBar({ state, navigation }: TabBarProps) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { requireAuth } = useCircles();
  if (width >= 900) return null;
  const icons: Record<string, [IconName, IconName, string]> = {
    index: ["home-outline", "home", "Home"],
    discover: ["compass-outline", "compass", "Discover"],
    circles: ["ellipse-outline", "ellipse", "Circles"],
    profile: ["person-outline", "person", "You"],
  };
  return (
    <View
      style={{
        backgroundColor: C.bg,
        borderTopWidth: 1,
        borderColor: C.border,
        flexDirection: "row",
        alignItems: "center",
        paddingBottom: Math.max(10, insets.bottom),
        paddingTop: 10,
        paddingHorizontal: 10,
      }}
    >
      {state.routes.map((route, index) => {
        const selected = index === state.index;
        const item = icons[route.name];
        if (!item) return null;
        return (
          <React.Fragment key={route.key}>
            {index === 2 && (
              <Pressable
                accessibilityLabel="Create a post or circle"
                accessibilityRole="button"
                onPress={() => requireAuth(() => router.push("/create"))}
                style={{
                  width: 44,
                  height: 44,
                  backgroundColor: C.coral,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 15,
                  marginHorizontal: 5,
                  marginTop: -5,
                }}
              >
                <Icon name="add" color="#fff" size={27} />
              </Pressable>
            )}
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => navigation.navigate(route.name)}
              style={{ flex: 1, alignItems: "center", gap: 4, minHeight: 44 }}
            >
              <Icon
                name={selected ? item[1] : item[0]}
                size={23}
                color={selected ? C.coral : C.secondary}
              />
              <T
                style={{
                  fontSize: 12,
                  lineHeight: 17,
                  color: selected ? C.coral : C.secondary,
                  fontWeight: selected ? "700" : "500",
                }}
              >
                {item[2]}
              </T>
            </Pressable>
          </React.Fragment>
        );
      })}
    </View>
  );
}
export default function TabLayout() {
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: C.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen name="discover" options={{ title: "Discover" }} />
      <Tabs.Screen name="circles" options={{ title: "Circles" }} />
      <Tabs.Screen
        name="messages"
        options={{ title: "Messages", href: null }}
      />
      <Tabs.Screen name="profile" options={{ title: "Profile" }} />
    </Tabs>
  );
}
