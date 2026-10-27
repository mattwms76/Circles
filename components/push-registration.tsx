import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { useCircles } from "@/hooks/circles-context";
import { trpc } from "@/lib/trpc";

/**
 * Registers this native device for comment, approval, and message alerts.
 * Web has no Expo push token here, and a missing project id must not block the app.
 */
export function PushRegistration() {
  const { user } = useCircles();
  const register = trpc.social.registerPushToken.useMutation();
  const registerRef = useRef(register.mutateAsync);
  const registeredToken = useRef<string | null>(null);

  useEffect(() => {
    registerRef.current = register.mutateAsync;
  }, [register.mutateAsync]);

  useEffect(() => {
    if (!user || Platform.OS === "web") return;
    const platform = Platform.OS === "ios" ? "ios" : "android";
    if (platform !== "ios" && platform !== "android") return;
    let cancelled = false;

    void (async () => {
      try {
        const Notifications = await import("expo-notifications");
        const existing = await Notifications.getPermissionsAsync();
        const permission =
          existing.status === "granted"
            ? existing
            : await Notifications.requestPermissionsAsync();
        if (permission.status !== "granted" || cancelled) return;
        const token = await Notifications.getExpoPushTokenAsync();
        const value = token.data;
        if (!value || cancelled || registeredToken.current === value) return;
        await registerRef.current({ token: value, platform });
        if (!cancelled) registeredToken.current = value;
      } catch {
        // Permission denial or a missing Expo project id stays local.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  return null;
}
