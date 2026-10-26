import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, C, IconButton, Input, T } from "@/components/circles-ui";
import {
  connectEmailPassword,
  readEmailAuthStatus,
  signInWithEmailPassword,
  signUpWithEmailPassword,
} from "@/lib/email-auth-client";
import {
  createEmailAuthAsyncGuard,
  resolveEmailAuthAvailability,
  type EmailAuthAsyncScope,
  type EmailAuthDialogMode,
} from "@/lib/email-auth-ui";

type EmailFormMode = "signIn" | "signUp";

type EmailAuthFormProps = {
  mode: EmailAuthDialogMode;
  onAuthenticated: () => Promise<boolean>;
  onClose: () => void;
  /**
   * Migration-only entry for a legacy Circles account that must prove its
   * existing identity before it can connect verified email credentials.
   */
  onConnectExisting?: () => void;
};

type SubmissionFlight = {
  scope: EmailAuthAsyncScope;
  controller: AbortController;
};

let nextDialogInstanceId = 0;

function dialogTitle(
  mode: EmailAuthDialogMode,
  formMode: EmailFormMode,
): string {
  if (mode === "connect") {
    return formMode === "signUp"
      ? "Create email credentials"
      : "Add email sign-in";
  }
  return formMode === "signUp" ? "Create your account" : "Sign in with email";
}

function submitTitle(
  mode: EmailAuthDialogMode,
  formMode: EmailFormMode,
): string {
  if (mode === "connect") {
    return formMode === "signUp"
      ? "Create email credentials"
      : "Verify and add email";
  }
  return formMode === "signUp" ? "Create account" : "Sign in";
}

function availabilityCopy(
  availability: ReturnType<typeof resolveEmailAuthAvailability>,
): { title: string; detail: string; retry: boolean } | null {
  switch (availability) {
    case "retry":
      return {
        title: "Email sign-in is unavailable",
        detail:
          "We couldn't check email sign-in right now. Check your connection and try again.",
        retry: true,
      };
    case "notReady":
      return {
        title: "Email sign-in isn't ready yet",
        detail:
          "This sign-in option still needs setup. Please try again later or use another available sign-in method.",
        retry: true,
      };
    case "disabled":
      return {
        title: "Email sign-in is unavailable",
        detail: "Email sign-in is not enabled for this Circles environment.",
        retry: false,
      };
    default:
      return null;
  }
}

/**
 * The legacy-account proof path is intentionally not a third ordinary sign-in
 * method. It is available only from the idle sign-in view, where it transfers
 * the user to the protected email-connection route.
 */
export function canOfferExistingCirclesAccountConnection(
  mode: EmailAuthDialogMode,
  formMode: EmailFormMode,
  onConnectExisting: (() => void) | undefined,
): boolean {
  return (
    mode === "signIn" &&
    formMode === "signIn" &&
    typeof onConnectExisting === "function"
  );
}

export function EmailAuthForm(props: EmailAuthFormProps) {
  // Changing the public dialog mode creates a new local instance. That gives
  // each mode an independent async scope, including an A→B→A transition.
  return <EmailAuthDialog key={props.mode} {...props} />;
}

