import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { useAuth } from "@/src/auth/auth-context";
import { ApiError } from "@/src/api/client";
import { useToast } from "@/src/components/toast";
import { Body, Button, Display } from "@/src/components/ui";
import { Icon } from "@/src/components/icon";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

export default function Register() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signUp } = useAuth();
  const toast = useToast();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) return toast.show("What should we call you?", "error");
    if (!email.trim()) return toast.show("Enter your email", "error");
    if (password.length < 6) return toast.show("Password needs 6+ characters", "error");
    setBusy(true);
    try {
      await signUp(name.trim(), email.trim().toLowerCase(), password);
      router.replace("/onboarding");
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "Could not create account", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Pressable style={styles.back} onPress={() => router.back()} testID="register-back">
        <Icon name="arrow-left" size={22} color={colors.onSurface} />
      </Pressable>
      <KeyboardAwareScrollView
        bottomOffset={24}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
        showsVerticalScrollIndicator={false}
      >
        <Display size={32} weight="semibold">
          Create your account
        </Display>
        <Body size={15} color={colors.muted} style={{ marginBottom: spacing.xl }}>
          Join a warm community built around the things you love.
        </Body>

        <Body size={12} weight="medium" color={colors.onSurfaceSecondary} style={styles.label}>
          Name
        </Body>
        <TextInput
          testID="register-name"
          value={name}
          onChangeText={setName}
          placeholder="Your name"
          placeholderTextColor={colors.muted}
          style={styles.input}
        />

        <Body size={12} weight="medium" color={colors.onSurfaceSecondary} style={styles.label}>
          Email
        </Body>
        <TextInput
          testID="register-email"
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          keyboardType="email-address"
          style={styles.input}
        />

        <Body size={12} weight="medium" color={colors.onSurfaceSecondary} style={styles.label}>
          Password
        </Body>
        <TextInput
          testID="register-password"
          value={password}
          onChangeText={setPassword}
          placeholder="At least 6 characters"
          placeholderTextColor={colors.muted}
          secureTextEntry
          style={styles.input}
        />

        <Button testID="register-submit" label="Create account" onPress={submit} loading={busy} style={{ marginTop: spacing.lg }} />

        <Pressable style={styles.switch} onPress={() => router.replace("/login")} testID="go-login">
          <Body size={14} color={colors.muted}>
            Already have an account?{" "}
            <Body size={14} weight="medium" color={colors.brandPrimary} style={{ fontFamily: fonts.textMedium }}>
              Sign in
            </Body>
          </Body>
        </Pressable>
      </KeyboardAwareScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  back: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
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
  switch: { marginTop: spacing.xl, alignItems: "center" },
}));
