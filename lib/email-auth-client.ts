import { Platform } from "react-native";
import * as Api from "@/lib/_core/api";
import * as nativeAuth from "@/lib/_core/auth";

export type EmailAuthStatus = {
  enabled: boolean;
  ready: boolean;
  emailEnabled: boolean;
  googleEnabled: false;
  confirmationRequired: true;
};

type EmailAuthSuccess = {
  success: true;
  sessionToken?: string;
};

type EmailSignUpSuccess = {
  success: true;
  confirmationRequired: true;
};

export type EmailAuthRequestOptions = {
  signal?: AbortSignal;
  isCurrent?: () => boolean;
};

export type EmailAuthClientErrorCode =
  | "email_auth_status_unavailable"
  | "email_auth_failed"
  | "email_auth_link_required"
  | "email_auth_session_unavailable"
  | "email_auth_sign_up_failed";

/**
 * This error deliberately contains only a bounded, user-safe category. The API
 * client can receive provider failures, which must never become UI copy.
 */
export class EmailAuthClientError extends Error {
  readonly code: EmailAuthClientErrorCode;

  constructor(code: EmailAuthClientErrorCode) {
    super(emailAuthErrorMessage(code));
    this.name = "EmailAuthClientError";
    this.code = code;
  }
}

export function emailAuthErrorMessage(code: EmailAuthClientErrorCode): string {
  switch (code) {
    case "email_auth_status_unavailable":
      return "Email sign-in is unavailable right now. Please try again.";
    case "email_auth_session_unavailable":
      return "We couldn't complete sign-in. Please try again.";
    case "email_auth_sign_up_failed":
      return "We couldn't create that account. Please try again.";
    case "email_auth_link_required":
      return "This verified email must be connected to your existing Circles account. While signed in to that account, open Profile → Connect email sign-in.";
    case "email_auth_failed":
      return "Email or password is incorrect, or sign-in is unavailable. Please try again.";
  }
}

