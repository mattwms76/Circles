import { Platform } from "react-native";

// iOS 26+ gets real liquid-glass native tabs; everything else uses the classic JS tab bar.
export const usesNativeTabs =
  Platform.OS === "ios" && parseInt(String(Platform.Version), 10) >= 26;
