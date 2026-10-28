import type { TextStyle, ViewStyle } from "react-native";

/**
 * Keeps a privacy pill within its wrapping composer row at enlarged text sizes.
 * The composer retains the existing 44-point target while the text can use the
 * available control width instead of painting past the row edge.
 */
export const d28014PrivacyPillControlStyle = {
  alignSelf: "flex-start",
  flexShrink: 1,
  maxWidth: "100%",
  minHeight: 44,
  minWidth: 0,
} satisfies ViewStyle;

export const d28014PrivacyPillLabelStyle = {
  flexShrink: 1,
} satisfies TextStyle;
