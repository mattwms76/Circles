import { describe, expect, it } from "vitest";
import {
  rootFeedbackNoticeBottom,
  narrowTabBarOccupiedHeight,
} from "../lib/a26-auth-layout";
import { completeCurrentAuthOperation } from "../lib/a26-auth-operation";
import {
  ACCOUNT_EMAIL_OAUTH_CONTINUATION,
  isSameNativeOAuthPendingFlow,
  normalizeOAuthContinuation,
  parseNativeOAuthPendingFlow,
  serializeNativeOAuthPendingFlow,
} from "../lib/a26-auth-oauth";
import { resolveProtectedActionRequest } from "../lib/a26-auth-protected-action";
import { resolveEmailAuthAvailability } from "../lib/email-auth-ui";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("A26 auth repairs", () => {
  it("requires a new protected-action tap after identity checking instead of replaying a pre-auth callback", () => {
    expect(resolveProtectedActionRequest("checking")).toMatchObject({
      kind: "checking",
      message: expect.stringContaining("try that again"),
    });
    expect(resolveProtectedActionRequest("authenticated")).toEqual({
      kind: "run",
    });
    expect(resolveProtectedActionRequest("error")).toMatchObject({
      kind: "authError",
    });
  });

  it("does not navigate when Close invalidates the form operation during confirmation", async () => {
    const confirmation = deferred<boolean>();
    let current = true;
    let navigations = 0;
    const completion = completeCurrentAuthOperation(
      { isCurrent: () => current },
      () => confirmation.promise,
      () => {
        navigations += 1;
      },
    );

    current = false;
    confirmation.resolve(true);

    await expect(completion).resolves.toBe(false);
    expect(navigations).toBe(0);
  });

  it("allows route navigation only for a still-current, confirmed operation", async () => {
    let navigations = 0;
    await expect(
      completeCurrentAuthOperation(
        { isCurrent: () => true },
        async () => true,
        () => {
          navigations += 1;
        },
      ),
    ).resolves.toBe(true);
    expect(navigations).toBe(1);
  });

  it("persists only the allow-listed email continuation and preserves legacy raw tokens safely", () => {
    const flow = {
      flowToken: "native-flow-token-abcdefghijklmnopqrstuvwxyz",
      generation: 17,
      continuation: ACCOUNT_EMAIL_OAUTH_CONTINUATION,
      expiresAt: 1_800_000_000_000,
    } as const;
    const parsed = parseNativeOAuthPendingFlow(
      serializeNativeOAuthPendingFlow(flow),
    );

    expect(parsed).toEqual(flow);
    expect(normalizeOAuthContinuation("/account/email")).toBe(
      ACCOUNT_EMAIL_OAUTH_CONTINUATION,
    );
    expect(normalizeOAuthContinuation("/profile?next=evil")).toBeNull();
    expect(parseNativeOAuthPendingFlow(flow.flowToken)).toMatchObject({
      flowToken: flow.flowToken,
      generation: 0,
      continuation: null,
    });
  });

  it("compares token and generation so F1 cannot consume or complete F2", () => {
    const first = {
      flowToken: "native-flow-token-abcdefghijklmnopqrstuvwxyz",
      generation: 4,
      continuation: null,
      expiresAt: null,
    };
    const second = { ...first, generation: 5 };

    expect(isSameNativeOAuthPendingFlow(first, first)).toBe(true);
    expect(isSameNativeOAuthPendingFlow(first, second)).toBe(false);
  });

  it("treats disabled-and-unready email capability as unavailable rather than retryable setup", () => {
    expect(
      resolveEmailAuthAvailability({
        checking: false,
        failed: false,
        status: {
          enabled: false,
          ready: false,
          emailEnabled: false,
          googleEnabled: false,
          confirmationRequired: true,
        },
      }),
    ).toBe("disabled");
  });

  it("clears a tall narrow tab bar using its actual safe inset and retains non-tab fallback", () => {
    expect(narrowTabBarOccupiedHeight(50)).toBe(104);
    expect(
      rootFeedbackNoticeBottom({
        pathname: "/profile",
        windowWidth: 390,
        insets: { top: 0, left: 0, right: 0, bottom: 50 },
      }),
    ).toBe(120);
    expect(
      rootFeedbackNoticeBottom({
        pathname: "/oauth/callback",
        windowWidth: 390,
        insets: { top: 0, left: 0, right: 0, bottom: 50 },
      }),
    ).toBe(90);
    expect(
      rootFeedbackNoticeBottom({
        pathname: "/profile",
        windowWidth: 1200,
        insets: { top: 0, left: 0, right: 0, bottom: 50 },
      }),
    ).toBe(90);
  });
});
