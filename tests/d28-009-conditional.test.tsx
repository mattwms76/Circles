import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type ElementProps = Record<string, unknown> & { children?: ReactNode };

type AuthState = "checking" | "error" | "authenticated" | "unauthenticated";

const fixture = vi.hoisted(() => ({
  authState: "checking" as AuthState,
  completeNativeLogin: vi.fn(),
  refresh: vi.fn(),
  router: {
    back: vi.fn(),
    canGoBack: vi.fn(() => true),
    replace: vi.fn(),
  },
  user: null as { id: number } | null,
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();

  return {
    ...actual,
    useCallback: <T,>(callback: T) => callback,
    useState: <T,>(initialValue: T | (() => T)) => [
      typeof initialValue === "function"
        ? (initialValue as () => T)()
        : initialValue,
      vi.fn(),
    ],
  };
});

vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  ScrollView: "ScrollView",
  View: "View",
}));
vi.mock("expo-router", () => ({
  useRouter: () => fixture.router,
}));
vi.mock("@/components/app-shell", () => ({ AppShell: "AppShell" }));
vi.mock("@/components/circles-ui", () => ({
  Button: "Button",
  C: { coral: "#ED604A", muted: "#4D5948", secondary: "#4D5948" },
  T: "T",
}));
vi.mock("@/components/email-auth-form", () => ({
  EmailAuthForm: "EmailAuthForm",
}));
vi.mock("@/constants/oauth", () => ({ startOAuthLogin: vi.fn() }));
vi.mock("@/hooks/circles-context", () => ({
  useCircles: () => ({
    authState: fixture.authState,
    completeNativeLogin: fixture.completeNativeLogin,
    refresh: fixture.refresh,
    user: fixture.user,
  }),
}));
vi.mock("../lib/a26-auth-operation", () => ({
  completeCurrentAuthOperation: vi.fn(),
}));

const { default: AccountEmailScreen } = await import("../app/account/email");

function findElements(
  node: ReactNode,
  type: unknown,
): ReactElement<ElementProps>[] {
  const found: ReactElement<ElementProps>[] = [];

  const visit = (value: ReactNode) => {
    if (!isValidElement<ElementProps>(value)) return;
    if (value.type === type) found.push(value);
    Children.forEach(value.props.children, visit);
  };

  visit(node);
  return found;
}

function findOnly(node: ReactNode, type: unknown): ReactElement<ElementProps> {
  const matches = findElements(node, type);
  expect(matches).toHaveLength(1);
  const [match] = matches;
  if (!match) throw new Error("Expected exactly one matching element.");
  return match;
}

function renderGuard(authState: Exclude<AuthState, "authenticated">) {
  fixture.authState = authState;
  fixture.user = null;
  return AccountEmailScreen() as ReactElement<ElementProps>;
}

function expectBoundedGuardScroll(tree: ReactNode) {
  const shell = findOnly(tree, "AppShell");
  expect(shell.props).toMatchObject({ scroll: false, sidebar: false });

  const scroll = findOnly(tree, "ScrollView");
  expect(scroll.props).toMatchObject({
    showsHorizontalScrollIndicator: false,
    showsVerticalScrollIndicator: false,
    style: { flex: 1, width: "100%" },
    contentContainerStyle: {
      flexGrow: 1,
      justifyContent: "center",
      padding: 24,
    },
  });

  return scroll;
}

beforeEach(() => {
  fixture.completeNativeLogin.mockReset();
  fixture.refresh.mockReset();
  fixture.router.back.mockReset();
  fixture.router.canGoBack.mockReset().mockReturnValue(true);
  fixture.router.replace.mockReset();
});

describe("D28-009 account email guard overflow containment", () => {
  it("gives checking feedback a bounded, centered local recovery scroller", () => {
    const scroll = expectBoundedGuardScroll(renderGuard("checking"));
    const content = findOnly(scroll, "View");

    expect(content.props).toMatchObject({
      accessibilityLiveRegion: "polite",
      style: { alignItems: "center", gap: 12 },
    });
    expect(findOnly(scroll, "ActivityIndicator")).toBeDefined();
  });

  it("keeps the auth-error Retry and Back controls reachable in the local scroller", () => {
    const scroll = expectBoundedGuardScroll(renderGuard("error"));
    const titles = findElements(scroll, "Button").map(
      (button) => button.props.title,
    );

    expect(titles).toEqual(["Try again", "Back to profile"]);
  });

  it("keeps unauthenticated proof and Back controls reachable in the local scroller", () => {
    const scroll = expectBoundedGuardScroll(renderGuard("unauthenticated"));
    const titles = findElements(scroll, "Button").map(
      (button) => button.props.title,
    );

    expect(titles).toEqual([
      "Verify existing Circles account",
      "Back to profile",
    ]);
  });

  it("leaves the authenticated EmailAuthForm as the separate form-owned scroller", () => {
    fixture.authState = "authenticated";
    fixture.user = { id: 41 };
    const tree = AccountEmailScreen() as ReactElement<ElementProps>;

    expect(findElements(tree, "ScrollView")).toHaveLength(0);
    expect(findOnly(tree, "EmailAuthForm").props).toMatchObject({
      mode: "connect",
      onAuthenticated: expect.any(Function),
      onClose: expect.any(Function),
    });
  });
});
