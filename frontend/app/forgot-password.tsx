import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { apiPost, ApiError, setToken } from "@/src/api/client";
import { useAuth } from "@/src/auth/auth-context";
import { useToast } from "@/src/components/toast";
import { Body, Button, Display } from "@/src/components/ui";
import { ScreenHeader } from "@/src/components/header";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

export default function ForgotPassword() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const { refresh } = useAuth();

  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const requestCode = async () => {
    if (!email.trim()) return toast.show("Enter your email", "error");
    setBusy(true);
    try {
      await apiPost("/api/auth/forgot-password", { email: email.trim().toLowerCase() });
      setStep("code");
      toast.show("If that email exists, a reset code is on its way", "success");
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "Something went wrong", "error");
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (code.trim().length < 4) return toast.show("Enter the 6-digit code", "error");
    if (password.length < 6) return toast.show("Password needs 6+ characters", "error");
    setBusy(true);
    try {
      const res = await apiPost<{ access_token: string }>("/api/auth/reset-password", {
        email: email.trim().toLowerCase(),
        code: code.trim(),
        new_password: password,
      });
      await setToken(res.access_token);
      await refresh();
      toast.show("Password updated", "success");
      router.replace("/");
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "Could not reset password", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Reset password" showBack />
      <KeyboardAwareScrollView
        bottomOffset={24}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
        showsVerticalScrollIndicator={false}
      >
        {step === "email" ? (
          <>
            <Display size={22} weight="semibold" style={{ marginBottom: spacing.sm }}>Forgot your password?</Display>
            <Body size={14} color={colors.muted} style={{ marginBottom: spacing.xl }}>
              Enter your email and we'll send a 6-digit code to reset it.
            </Body>
            <Body size={12} weight="medium" color={colors.onSurfaceSecondary} style={styles.label}>Email</Body>
            <TextInput
              testID="forgot-email"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              keyboardType="email-address"
              style={styles.input}
            />
            <Button testID="forgot-submit" label="Send reset code" onPress={requestCode} loading={busy} style={{ marginTop: spacing.lg }} />
          </>
        ) : (
          <>
            <Display size={22} weight="semibold" style={{ marginBottom: spacing.sm }}>Enter your code</Display>
            <Body size={14} color={colors.muted} style={{ marginBottom: spacing.xl }}>
              We sent a code to {email}. It expires in 15 minutes.
            </Body>
            <Body size={12} weight="medium" color={colors.onSurfaceSecondary} style={styles.label}>Reset code</Body>
            <TextInput
              testID="reset-code"
              value={code}
              onChangeText={setCode}
              placeholder="123456"
              placeholderTextColor={colors.muted}
              keyboardType="number-pad"
              maxLength={6}
              style={styles.input}
            />
            <Body size={12} weight="medium" color={colors.onSurfaceSecondary} style={styles.label}>New password</Body>
            <TextInput
              testID="reset-password"
              value={password}
              onChangeText={setPassword}
              placeholder="At least 6 characters"
              placeholderTextColor={colors.muted}
              secureTextEntry
              style={styles.input}
            />
            <Button testID="reset-submit" label="Reset password" onPress={reset} loading={busy} style={{ marginTop: spacing.lg }} />
            <Pressable style={styles.resend} onPress={requestCode} testID="resend-code">
              <Body size={14} weight="medium" color={colors.brandPrimary}>Resend code</Body>
            </Pressable>
          </>
        )}
      </KeyboardAwareScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  content: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg },
  label: { marginBottom: spacing.xs, fontFamily: fonts.textMedium },
  input: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontFamily: fonts.textRegular,
    fontSize: 15,
    color: colors.onSurface,
    marginBottom: spacing.lg,
    minHeight: 50,
  },
  resend: { marginTop: spacing.lg, alignItems: "center" },
}));
