// Feather icon rendered from the loaded "Feather" font + glyphmap.
// Works in Expo Go (font loaded in app/_layout.tsx via expo-font).
import { Text, TextStyle } from "react-native";
import glyphMap from "@react-native-vector-icons/feather/glyphmaps/Feather.json";

import { useTheme } from "@/src/theme";

export type IconName = keyof typeof glyphMap;

export function Icon({
  name,
  size = 22,
  color,
  style,
}: {
  name: IconName;
  size?: number;
  color?: string;
  style?: TextStyle;
}) {
  const { colors } = useTheme();
  const code = (glyphMap as Record<string, number>)[name] ?? 0;
  return (
    <Text
      allowFontScaling={false}
      style={[
        { fontFamily: "Feather", fontSize: size, color: color ?? colors.onSurface, lineHeight: size + 1 },
        style,
      ]}
    >
      {String.fromCodePoint(code)}
    </Text>
  );
}
