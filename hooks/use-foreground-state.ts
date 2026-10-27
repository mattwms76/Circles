import { useEffect, useState } from "react";
import { AppState, Platform } from "react-native";

function isForegroundAppState(status: string | null): boolean {
  return status === "active";
}

function readWebForeground(): boolean {
  if (typeof document === "undefined") return true;
  return (
    document.visibilityState !== "hidden" &&
    (typeof document.hasFocus !== "function" || document.hasFocus())
  );
}

/** Each consumer retains its own foreground state and event subscriptions. */
export function useForegroundState(): boolean {
  const [nativeForeground, setNativeForeground] = useState(() =>
    isForegroundAppState(AppState.currentState),
  );
  const [webForeground, setWebForeground] = useState(readWebForeground);

  useEffect(() => {
    if (Platform.OS === "web") return;
    const subscription = AppState.addEventListener("change", (nextState) => {
      setNativeForeground(isForegroundAppState(nextState));
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const syncForeground = () => setWebForeground(readWebForeground());
    document.addEventListener("visibilitychange", syncForeground);
    window.addEventListener("focus", syncForeground);
    window.addEventListener("blur", syncForeground);
    syncForeground();
    return () => {
      document.removeEventListener("visibilitychange", syncForeground);
      window.removeEventListener("focus", syncForeground);
      window.removeEventListener("blur", syncForeground);
    };
  }, []);

  return Platform.OS === "web" ? webForeground : nativeForeground;
}
