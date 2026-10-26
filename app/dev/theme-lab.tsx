import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import {
  formatThemeLabPreviewTokenName,
  themeLabPreviewActions,
  themeLabPreviewPalettes,
  themeLabPreviewSchemes,
  themeLabPreviewTokenNames,
  type ThemeLabPreviewPalette,
  type ThemeLabPreviewScheme,
  type ThemeLabPreviewTokenName,
} from "@/lib/batch5-theme-lab";

function ColorSwatch({
  name,
  palette,
}: {
  name: ThemeLabPreviewTokenName;
  palette: ThemeLabPreviewPalette;
}) {
  const value = palette[name];

  return (
    <View style={[styles.swatch, { borderColor: palette.border }]}>
      <View style={styles.swatchHeading}>
        <View
          style={[
            styles.swatchColor,
            { backgroundColor: value, borderColor: palette.border },
          ]}
        />
        <Text style={[styles.swatchName, { color: palette.foreground }]}>
          {formatThemeLabPreviewTokenName(name)}
        </Text>
      </View>
      <Text style={[styles.swatchValue, { color: palette.muted }]}>
        {value}
      </Text>
    </View>
  );
}

export default function ThemeLabScreen() {
  const [pressCount, setPressCount] = useState(0);
  const [lastAction, setLastAction] = useState("No preview actions yet");
  const [previewScheme, setPreviewScheme] =
    useState<ThemeLabPreviewScheme>("light");
  const palette = themeLabPreviewPalettes[previewScheme];

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <StatusBar style={previewScheme === "dark" ? "light" : "dark"} />
      <SafeAreaView
        edges={["top", "bottom", "left", "right"]}
        style={[styles.safeArea, { backgroundColor: palette.background }]}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.flex}
        >
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.header}>
              <Text style={[styles.title, { color: palette.foreground }]}>
                Theme Lab
              </Text>
              <Text style={[styles.body, { color: palette.muted }]}>
                Preview palettes only within Theme Lab. Choosing a palette does
                not change the app theme.
              </Text>
            </View>

            <View
              accessibilityLabel="Theme Lab preview palette"
              accessibilityRole="radiogroup"
              style={styles.schemeGroup}
            >
              {themeLabPreviewSchemes.map((scheme) => {
                const isSelected = previewScheme === scheme;
                const optionPalette = themeLabPreviewPalettes[scheme];
                const displayName = scheme === "light" ? "Light" : "Dark";

                return (
                  <Pressable
                    key={scheme}
                    accessibilityHint="Changes the preview in Theme Lab only; it does not change the app theme."
                    accessibilityLabel={`${displayName} preview palette`}
                    accessibilityRole="radio"
                    accessibilityState={{
                      checked: isSelected,
                      selected: isSelected,
                    }}
                    onPress={() => {
                      setPreviewScheme(scheme);
                      setLastAction(`Selected ${displayName} preview palette`);
                    }}
                    style={({ pressed }) => [
                      styles.schemeToggle,
                      {
                        backgroundColor: isSelected
                          ? optionPalette.primary
                          : palette.surface,
                        borderColor: isSelected
                          ? optionPalette.primary
                          : palette.border,
                        transform: [{ scale: pressed ? 0.99 : 1 }],
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.schemeToggleTitle,
                        {
                          color: isSelected
                            ? optionPalette.actionForeground
                            : palette.foreground,
                        },
                      ]}
                    >
                      {displayName} preview
                    </Text>
                    <Text
                      style={[
                        styles.schemeToggleSubtitle,
                        {
                          color: isSelected
                            ? optionPalette.actionForeground
                            : palette.muted,
                        },
                      ]}
                    >
                      Scoped token set
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View
              style={[
                styles.section,
                {
                  backgroundColor: palette.surface,
                  borderColor: palette.border,
                },
              ]}
            >
              <Text
                style={[styles.sectionTitle, { color: palette.foreground }]}
              >
                Preview action tokens
              </Text>
              <Text style={[styles.body, { color: palette.muted }]}>
                These controls use the selected scoped palette; they do not
                apply app-wide settings.
              </Text>

              <View style={styles.actionGroup}>
                {themeLabPreviewActions.map((action) => (
                  <Pressable
                    key={action.label}
                    accessibilityHint="Records a local Theme Lab preview interaction."
                    accessibilityLabel={`Preview ${action.label} token`}
                    accessibilityRole="button"
                    onPress={() => {
                      setPressCount((count) => count + 1);
                      setLastAction(`Previewed ${action.label} token`);
                    }}
                    style={({ pressed }) => [
                      styles.tokenAction,
                      {
                        backgroundColor: palette[action.background],
                        borderColor: palette.border,
                        borderWidth: action.background === "surface" ? 1 : 0,
                        transform: [{ scale: pressed ? 0.99 : 1 }],
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.tokenActionLabel,
                        { color: palette[action.foreground] },
                      ]}
                    >
                      {action.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <View
                style={[
                  styles.previewDetails,
                  {
                    backgroundColor: palette.background,
                    borderColor: palette.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.previewDetailsTitle,
                    { color: palette.foreground },
                  ]}
                >
                  Scoped preview details
                </Text>
                <Text
                  style={[
                    styles.body,
                    styles.shrinkableText,
                    { color: palette.muted },
                  ]}
                >
                  Preview interactions: {pressCount}
                </Text>
                <Text
                  style={[
                    styles.body,
                    styles.shrinkableText,
                    { color: palette.muted },
                  ]}
                >
                  Last action: {lastAction}
                </Text>
              </View>
            </View>

            <View
              style={[
                styles.section,
                {
                  backgroundColor: palette.surface,
                  borderColor: palette.border,
                },
              ]}
            >
              <Text
                style={[styles.sectionTitle, { color: palette.foreground }]}
              >
                Scoped palette values
              </Text>
              <Text style={[styles.body, { color: palette.muted }]}>
                Live values for the selected Theme Lab preview.
              </Text>
              <View style={styles.swatchList}>
                {themeLabPreviewTokenNames.map((name) => (
                  <ColorSwatch key={name} name={name} palette={palette} />
                ))}
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    gap: 16,
    padding: 20,
    paddingBottom: 32,
  },
  header: {
    gap: 6,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    lineHeight: 34,
  },
  body: {
    fontSize: 14,
    lineHeight: 21,
  },
  schemeGroup: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  schemeToggle: {
    borderRadius: 16,
    borderWidth: 1,
    flexBasis: 144,
    flexGrow: 1,
    gap: 4,
    justifyContent: "center",
    minHeight: 96,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  schemeToggleTitle: {
    fontSize: 16,
    fontWeight: "600",
    lineHeight: 22,
  },
  schemeToggleSubtitle: {
    fontSize: 12,
    lineHeight: 18,
  },
  section: {
    borderRadius: 16,
    borderWidth: 1,
    gap: 8,
    padding: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    lineHeight: 25,
  },
  actionGroup: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 8,
  },
  tokenAction: {
    alignItems: "center",
    borderRadius: 999,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  tokenActionLabel: {
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 20,
  },
  previewDetails: {
    borderRadius: 12,
    borderWidth: 1,
    gap: 6,
    marginTop: 8,
    padding: 16,
  },
  previewDetailsTitle: {
    fontSize: 16,
    fontWeight: "600",
    lineHeight: 22,
  },
  shrinkableText: {
    flexShrink: 1,
  },
  swatchList: {
    gap: 8,
    marginTop: 4,
  },
  swatch: {
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  swatchHeading: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 12,
    minWidth: 0,
  },
  swatchColor: {
    borderRadius: 12,
    borderWidth: 1,
    height: 24,
    width: 24,
  },
  swatchName: {
    flexShrink: 1,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 20,
  },
  swatchValue: {
    flexShrink: 1,
    fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
    fontSize: 12,
    lineHeight: 18,
    marginLeft: 8,
    textAlign: "right",
  },
});
