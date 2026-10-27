import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  platform: { OS: "ios" },
  getSessionToken: vi.fn(),
  initializeCredentialAdmission: vi.fn(async () => undefined),
}));
vi.mock("react-native", () => ({ Platform: mocks.platform }));
vi.mock("@/constants/oauth", () => ({
  getApiRequestUrl: (path: string) => `https://api.example.test${path}`,
}));
vi.mock("../lib/_core/auth", () => ({
  getSessionToken: mocks.getSessionToken,
  initializeCredentialAdmission: mocks.initializeCredentialAdmission,
}));

beforeEach(() => {
  vi.resetModules();
  mocks.platform.OS = "ios";
  mocks.getSessionToken.mockReset();
  mocks.initializeCredentialAdmission.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response("{}", { headers: { "content-type": "application/json" } }),
    ),
  );
});
afterEach(() => vi.unstubAllGlobals());

async function setup() {
  const { credentialAdmission } =
    await import("../lib/sec27-credential-admission");
  await credentialAdmission.configureStorage({
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  });
  return { credentialAdmission, Api: await import("../lib/_core/api") };
}

function requestOptions(): RequestInit | undefined {
  return vi.mocked(fetch).mock.calls[0]?.[1];
}

describe("SEC008 independent HTTP credential admission", () => {
  it("strips a bearer resolved after logout starts before ordinary dispatch", async () => {
    const { credentialAdmission, Api } = await setup();
    let resolveToken!: (token: string) => void;
    mocks.getSessionToken.mockReturnValue(
      new Promise<string>((resolve) => {
        resolveToken = resolve;
      }),
    );
    const pending = Api.apiCall("/api/auth/me");
    await vi.waitFor(() =>
      expect(mocks.getSessionToken).toHaveBeenCalledOnce(),
    );
    credentialAdmission.beginIncompleteLogout();
    resolveToken("stale-native-fixture");
    await pending;
    expect(new Headers(requestOptions()?.headers).has("Authorization")).toBe(
      false,
    );
    expect(requestOptions()?.credentials).toBe("omit");
  });

  it("omits retained web cookies for ordinary standalone API calls", async () => {
    const { credentialAdmission, Api } = await setup();
    mocks.platform.OS = "web";
    credentialAdmission.beginIncompleteLogout();
    await Api.apiCall("/api/auth/me");
    expect(requestOptions()?.credentials).toBe("omit");
    expect(new Headers(requestOptions()?.headers).has("Authorization")).toBe(
      false,
    );
  });

  it("retains captured bearer and browser-cookie revocation only at exact logout POST", async () => {
    const { credentialAdmission, Api } = await setup();
    credentialAdmission.beginIncompleteLogout();
    await Api.logout("captured-recovery-fixture");
    expect(fetch).toHaveBeenCalledWith(
      "https://api.example.test/api/auth/logout",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
    expect(new Headers(requestOptions()?.headers).get("Authorization")).toBe(
      "Bearer captured-recovery-fixture",
    );
    expect(mocks.getSessionToken).not.toHaveBeenCalled();
    vi.mocked(fetch).mockClear();
    await Api.apiCall("/api/auth/logout", {
      method: "POST",
      headers: { Authorization: "Bearer caller-selected" },
    });
    expect(requestOptions()?.credentials).toBe("omit");
    expect(new Headers(requestOptions()?.headers).has("Authorization")).toBe(
      false,
    );
  });

  it("does not claim native revocation when the recovery credential is unavailable", async () => {
    const { credentialAdmission, Api } = await setup();
    credentialAdmission.beginIncompleteLogout();
    await expect(Api.logout(null)).rejects.toThrow("cannot be confirmed");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("cannot establish a new cookie session while logout recovery is blocked", async () => {
    const { credentialAdmission, Api } = await setup();
    credentialAdmission.beginIncompleteLogout();
    await expect(Api.establishSession("not-admitted-fixture")).resolves.toBe(
      false,
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
