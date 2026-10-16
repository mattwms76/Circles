import { useEffect } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { LogBox, StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/src/components/error-boundary";
import { queryClient } from "@/src/query-client";
import { AuthProvider } from "@/src/auth/auth-context";
import { ToastProvider } from "@/src/components/toast";

LogBox.ignoreAllLogs(true);
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [loaded] = useFonts({
    "Lora-Regular": require("@/assets/fonts/Lora-Regular.ttf"),
    "Lora-Medium": require("@/assets/fonts/Lora-Medium.ttf"),
    "Lora-SemiBold": require("@/assets/fonts/Lora-SemiBold.ttf"),
    "DMSans-Regular": require("@/assets/fonts/DMSans-Regular.ttf"),
    "DMSans-Medium": require("@/assets/fonts/DMSans-Medium.ttf"),
    Feather: require("@/assets/fonts/Feather.ttf"),
  });

  useEffect(() => {
    if (loaded) SplashScreen.hideAsync().catch(() => {});
  }, [loaded]);

  if (!loaded) return null;

  return (
    <GestureHandlerRootView style={styles.root}>
      <ErrorBoundary>
        <SafeAreaProvider>
          <QueryClientProvider client={queryClient}>
            <KeyboardProvider>
              <AuthProvider>
                <ToastProvider>
                  <Stack screenOptions={{ headerShown: false, animation: "slide_from_right" }}>
                    <Stack.Screen name="post/create" options={{ presentation: "modal", animation: "slide_from_bottom" }} />
                  </Stack>
                </ToastProvider>
              </AuthProvider>
            </KeyboardProvider>
          </QueryClientProvider>
        </SafeAreaProvider>
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
