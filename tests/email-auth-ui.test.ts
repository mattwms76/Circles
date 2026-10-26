import { describe, expect, it, vi } from "vitest";
import {
  createEmailAuthAsyncGuard,
  resolveEmailAuthAvailability,
} from "../lib/email-auth-ui";

const componentMocks = {
  Button: () => null,
  IconButton: () => null,
  Input: () => null,
  T: () => null,
  C: {},
};

vi.mock("react-native", () => ({
  ActivityIndicator: () => null,
  KeyboardAvoidingView: () => null,
  Platform: { OS: "ios" },
  Pressable: () => null,
  ScrollView: () => null,
  View: () => null,
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
vi.mock("@/components/circles-ui", () => componentMocks);
vi.mock("@/lib/email-auth-ui", async () => import("../lib/email-auth-ui"));
vi.mock("@/lib/email-auth-client", () => ({
  connectEmailPassword: async () => undefined,
  readEmailAuthStatus: async () => ({
    enabled: true,
    ready: true,
    emailEnabled: true,
    googleEnabled: false,
    confirmationRequired: true,
  }),
  signInWithEmailPassword: async () => undefined,
  signUpWithEmailPassword: async () => undefined,
}));

const { canOfferExistingCirclesAccountConnection } =
  await import("../components/email-auth-form");

const readyStatus = {
  enabled: true,
  ready: true,
  emailEnabled: true,
  googleEnabled: false as const,
  confirmationRequired: true as const,
};

describe("email authentication UI lifecycle", () => {
  it("reports each explicit availability state without claiming Google is available", () => {
    expect(
      resolveEmailAuthAvailability({
        checking: true,
        status: null,
        failed: false,
      }),
    ).toBe("loading");
    expect(
      resolveEmailAuthAvailability({
        checking: false,
        status: null,
        failed: true,
      }),
    ).toBe("retry");
    expect(
      resolveEmailAuthAvailability({
        checking: false,
        status: { ...readyStatus, ready: false },
        failed: false,
      }),
    ).toBe("notReady");
    expect(
      resolveEmailAuthAvailability({
        checking: false,
        status: { ...readyStatus, enabled: false },
        failed: false,
      }),
    ).toBe("disabled");
    expect(
      resolveEmailAuthAvailability({
        checking: false,
        status: readyStatus,
        failed: false,
      }),
    ).toBe("available");
    expect(readyStatus.googleEnabled).toBe(false);
    expect(readyStatus.confirmationRequired).toBe(true);
  });

  it("rejects a deferred completion after a mode change and an A-to-B-to-A transition", () => {
    const guard = createEmailAuthAsyncGuard(24);
    guard.activate();
    const firstSignIn = guard.begin("signIn");
    expect(guard.isCurrent(firstSignIn, "signIn")).toBe(true);

    guard.invalidate();
    const connect = guard.begin("connect");
    expect(guard.isCurrent(firstSignIn, "signIn")).toBe(false);
    expect(guard.isCurrent(connect, "connect")).toBe(true);

    guard.invalidate();
    const secondSignIn = guard.begin("signIn");
    expect(guard.isCurrent(firstSignIn, "signIn")).toBe(false);
    expect(guard.isCurrent(secondSignIn, "signIn")).toBe(true);
  });

  it("drops pending work during strict-mode-style cleanup and lets the next activation own a new request", () => {
    const guard = createEmailAuthAsyncGuard(39);
    guard.activate();
    const first = guard.begin("signIn");
    guard.deactivate();
    expect(guard.isCurrent(first, "signIn")).toBe(false);

    guard.activate();
    const second = guard.begin("signIn");
    expect(guard.isCurrent(first, "signIn")).toBe(false);
    expect(guard.isCurrent(second, "signIn")).toBe(true);
  });

  it("clears only the matching completion so a late first request cannot clear a newer flight", () => {
    const guard = createEmailAuthAsyncGuard(62);
    guard.activate();
    const first = guard.begin("signIn");
    const second = guard.begin("signIn");

    guard.clear(first);
    expect(guard.isCurrent(second, "signIn")).toBe(true);
    guard.clear(second);
    expect(guard.isCurrent(second, "signIn")).toBe(false);
  });

  it("offers existing-account proof only as a migration entry from idle ordinary email sign-in", () => {
    const connectExisting = () => undefined;

    expect(
      canOfferExistingCirclesAccountConnection(
        "signIn",
        "signIn",
        connectExisting,
      ),
    ).toBe(true);
    expect(
      canOfferExistingCirclesAccountConnection(
        "signIn",
        "signUp",
        connectExisting,
      ),
    ).toBe(false);
    expect(
      canOfferExistingCirclesAccountConnection(
        "connect",
        "signIn",
        connectExisting,
      ),
    ).toBe(false);
    expect(
      canOfferExistingCirclesAccountConnection("signIn", "signIn", undefined),
    ).toBe(false);
  });
});
