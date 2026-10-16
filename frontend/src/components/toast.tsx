import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { Animated, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fonts, radius, spacing, useTheme } from "@/src/theme";
import { Body } from "@/src/components/ui";
import { Icon, IconName } from "@/src/components/icon";

type ToastKind = "info" | "success" | "error";
type ToastContextValue = { show: (message: string, kind?: ToastKind) => void };

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const [message, setMessage] = useState("");
  const [kind, setKind] = useState<ToastKind>("info");
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(
    (msg: string, k: ToastKind = "info") => {
      setMessage(msg);
      setKind(k);
      if (timer.current) clearTimeout(timer.current);
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
      timer.current = setTimeout(() => {
        Animated.timing(opacity, { toValue: 0, duration: 250, useNativeDriver: true }).start();
      }, 2600);
    },
    [opacity],
  );

  const bg =
    kind === "success" ? colors.success : kind === "error" ? colors.error : colors.surfaceInverse;
  const fg =
    kind === "success" ? colors.onSuccess : kind === "error" ? colors.onError : colors.onSurfaceInverse;
  const icon: IconName = kind === "success" ? "check-circle" : kind === "error" ? "alert-circle" : "info";

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <Animated.View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: insets.top + spacing.sm,
          left: spacing.lg,
          right: spacing.lg,
          opacity,
          zIndex: 9999,
        }}
      >
        <View
          style={{
            backgroundColor: bg,
            borderRadius: radius.md,
            paddingHorizontal: spacing.lg,
            paddingVertical: spacing.md,
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.sm,
          }}
        >
          <Icon name={icon} size={18} color={fg} />
          <Body size={14} weight="medium" color={fg} style={{ flex: 1, fontFamily: fonts.textMedium }}>
            {message}
          </Body>
        </View>
      </Animated.View>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
