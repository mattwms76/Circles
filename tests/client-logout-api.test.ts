import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Api from "../lib/_core/api";

const mocks = vi.hoisted(() => ({
  getSessionToken: vi.fn(),
  getApiRequestUrl: vi.fn((path: string) => `https://api.example.test${path}`),
}));

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("@/constants/oauth", () => ({
  getApiRequestUrl: mocks.getApiRequestUrl,
}));
vi.mock("../lib/_core/auth", () => ({
  getSessionToken: mocks.getSessionToken,
}));

describe("captured native logout bearer", () => {
  beforeEach(() => {
    mocks.getSessionToken.mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("{}", {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the bearer captured before local purge rather than rereading SecureStore", async () => {
    await Api.logout("captured-native-bearer");

    expect(mocks.getSessionToken).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledOnce();
    const [, options] = vi.mocked(fetch).mock.calls[0];
    expect(options?.method).toBe("POST");
    expect(new Headers(options?.headers).get("Authorization")).toBe(
      "Bearer captured-native-bearer",
    );
  });
});