export function emailAuthClientKind(): "web" | "native" {
  return Platform.OS === "web" ? "web" : "native";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readStatus(value: unknown): EmailAuthStatus {
  if (
    !isRecord(value) ||
    typeof value.enabled !== "boolean" ||
    typeof value.ready !== "boolean" ||
    typeof value.emailEnabled !== "boolean" ||
    value.googleEnabled !== false ||
    value.confirmationRequired !== true
  ) {
    throw new EmailAuthClientError("email_auth_status_unavailable");
  }

  return {
    enabled: value.enabled,
    ready: value.ready,
    emailEnabled: value.emailEnabled,
    googleEnabled: false,
    confirmationRequired: true,
  };
}

function readAuthSuccess(value: unknown): EmailAuthSuccess {
  if (!isRecord(value) || value.success !== true) {
    throw new EmailAuthClientError("email_auth_failed");
  }

  return {
    success: true,
    ...(typeof value.sessionToken === "string"
      ? { sessionToken: value.sessionToken }
      : {}),
  };
}

function readSignUpSuccess(value: unknown): EmailSignUpSuccess {
  if (
    !isRecord(value) ||
    value.success !== true ||
    value.confirmationRequired !== true
  ) {
    throw new EmailAuthClientError("email_auth_sign_up_failed");
  }

  return { success: true, confirmationRequired: true };
}

type EmailAuthRequest = {
  signal: AbortSignal;
  isCurrent: () => boolean;
  dispose: () => void;
};

let requestGeneration = 0;
let latestRequestGeneration = 0;
const activeRequests = new Set<AbortController>();
let nativeWriteTail: Promise<void> = Promise.resolve();

function beginEmailAuthRequest(
  options: EmailAuthRequestOptions = {},
): EmailAuthRequest {
  const controller = new AbortController();
  const generation = ++requestGeneration;
  latestRequestGeneration = generation;
  activeRequests.add(controller);

  const abortFromCaller = () => controller.abort();
  if (options.signal?.aborted) {
    controller.abort();
  } else {
    options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  }

  let disposed = false;
  return {
    signal: controller.signal,
    isCurrent: () => {
      if (controller.signal.aborted || generation !== latestRequestGeneration) {
        return false;
      }

      try {
        return options.isCurrent?.() ?? true;
      } catch {
        return false;
      }
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      activeRequests.delete(controller);
      options.signal?.removeEventListener("abort", abortFromCaller);
    },
  };
}

/**
 * Native storage is process-global. Queue writes so a newer active email
 * request can supersede an older queued request before the older token reaches
 * SecureStore. A write that has already entered SecureStore cannot be undone;
 * callers that preempt it must cancel and drain before their own transition.
 */
function enqueueNativeSessionTokenWrite(
  request: EmailAuthRequest,
  sessionToken: string,
): Promise<boolean> {
  const write = nativeWriteTail.then(async () => {
    if (!request.isCurrent()) return false;
    await nativeAuth.setSessionToken(sessionToken);
    return true;
  });

  nativeWriteTail = write.then(
    () => undefined,
    () => undefined,
  );
  return write;
}

/**
 * Abort all started email-auth HTTP requests and wait for a SecureStore write
 * that was already in progress. This deliberately never deletes a token: a
 * later non-email login may have stored a newer bearer while cancellation is
 * being coordinated by the caller.
 */
export async function cancelAndDrainEmailAuthRequests(): Promise<void> {
  latestRequestGeneration = ++requestGeneration;
  for (const controller of activeRequests) {
    controller.abort();
  }

  const writesBeforeCancellation = nativeWriteTail;
  await writesBeforeCancellation;
}

async function postEmailCredentials(
  endpoint: "/api/auth/email/sign-in" | "/api/auth/email/connect",
  email: string,
  password: string,
  options: EmailAuthRequestOptions,
): Promise<void> {
  const request = beginEmailAuthRequest(options);
  const client = emailAuthClientKind();

  try {
    let result: unknown;
    try {
      result = await Api.apiCall<unknown>(endpoint, {
        method: "POST",
        body: JSON.stringify({ email, password, client }),
        signal: request.signal,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "Email identity requires account linking"
      ) {
        throw new EmailAuthClientError("email_auth_link_required");
      }
      throw new EmailAuthClientError("email_auth_failed");
    }

    const authenticated = readAuthSuccess(result);
    if (!request.isCurrent() || client !== "native") return;

    if (!authenticated.sessionToken) {
      throw new EmailAuthClientError("email_auth_session_unavailable");
    }

    try {
      await enqueueNativeSessionTokenWrite(request, authenticated.sessionToken);
    } catch {
      if (!request.isCurrent()) return;
      throw new EmailAuthClientError("email_auth_session_unavailable");
    }
  } finally {
    request.dispose();
  }
}

export async function readEmailAuthStatus(): Promise<EmailAuthStatus> {
  let result: unknown;

  try {
    result = await Api.apiCall<unknown>("/api/auth/email/status");
  } catch {
    throw new EmailAuthClientError("email_auth_status_unavailable");
  }

  return readStatus(result);
}

export async function signInWithEmailPassword(
  email: string,
  password: string,
  options: EmailAuthRequestOptions = {},
): Promise<void> {
  await postEmailCredentials(
    "/api/auth/email/sign-in",
    email,
    password,
    options,
  );
}

export async function signUpWithEmailPassword(
  email: string,
  password: string,
  options: EmailAuthRequestOptions = {},
): Promise<void> {
  const request = beginEmailAuthRequest(options);

  try {
    let result: unknown;
    try {
      result = await Api.apiCall<unknown>("/api/auth/email/sign-up", {
        method: "POST",
        body: JSON.stringify({ email, password }),
        signal: request.signal,
      });
    } catch {
      throw new EmailAuthClientError("email_auth_sign_up_failed");
    }

    readSignUpSuccess(result);
  } finally {
    request.dispose();
  }
}

export async function connectEmailPassword(
  email: string,
  password: string,
  options: EmailAuthRequestOptions = {},
): Promise<void> {
  await postEmailCredentials(
    "/api/auth/email/connect",
    email,
    password,
    options,
  );
}
