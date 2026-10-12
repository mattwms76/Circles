import React from "react";
import { View, Text } from "react-native";
import { ActionButton } from "../components/Primitives";
import { supabase } from "./supabase";
import { colors } from "../theme";
export async function reportDiagnostic(
  error: unknown,
  category: "render" | "runtime" | "network" | "stream" | "upload" = "runtime",
) {
  try {
    if (!supabase) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { data: settings } = await supabase
      .from("notification_preferences")
      .select("diagnostics_enabled")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!settings?.diagnostics_enabled) return;
    // Exclude error messages, URLs, tokens, and user content from diagnostics.
    const e = error as { name?: string; code?: string; stack?: string };
    const stack = (e?.stack ?? "")
      .split("\n")
      .slice(1, 16)
      .join("\n")
      .replace(/https?:\/\/[^\s)]+/g, "[source]")
      .replace(/[A-Za-z0-9_-]{40,}/g, "[redacted]")
      .slice(0, 4000);
    await supabase
      .from("client_diagnostics")
      .insert({
        user_id: user.id,
        category,
        code: String(e?.code ?? e?.name ?? "UnknownError").slice(0, 100),
        stack,
      });
  } catch {
    /* Diagnostics never interrupt recovery. */
  }
}
export class AppErrorBoundary extends React.Component<
  React.PropsWithChildren,
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    void reportDiagnostic(error, "render");
  }
  render() {
    return this.state.failed ? (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          padding: 28,
          gap: 18,
          backgroundColor: colors.paper,
        }}
      >
        <Text style={{ fontSize: 24, color: colors.ink }}>
          Let’s try that again
        </Text>
        <Text style={{ fontSize: 16, color: colors.muted }}>
          Circles hit a problem. Your saved drafts are still on this device.
        </Text>
        <ActionButton
          label="Reload Circles"
          onPress={() => this.setState({ failed: false })}
        />
      </View>
    ) : (
      this.props.children
    );
  }
}
