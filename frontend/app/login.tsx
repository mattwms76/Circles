import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { useAuth } from "@/src/auth/auth-context";
import { ApiError } from "@/src/api/client";
import { useToast } from "@/src/components/toast";
import { Body, Button, Display } from "@/src/components/ui";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const HERO = "https://images.pexels.com/photos/7605540/pexels-photo-7605540.jpeg";

export default function Login() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signIn } = useAuth();
  const toast = useToast();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email.trim() || !password) {
      toast.show("Enter your email and password", "error");
      return;
    }
    setBusy(true);
    try {
      await signIn(email.trim().toLowerCase(), password);
      router.replace("/");
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "Could not sign in", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.hero}>
        <Image source={{ uri: HERO }} style={styles.heroImage} contentFit="cover" />
        <LinearGradient
          colors={["rgba(42,37,34,0.1)", colors.surface]}
          style={styles.heroScrim}
        />
        <View style={styles.wordmark}>
          <Display size={40} weight="semibold" style={{ color: "#FFFFFF" }}>
            Circles
          </Display>
        </View>
      </View>
      <KeyboardAwareScrollView
        bottomOffset={24}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
        showsVerticalScrollIndicator={false}
      >
        <Body size={15} color={colors.muted} style={{ marginBottom: spacing.xl }}>
          Welcome back. Find your people and pick up where you left off.
        </Body>

        <Body size={12} weight="medium" color={colors.onSurfaceSecondary} style={styles.label}>
          Email
        </Body>
        <TextInput
          testID="login-email"
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
          style={styles.input}
        />

        <Body size={12} weight="medium" color={colors.onSurfaceSecondary} style={styles.label}>
          Password
        </Body>
        <TextInput
          testID="login-password"
          value={password}
          onChangeText={setPassword}
          placeholder="••••••••"
          placeholderTextColor={colors.muted}
          secureTextEntry
          style={styles.input}
        />

        <Button testID="login-submit" label="Sign in" onPress={submit} loading={busy} style={{ marginTop: spacing.lg }} />

        <Pressable style={styles.forgot} onPress={() => router.push("/forgot-password")} testID="go-forgot">
          <Body size={14} weight="medium" color={colors.brandPrimary}>Forgot password?</Body>
        </Pressable>

        <Pressable style={styles.switch} onPress={() => router.push("/register")} testID="go-register">
          <Body size={14} color={colors.muted}>
            New here?{" "}
            <Body size={14} weight="medium" color={colors.brandPrimary}>
              Create an account
            </Body>
          </Body>
        </Pressable>

        <View style={styles.demo}>
          <Body size={12} color={colors.muted} style={{ textAlign: "center" }}>
            Try the demo: demo@circles.app · demo1234
          </Body>
        </View>
      </KeyboardAwareScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  hero: { height: 280, width: "100%" },
  heroImage: { width: "100%", height: "100%" },
  heroScrim: { position: "absolute", left: 0, right: 0, bottom: 0, height: "60%" },
  wordmark: { position: "absolute", left: spacing.xl, bottom: 52 },
  content: { paddingHorizontal: spacing.xl, marginTop: -40 },
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
  forgot: { marginTop: spacing.md, alignItems: "center" },
  demo: { marginTop: spacing.xl, padding: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md },
}));
