import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiCall: vi.fn(),
  platform: { OS: "ios" },
  setSessionToken: vi.fn(),
}));

vi.mock("react-native", () => ({ Platform: mocks.platform }));
vi.mock("@/lib/_core/api", () => ({ apiCall: mocks.apiCall }));
vi.mock("@/lib/_core/auth", () => ({
  setSessionToken: mocks.setSessionToken,
}));

const client = await import("../lib/email-auth-client");

const readyStatus = {
  enabled: true,
  ready: true,
  emailEnabled: true,
  googleEnabled: false,
  confirmationRequired: true,
};

describe("email authentication client protocol", () => {
  beforeEach(async () => {
    await client.cancelAndDrainEmailAuthRequests();
    mocks.apiCall.mockReset();
    mocks.setSessionToken.mockReset();
    mocks.platform.OS = "ios";
  });

  afterEach(async () => {
    await client.cancelAndDrainEmailAuthRequests();
    vi.restoreAllMocks();
  });

  it("reads only the exact status DTO and rejects a malformed provider capability response", async () => {
    mocks.apiCall.mockResolvedValueOnce(readyStatus);
    await expect(client.readEmailAuthStatus()).resolves.toEqual(readyStatus);
    expect(mocks.apiCall).toHaveBeenCalledWith("/api/auth/email/status");

    mocks.apiCall.mockResolvedValueOnce({
      ...readyStatus,
      googleEnabled: true,
    });
    await expect(client.readEmailAuthStatus()).rejects.toMatchObject({
      code: "email_auth_status_unavailable",
    });
  });

  it("sends email credentials only to the native sign-in endpoint and persists its Circles bearer before resolving", async () => {
    const tokenStored = new Promise<void>((resolve) => {
      mocks.setSessionToken.mockImplementationOnce(async () => resolve());
    });
    mocks.apiCall.mockResolvedValueOnce({
      success: true,
      sessionToken: "native-only",
    });

    const signIn = client.signInWithEmailPassword(
      "a@example.test",
      "not logged",
    );
    await tokenStored;
    await signIn;

    expect(mocks.apiCall).toHaveBeenCalledWith(
      "/api/auth/email/sign-in",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          email: "a@example.test",
          password: "not logged",
          client: "native",
        }),
        signal: expect.any(AbortSignal),
      }),
    );
    expect(mocks.setSessionToken).toHaveBeenCalledWith("native-only");
  });

  it("relies on the browser cookie and never writes a browser session token", async () => {
    mocks.platform.OS = "web";
    mocks.apiCall.mockResolvedValueOnce({ success: true });

    await client.signInWithEmailPassword(
      "web@example.test",
      "ephemeral-password",
    );

    expect(mocks.apiCall).toHaveBeenCalledWith(
      "/api/auth/email/sign-in",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          email: "web@example.test",
          password: "ephemeral-password",
          client: "web",
        }),
        signal: expect.any(AbortSignal),
      }),
    );
    expect(mocks.setSessionToken).not.toHaveBeenCalled();
  });

  it("uses the server connect route without caller identity and requires a native session token", async () => {
    mocks.apiCall.mockResolvedValueOnce({ success: true });
    await expect(
      client.connectEmailPassword("member@example.test", "password"),
    ).rejects.toMatchObject({ code: "email_auth_session_unavailable" });
    expect(mocks.apiCall).toHaveBeenCalledWith(
      "/api/auth/email/connect",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          email: "member@example.test",
          password: "password",
          client: "native",
        }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("uses confirmation-only sign-up and exposes bounded errors instead of a raw upstream message", async () => {
    mocks.platform.OS = "web";
    mocks.apiCall.mockResolvedValueOnce({
      success: true,
      confirmationRequired: true,
    });
    await expect(
      client.signUpWithEmailPassword("new@example.test", "new-password"),
    ).resolves.toBeUndefined();
    expect(mocks.apiCall).toHaveBeenLastCalledWith(
      "/api/auth/email/sign-up",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          email: "new@example.test",
          password: "new-password",
        }),
        signal: expect.any(AbortSignal),
      }),
    );

    mocks.apiCall.mockRejectedValueOnce(
      new Error("raw provider token and password should never reach the UI"),
    );
    await expect(
      client.signInWithEmailPassword("new@example.test", "new-password"),
    ).rejects.toMatchObject({
      code: "email_auth_failed",
      message:
        "Email or password is incorrect, or sign-in is unavailable. Please try again.",
    });
  });

  it("maps only the exact account-link response and keeps other provider failures generic", async () => {
    mocks.apiCall.mockRejectedValueOnce(
      new Error("Email identity requires account linking"),
    );
    await expect(
      client.signInWithEmailPassword("linked@example.test", "password"),
    ).rejects.toMatchObject({
      code: "email_auth_link_required",
      message:
        "This verified email must be connected to your existing Circles account. While signed in to that account, open Profile → Connect email sign-in.",
    });

    mocks.apiCall.mockRejectedValueOnce(
      new Error("provider said account linking for linked@example.test"),
    );
    await expect(
      client.signInWithEmailPassword("linked@example.test", "password"),
    ).rejects.toMatchObject({
      code: "email_auth_failed",
      message:
        "Email or password is incorrect, or sign-in is unavailable. Please try again.",
    });
  });

  it("asks for a password reset without sending a password or expecting a session", async () => {
    mocks.platform.OS = "web";
    mocks.apiCall.mockResolvedValueOnce({ success: true });
    await expect(
      client.requestPasswordReset("member@example.test"),
    ).resolves.toBeUndefined();
    expect(mocks.apiCall).toHaveBeenCalledWith(
      "/api/auth/email/password-reset",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          email: "member@example.test",
          client: "web",
        }),
        signal: expect.any(AbortSignal),
      }),
    );
    expect(mocks.setSessionToken).not.toHaveBeenCalled();
  });
});
