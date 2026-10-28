import { controlAccessibilityProps } from "../../lib/control-accessibility";
import React from "react";
import { Tabs, useRouter } from "expo-router";
import { Pressable, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { C, Icon, T, type IconName } from "@/components/circles-ui";
import { useCircles } from "@/hooks/circles-context";
import { appShellLayout } from "@/lib/app-shell-layout";
import { d28024TabCaptionMode } from "@/lib/d28-024-tab-presentation";

type TabBarProps = {
  state: { index: number; routes: { key: string; name: string }[] };
  navigation: { navigate: (name: string) => void };
};
export function TabBar({ state, navigation }: TabBarProps) {
  const { width, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { requireAuth } = useCircles();
  const layout = appShellLayout(width, insets);
  if (layout.wide) return null;
  const captionMode = d28024TabCaptionMode(layout.availableWidth, fontScale);
  const icons: Record<string, [IconName, IconName, string, string]> = {
    index: ["home-outline", "home", "Home", "Home"],
    discover: ["compass-outline", "compass", "Discover", "Discover"],
    circles: ["ellipse-outline", "ellipse", "Circles", "Circles"],
    profile: ["person-outline", "person", "You", "Profile"],
  };
  return (
    <View
      testID="app-shell-tab-bar"
      style={{
        backgroundColor: C.bg,
        borderTopWidth: 1,
        borderColor: C.border,
        flexDirection: "row",
        alignItems: "center",
        paddingBottom: Math.max(10, insets.bottom),
        paddingTop: 10,
        paddingLeft: 10 + layout.framePadding.paddingLeft,
        paddingRight: 10 + layout.framePadding.paddingRight,
      }}
    >
      {state.routes.map((route, index) => {
        const selected = index === state.index;
        const item = icons[route.name];
        if (!item) return null;
        const showCaption = captionMode === "all" || selected;
        return (
          <React.Fragment key={route.key}>
            {index === 2 && (
              <Pressable
                accessibilityLabel="Share a moment or create a circle"
                accessibilityRole="button"
                onPress={() => requireAuth(() => router.push("/create"))}
                style={{
                  width: 44,
                  height: 44,
                  backgroundColor: C.action,
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
              accessibilityLabel={item[3]}
              {...controlAccessibilityProps({ selected }, "tab")}
              onPress={() => navigation.navigate(route.name)}
              style={{
                flex: captionMode === "selected" && selected ? 2 : 1,
                minWidth: 44,
                minHeight: 44,
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
                paddingHorizontal: 2,
              }}
            >
              <Icon
                name={selected ? item[1] : item[0]}
                size={23}
                color={selected ? C.action : C.secondary}
              />
              {showCaption && (
                <T
                  numberOfLines={captionMode === "selected" ? 2 : undefined}
                  style={{
                    maxWidth: "100%",
                    textAlign: "center",
                    fontSize: 12,
                    lineHeight: 17,
                    color: selected ? C.action : C.secondary,
                    fontWeight: selected ? "700" : "500",
                  }}
                >
                  {item[2]}
                </T>
              )}
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