function EmailAuthDialog({
  mode,
  onAuthenticated,
  onClose,
  onConnectExisting,
}: EmailAuthFormProps) {
  const insets = useSafeAreaInsets();
  const [dialogInstanceId] = useState(() => ++nextDialogInstanceId);
  const [statusGuard] = useState(() =>
    createEmailAuthAsyncGuard(dialogInstanceId),
  );
  const [submissionGuard] = useState(() =>
    createEmailAuthAsyncGuard(dialogInstanceId),
  );
  const passwordRef = useRef("");
  const statusFlightRef = useRef<EmailAuthAsyncScope | null>(null);
  const submissionFlightRef = useRef<SubmissionFlight | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [formMode, setFormMode] = useState<EmailFormMode>("signIn");
  const [checkingStatus, setCheckingStatus] = useState(true);
  const [status, setStatus] = useState<Awaited<
    ReturnType<typeof readEmailAuthStatus>
  > | null>(null);
  const [statusFailed, setStatusFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [signUpConfirmed, setSignUpConfirmed] = useState(false);

  const isCurrent = useCallback(
    (
      guard: ReturnType<typeof createEmailAuthAsyncGuard>,
      scope: EmailAuthAsyncScope,
    ) => guard.isCurrent(scope, mode),
    [mode],
  );

  const clearPassword = useCallback(() => {
    passwordRef.current = "";
    setPassword("");
  }, []);

  const loadStatus = useCallback(async () => {
    const currentFlight = statusFlightRef.current;
    if (currentFlight && isCurrent(statusGuard, currentFlight)) return;

    const scope = statusGuard.begin(mode);
    statusFlightRef.current = scope;

    try {
      const nextStatus = await readEmailAuthStatus();
      if (!isCurrent(statusGuard, scope)) return;
      setStatus(nextStatus);
      setStatusFailed(false);
    } catch {
      if (!isCurrent(statusGuard, scope)) return;
      setStatusFailed(true);
    } finally {
      if (statusFlightRef.current?.sequence === scope.sequence) {
        statusFlightRef.current = null;
      }
      if (!isCurrent(statusGuard, scope)) return;
      setCheckingStatus(false);
      statusGuard.clear(scope);
    }
  }, [isCurrent, mode, statusGuard]);

  const retryStatus = useCallback(() => {
    const currentFlight = statusFlightRef.current;
    if (currentFlight && isCurrent(statusGuard, currentFlight)) return;

    // A user-initiated retry may present its loader immediately. The initial
    // effect deliberately makes no synchronous state updates: checking starts
    // true and its request commits state only after its first await.
    setCheckingStatus(true);
    setStatus(null);
    setStatusFailed(false);
    void loadStatus();
  }, [isCurrent, loadStatus, statusGuard]);

  const abortSubmissionFlight = useCallback(() => {
    submissionFlightRef.current?.controller.abort();
    submissionFlightRef.current = null;
  }, []);

  useEffect(() => {
    statusGuard.activate();
    submissionGuard.activate();
    return () => {
      statusGuard.deactivate();
      submissionGuard.deactivate();
      abortSubmissionFlight();
      passwordRef.current = "";
    };
  }, [abortSubmissionFlight, statusGuard, submissionGuard]);

  useEffect(() => {
    // `checkingStatus` is initialized to true, so this startup path begins its
    // async scope without a deferred state-write workaround.
    void (async () => {
      await loadStatus();
    })();
    return () => {
      statusGuard.invalidate();
    };
  }, [loadStatus, statusGuard]);

  const availability = resolveEmailAuthAvailability({
    checking: checkingStatus,
    status,
    failed: statusFailed,
  });
  const availabilityMessage = availabilityCopy(availability);
  const isAvailable = availability === "available";
  const hasPendingOperation = checkingStatus || submitting;

  const updateEmail = useCallback((value: string) => {
    setEmail(value);
    setFormError(null);
  }, []);

  const updatePassword = useCallback((value: string) => {
    passwordRef.current = value;
    setPassword(value);
    setFormError(null);
  }, []);

  const showSignIn = useCallback(() => {
    if (hasPendingOperation) return;
    clearPassword();
    setFormMode("signIn");
    setFormError(null);
    setSignUpConfirmed(false);
  }, [clearPassword, hasPendingOperation]);

  const showSignUp = useCallback(() => {
    if (hasPendingOperation) return;
    clearPassword();
    setFormMode("signUp");
    setFormError(null);
    setSignUpConfirmed(false);
  }, [clearPassword, hasPendingOperation]);

  const close = useCallback(() => {
    statusGuard.invalidate();
    submissionGuard.invalidate();
    statusFlightRef.current = null;
    abortSubmissionFlight();
    clearPassword();
    onClose();
  }, [
    abortSubmissionFlight,
    clearPassword,
    onClose,
    statusGuard,
    submissionGuard,
  ]);

  const connectExistingCirclesAccount = useCallback(() => {
    if (hasPendingOperation || !onConnectExisting) return;
    // Close this credential dialog before navigating. Its cancellation and
    // password-clearing semantics are exactly the ordinary close path.
    close();
    onConnectExisting();
  }, [close, hasPendingOperation, onConnectExisting]);

  const submit = useCallback(async () => {
    const currentFlight = submissionFlightRef.current;
    if (currentFlight && isCurrent(submissionGuard, currentFlight.scope))
      return;
    if (!isAvailable) return;

    const scope = submissionGuard.begin(mode);
    const controller = new AbortController();
    submissionFlightRef.current = { scope, controller };
    const emailToSubmit = email.trim();
    const passwordToSubmit = passwordRef.current;
    const requestOptions = {
      signal: controller.signal,
      isCurrent: () => isCurrent(submissionGuard, scope),
    };
    setSubmitting(true);
    setFormError(null);
    setSignUpConfirmed(false);

    try {
      if (!emailToSubmit || !passwordToSubmit) {
        if (isCurrent(submissionGuard, scope)) {
          setFormError("Enter your email address and password to continue.");
        }
        return;
      }

      if (formMode === "signUp") {
        await signUpWithEmailPassword(
          emailToSubmit,
          passwordToSubmit,
          requestOptions,
        );
        if (!isCurrent(submissionGuard, scope)) return;
        clearPassword();
        setFormMode("signUp");
        setSignUpConfirmed(true);
        return;
      }

      if (mode === "connect") {
        await connectEmailPassword(
          emailToSubmit,
          passwordToSubmit,
          requestOptions,
        );
      } else {
        await signInWithEmailPassword(
          emailToSubmit,
          passwordToSubmit,
          requestOptions,
        );
      }

      if (!isCurrent(submissionGuard, scope)) return;
      const confirmed = await onAuthenticated();
      if (!isCurrent(submissionGuard, scope)) return;
      if (!confirmed) {
        setFormError(
          "We couldn't confirm your sign-in. Check your connection and try again.",
        );
      }
    } catch {
      if (!isCurrent(submissionGuard, scope)) return;
      setFormError(
        formMode === "signUp"
          ? "We couldn't create that account. Please try again."
          : "Email or password is incorrect, or sign-in is unavailable. Please try again.",
      );
    } finally {
      if (submissionFlightRef.current?.scope.sequence === scope.sequence) {
        submissionFlightRef.current = null;
      }
      if (!isCurrent(submissionGuard, scope)) return;
      clearPassword();
      setSubmitting(false);
      submissionGuard.clear(scope);
    }
  }, [
    clearPassword,
    email,
    formMode,
    isAvailable,
    isCurrent,
    mode,
    onAuthenticated,
    submissionGuard,
  ]);

  const confirmedSignUp = formMode === "signUp" && signUpConfirmed;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={{ flexGrow: 0, flexShrink: 1, width: "100%" }}
    >
      <ScrollView
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        style={{ flexShrink: 1, width: "100%" }}
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          paddingHorizontal: 20,
          paddingTop: Math.max(20, insets.top + 12),
          paddingBottom: Math.max(24, insets.bottom + 20),
        }}
      >
        <View
          style={{
            alignSelf: "center",
            backgroundColor: C.paper,
            borderColor: C.border,
            borderRadius: 24,
            borderWidth: 1,
            gap: 16,
            maxWidth: 440,
            padding: 24,
            width: "100%",
          }}
        >
          <View
            style={{
              alignItems: "flex-start",
              flexDirection: "row",
              justifyContent: "space-between",
              gap: 16,
            }}
          >
            <View style={{ flex: 1, gap: 5 }}>
              <T
                accessibilityRole="header"
                style={{ fontSize: 25, fontWeight: "800" }}
              >
                {dialogTitle(mode, formMode)}
              </T>
              <T style={{ color: C.muted, fontSize: 15 }}>
                {mode === "connect"
                  ? formMode === "signUp"
                    ? "Create credentials, confirm the email, then return here to add them to your Circles account."
                    : "Use an email address you have already verified with Supabase."
                  : "Use your email and password to continue to Circles."}
              </T>
            </View>
            <IconButton
              icon="close"
              label="Close email sign-in"
              onPress={close}
            />
          </View>

          {availability === "loading" ? (
            <View
              accessibilityLiveRegion="polite"
              style={{ alignItems: "center", gap: 12, paddingVertical: 28 }}
            >
              <ActivityIndicator color={C.coral} />
              <T style={{ color: C.muted }}>Checking email sign-in…</T>
            </View>
          ) : availabilityMessage ? (
            <View
              accessibilityLiveRegion="polite"
              style={{
                backgroundColor: C.sage,
                borderRadius: 16,
                gap: 10,
                padding: 18,
              }}
            >
              <T style={{ fontSize: 18, fontWeight: "700" }}>
                {availabilityMessage.title}
              </T>
              <T style={{ color: C.secondary }}>{availabilityMessage.detail}</T>
              {availabilityMessage.retry && (
                <Button
                  title="Try again"
                  accessibilityLabel="Retry email sign-in availability"
                  secondary
                  disabled={checkingStatus}
                  loading={checkingStatus}
                  onPress={retryStatus}
                  style={{ alignSelf: "flex-start", marginTop: 4 }}
                />
              )}
            </View>
          ) : confirmedSignUp ? (
            <View
              accessibilityLiveRegion="polite"
              style={{
                backgroundColor: C.sage,
                borderRadius: 16,
                gap: 10,
                padding: 18,
              }}
            >
              <T
                accessibilityRole="header"
                style={{ fontSize: 19, fontWeight: "700" }}
              >
                Check your email
              </T>
              <T style={{ color: C.secondary }}>
                {mode === "connect"
                  ? "If credentials can be created for this address, check your email to confirm them. Then return to this screen and verify the confirmed password to add email sign-in. Your Circles session remains signed in."
                  : "If an account can be created for this address, check your email to confirm it. Then return here to sign in."}
              </T>
              <Button
                title={
                  mode === "connect"
                    ? "Back to add email sign-in"
                    : "Back to sign in"
                }
                accessibilityLabel={
                  mode === "connect"
                    ? "Back to add email sign-in"
                    : "Back to email sign in"
                }
                secondary
                onPress={showSignIn}
                style={{ alignSelf: "flex-start", marginTop: 4 }}
              />
            </View>
          ) : (
            <View style={{ gap: 14 }}>
              {mode === "connect" && (
                <View
                  style={{
                    backgroundColor: C.soft,
                    borderRadius: 14,
                    gap: 6,
                    padding: 14,
                  }}
                >
                  <T style={{ color: C.secondary, fontSize: 13 }}>
                    An email address alone cannot link an account. Verify this
                    password for your current Circles session, and confirm the
                    email with Supabase first.
                  </T>
                </View>
              )}
              <Input
                accessibilityLabel="Email address"
                autoCapitalize="none"
                autoComplete="email"
                autoCorrect={false}
                autoFocus
                editable={!hasPendingOperation}
                keyboardType="email-address"
                label="EMAIL ADDRESS"
                onChangeText={updateEmail}
                placeholder="you@example.com"
                returnKeyType="next"
                textContentType="emailAddress"
                value={email}
              />
              <Input
                accessibilityLabel="Password"
                autoComplete={
                  formMode === "signUp" ? "new-password" : "current-password"
                }
                editable={!hasPendingOperation}
                label="PASSWORD"
                onChangeText={updatePassword}
                onSubmitEditing={() => void submit()}
                returnKeyType="done"
                secureTextEntry
                textContentType={
                  formMode === "signUp" ? "newPassword" : "password"
                }
                value={password}
              />
              {formError && (
                <T
                  accessibilityLiveRegion="assertive"
                  accessibilityRole="alert"
                  style={{ color: C.secondary, fontSize: 13 }}
                >
                  {formError}
                </T>
              )}
              <Button
                title={submitting ? "Working…" : submitTitle(mode, formMode)}
                accessibilityLabel={submitTitle(mode, formMode)}
                disabled={!isAvailable}
                loading={submitting}
                onPress={() => void submit()}
              />
              {formMode === "signIn" && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    mode === "connect"
                      ? "Create email credentials"
                      : "Create an account with email"
                  }
                  accessibilityState={{ disabled: hasPendingOperation }}
                  disabled={hasPendingOperation}
                  onPress={showSignUp}
                  style={{
                    alignItems: "center",
                    justifyContent: "center",
                    minHeight: 44,
                  }}
                >
                  <T style={{ color: C.secondary, fontWeight: "700" }}>
                    {mode === "connect"
                      ? "Create email credentials"
                      : "Create an account"}
                  </T>
                </Pressable>
              )}
              {formMode === "signUp" && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    mode === "connect"
                      ? "Back to add email sign-in"
                      : "Back to email sign in"
                  }
                  accessibilityState={{ disabled: hasPendingOperation }}
                  disabled={hasPendingOperation}
                  onPress={showSignIn}
                  style={{
                    alignItems: "center",
                    justifyContent: "center",
                    minHeight: 44,
                  }}
                >
                  <T style={{ color: C.secondary, fontWeight: "700" }}>
                    {mode === "connect"
                      ? "Already have confirmed credentials? Add email sign-in"
                      : "Already have an account? Sign in"}
                  </T>
                </Pressable>
              )}
              {canOfferExistingCirclesAccountConnection(
                mode,
                formMode,
                onConnectExisting,
              ) && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Connect existing Circles account"
                  accessibilityState={{ disabled: hasPendingOperation }}
                  disabled={hasPendingOperation}
                  onPress={connectExistingCirclesAccount}
                  style={{
                    alignItems: "center",
                    justifyContent: "center",
                    minHeight: 44,
                  }}
                >
                  <T style={{ color: C.secondary, fontWeight: "700" }}>
                    Connect existing Circles account
                  </T>
                </Pressable>
              )}
            </View>
          )}

          <T style={{ color: C.muted, fontSize: 12, textAlign: "center" }}>
            Google sign-in is planned for a later release.
          </T>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
