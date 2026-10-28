export const EMAIL_SIGN_UP_MESSAGES = {
  email_auth_weak_password: "Use at least 8 characters for your password.",
  email_auth_rate_limited:
    "Too many attempts. Please wait and try again later.",
  email_auth_delivery_unavailable:
    "Account emails are unavailable right now. Please try again later.",
} as const;

export function emailAuthInputError(
  email: string,
  password: string,
  signUp: boolean,
): string | null {
  if (!email.trim() || !password)
    return "Enter your email address and password to continue.";
  if (
    email.trim().length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  )
    return "Enter a valid email address.";
  if (password.length > 1_024) return "Your password is too long.";
  if (signUp && password.length < 8)
    return EMAIL_SIGN_UP_MESSAGES.email_auth_weak_password;
  return null;
}

/** Only owned, bounded categories may become credential-form feedback. */
export function emailAuthFormFailure(error: unknown, signUp: boolean): string {
  const code =
    error && typeof error === "object" && "code" in error
      ? error.code
      : undefined;
  if (
    typeof code === "string" &&
    Object.prototype.hasOwnProperty.call(EMAIL_SIGN_UP_MESSAGES, code)
  ) {
    return EMAIL_SIGN_UP_MESSAGES[code as keyof typeof EMAIL_SIGN_UP_MESSAGES];
  }
  return signUp
    ? "We couldn't create that account. Please try again."
    : "Email or password is incorrect, or sign-in is unavailable. Please try again.";
}
