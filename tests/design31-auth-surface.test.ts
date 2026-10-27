import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type HookEffect = () => void | (() => void);
type RefBox = { current: unknown };
type ElementProps = Record<string, unknown> & { children?: ReactNode };
type FocusRef = { current: { focus: () => void } | null };

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

const hookStore = vi.hoisted(() => ({
  effects: [] as HookEffect[],
  initialOverrides: {} as Record<number, unknown>,
  refCursor: 0,
  refValues: [] as RefBox[],
  stateCursor: 0,
  stateValues: [] as unknown[],
}));

const mocks = vi.hoisted(() => ({
  auth: {
    data: null as { id: number; name: string | null } | null,
    isError: false,
    isLoading: false,
    refetch: vi.fn(),
  },
  completeNativeLoginTransition: vi.fn(),
  confirmNativeLoginAfterEmailAuthDrain: vi.fn(),
  pathname: "/",
  readEmailAuthStatus: vi.fn(),
  router: { push: vi.fn() },
  signInWithEmailPassword: vi.fn(),
  signUpWithEmailPassword: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();

  return {
    ...actual,
    useCallback: <T>(callback: T) => callback,
    useEffect: (effect: HookEffect) => {
      hookStore.effects.push(effect);
    },
    useLayoutEffect: (effect: HookEffect) => {
      hookStore.effects.push(effect);
    },
    useRef: <T>(initialValue: T) => {
      const index = hookStore.refCursor++;
      if (!(index in hookStore.refValues)) {
        hookStore.refValues[index] = { current: initialValue };
      }
      return hookStore.refValues[index] as { current: T };
    },
    useState: <T>(initialValue: T | (() => T)) => {
      const index = hookStore.stateCursor++;
      if (!(index in hookStore.stateValues)) {
        hookStore.stateValues[index] = Object.hasOwn(
          hookStore.initialOverrides,
          index,
        )
          ? hookStore.initialOverrides[index]
          : typeof initialValue === "function"
            ? (initialValue as () => T)()
            : initialValue;
      }
      const setState = (nextValue: T | ((previousValue: T) => T)) => {
        const previousValue = hookStore.stateValues[index] as T;
        hookStore.stateValues[index] =
          typeof nextValue === "function"
            ? (nextValue as (previousValue: T) => T)(previousValue)
            : nextValue;
      };
      return [hookStore.stateValues[index] as T, setState] as const;
    },
  };
});

vi.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  KeyboardAvoidingView: "KeyboardAvoidingView",
  Modal: "Modal",
  Platform: { OS: "ios" },
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  View: "View",
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ bottom: 0, top: 0 }),
}));
vi.mock("@/components/circles-ui", () => ({
  Button: "Button",
  C: {
    action: "#A53728",
    border: "#D0D3C8",
    coral: "#ED604A",
    muted: "#4D5948",
    paper: "#FFFFFF",
    sage: "#E9EEE5",
    secondary: "#4D5948",
    soft: "#FFF0EB",
  },
  IconButton: "IconButton",
  Input: "Input",
  Logo: "Logo",
  T: "T",
}));
vi.mock("@/components/status-message", () => ({
  StatusMessage: "StatusMessage",
}));
vi.mock("../components/status-message", () => ({
  StatusMessage: "StatusMessage",
}));
vi.mock(
  "@/components/email-auth-form",
  async () => import("../components/email-auth-form"),
);
vi.mock("@/lib/email-auth-ui", async () => import("../lib/email-auth-ui"));
vi.mock("expo-router", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => mocks.router,
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    auth: { me: { useQuery: () => mocks.auth } },
    useUtils: () => ({ auth: { me: { invalidate: vi.fn() } } }),
  },
}));
vi.mock("@/lib/_core/api", () => ({ logout: vi.fn() }));
vi.mock("@/lib/_core/auth", () => ({
  clearUserInfo: vi.fn(),
  getSessionToken: vi.fn(),
  removeSessionToken: vi.fn(),
}));
vi.mock("@/lib/client-session", () => ({
  logoutAndPurgeClientSession: vi.fn(),
}));
vi.mock("@/lib/email-auth-client", () => ({
  cancelAndDrainEmailAuthRequests: vi.fn(),
  connectEmailPassword: vi.fn(),
  readEmailAuthStatus: mocks.readEmailAuthStatus,
  signInWithEmailPassword: mocks.signInWithEmailPassword,
  signUpWithEmailPassword: mocks.signUpWithEmailPassword,
}));
vi.mock("@/lib/media-cache", () => ({ clearPrivateImageCaches: vi.fn() }));
vi.mock("@/hooks/native-login-transition", () => ({
  clearCapturedNativeCredentialsIfCurrent: vi.fn(),
  completeNativeLoginTransition: mocks.completeNativeLoginTransition,
  confirmNativeLoginAfterEmailAuthDrain:
    mocks.confirmNativeLoginAfterEmailAuthDrain,
  logoutNativeSessionAfterEmailAuthDrain: vi.fn(),
}));
vi.mock("@/lib/feed-ui-helpers", () => ({
  resolveAuthGateState: () => "guest",
}));

const { EmailAuthForm } = await import("../components/email-auth-form");
const { CirclesProvider } = await import("../hooks/circles-context");
const STATUS_MESSAGE = "StatusMessage";

const readyStatus = {
  confirmationRequired: true as const,
  emailEnabled: true,
  enabled: true,
  googleEnabled: false as const,
  ready: true,
};

function resetHooks(initialOverrides: Record<number, unknown> = {}) {
  hookStore.effects.length = 0;
  hookStore.initialOverrides = initialOverrides;
  hookStore.refCursor = 0;
  hookStore.refValues.length = 0;
  hookStore.stateCursor = 0;
  hookStore.stateValues.length = 0;
}

function resetRenderCursors() {
  hookStore.effects.length = 0;
  hookStore.refCursor = 0;
  hookStore.stateCursor = 0;
}

function invokeFunctionElement(element: ReactElement<ElementProps>): ReactNode {
  if (typeof element.type !== "function") {
    throw new Error("Expected a function component element.");
  }
  const component = element.type as (props: ElementProps) => ReactNode;
  return component(element.props);
}

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
  if (!match) throw new Error("Expected one matching element.");
  return match;
}

function findInput(node: ReactNode, label: string): ReactElement<ElementProps> {
  const input = findElements(node, "Input").find(
    (element) => element.props.accessibilityLabel === label,
  );
  if (!input) throw new Error(`Expected ${label} input.`);
  return input;
}

function invokeWithoutArguments(value: unknown) {
  if (typeof value !== "function") throw new Error("Expected a callback.");
  value();
}

function invokeWithText(value: unknown, nextValue: string) {
  if (typeof value !== "function") throw new Error("Expected a text callback.");
  value(nextValue);
}

function isFocusRef(value: unknown): value is FocusRef {
  return typeof value === "object" && value !== null && "current" in value;
}

function isRequestOptions(
  value: unknown,
): value is { signal: AbortSignal; isCurrent: () => boolean } {
  return (
    typeof value === "object" &&
    value !== null &&
    "signal" in value &&
    "isCurrent" in value
  );
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function renderAuthForm({
  initialOverrides,
  onAuthenticated = vi.fn(async () => true),
  onClose = vi.fn(),
  presentation = "standalone",
  preserveState = false,
}: {
  initialOverrides?: Record<number, unknown>;
  onAuthenticated?: () => Promise<boolean>;
  onClose?: () => void;
  presentation?: "embedded" | "standalone";
  preserveState?: boolean;
} = {}) {
  if (!preserveState) {
    resetHooks({ 6: false, 7: readyStatus, ...initialOverrides });
  } else {
    resetRenderCursors();
  }

  const dialog = invokeFunctionElement(
    EmailAuthForm({
      mode: "signIn",
      onAuthenticated,
      onClose,
      presentation,
    }) as ReactElement<ElementProps>,
  ) as ReactElement<ElementProps>;

  return {
    onAuthenticated,
    onClose,
    tree: invokeFunctionElement(dialog),
  };
}

beforeEach(() => {
  mocks.auth.data = null;
  mocks.auth.isError = false;
  mocks.auth.isLoading = false;
  mocks.completeNativeLoginTransition.mockReset();
  mocks.confirmNativeLoginAfterEmailAuthDrain.mockReset();
  mocks.pathname = "/";
  mocks.readEmailAuthStatus.mockReset().mockResolvedValue(readyStatus);
  mocks.router.push.mockReset();
  mocks.signInWithEmailPassword.mockReset().mockResolvedValue(undefined);
  mocks.signUpWithEmailPassword.mockReset().mockResolvedValue(undefined);
});

describe("D26 auth-surface composition and keyboard behavior", () => {
  it("gives the guest provider one compact keyboard-safe dialog frame and close owner", () => {
    resetHooks({
      0: true,
      1: { message: "Please try again.", tone: "error" },
    });

    const tree = CirclesProvider({
      children: null,
      queryClient: {} as never,
      resetProtectedNavigation: vi.fn(),
    }) as ReactElement<ElementProps>;

    const modal = findOnly(tree, "Modal");
    expect(modal.props.visible).toBe(true);
    expect(findElements(tree, "KeyboardAvoidingView")).toHaveLength(1);
    const scroll = findOnly(tree, "ScrollView");
    expect(scroll.props).toMatchObject({
      automaticallyAdjustKeyboardInsets: true,
      keyboardDismissMode: "interactive",
      keyboardShouldPersistTaps: "handled",
    });
    expect(scroll.props.contentContainerStyle).toMatchObject({
      paddingBottom: 16,
      paddingHorizontal: 16,
      paddingTop: 16,
    });

    const paperCard = findElements(tree, "View").find(
      (element) =>
        typeof element.props.style === "object" &&
        element.props.style !== null &&
        "backgroundColor" in element.props.style &&
        element.props.style.backgroundColor === "#FFFFFF",
    );
    expect(paperCard?.props.style).toMatchObject({
      maxWidth: 440,
      padding: 20,
      width: "100%",
    });
    const framePadding = 16;
    const cardPadding = 20;
    expect(320 - framePadding * 2 - cardPadding * 2).toBe(248);

    const guestClose = findOnly(tree, "IconButton");
    expect(guestClose.props.label).toBe("Close sign in");
    invokeWithoutArguments(guestClose.props.onPress);
    expect(hookStore.stateValues[0]).toBe(false);

    const embeddedForm = findOnly(tree, EmailAuthForm);
    expect(embeddedForm.props.presentation).toBe("embedded");
    const notice = findOnly(tree, STATUS_MESSAGE);
    expect(notice.props).toMatchObject({
      message: "Please try again.",
      tone: "error",
    });
  });

  it("suppresses the root status on the callback route where recovery remains local", () => {
    mocks.pathname = "/oauth/callback";
    resetHooks({
      0: true,
      1: { message: "Please try again.", tone: "error" },
    });

    const tree = CirclesProvider({
      children: null,
      queryClient: {} as never,
      resetProtectedNavigation: vi.fn(),
    }) as ReactElement<ElementProps>;

    expect(findElements(tree, STATUS_MESSAGE)).toHaveLength(0);
  });

  it("keeps the standalone frame and close, but embeds form content without a second frame or close", () => {
    const standalone = renderAuthForm({ presentation: "standalone" }).tree;
    expect(findElements(standalone, "KeyboardAvoidingView")).toHaveLength(1);
    expect(findElements(standalone, "ScrollView")).toHaveLength(1);
    expect(findOnly(standalone, "IconButton").props.label).toBe(
      "Close email sign-in",
    );

    const embedded = renderAuthForm({ presentation: "embedded" }).tree;
    expect(findElements(embedded, "KeyboardAvoidingView")).toHaveLength(0);
    expect(findElements(embedded, "ScrollView")).toHaveLength(0);
    expect(findElements(embedded, "IconButton")).toHaveLength(0);
    expect(
      findElements(embedded, "View").some(
        (element) =>
          typeof element.props.style === "object" &&
          element.props.style !== null &&
          "backgroundColor" in element.props.style,
      ),
    ).toBe(false);
  });

  it("uses one shared assertive status for a form error without a duplicate inline alert", () => {
    const tree = renderAuthForm({
      initialOverrides: { 10: "Enter your email address and password." },
    }).tree;

    expect(findOnly(tree, STATUS_MESSAGE).props).toMatchObject({
      message: "Enter your email address and password.",
      tone: "error",
    });
    expect(
      findElements(tree, "T").filter(
        (element) => element.props.accessibilityRole === "alert",
      ),
    ).toHaveLength(0);
  });

  it("focuses the typed password input from Next while retaining Done as the submit action", () => {
    const tree = renderAuthForm({ presentation: "standalone" }).tree;
    const email = findInput(tree, "Email address");
    const password = findInput(tree, "Password");
    const focus = vi.fn();

    expect(email.props.returnKeyType).toBe("next");
    expect(password.props.returnKeyType).toBe("done");
    expect(isFocusRef(password.props.ref)).toBe(true);
    if (!isFocusRef(password.props.ref))
      throw new Error("Expected password ref.");
    password.props.ref.current = { focus };

    invokeWithoutArguments(email.props.onSubmitEditing);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(typeof password.props.onSubmitEditing).toBe("function");
  });

  it("submits once from password Done for the active dialog scope", async () => {
    const onAuthenticated = vi.fn(async () => true);
    let tree = renderAuthForm({ onAuthenticated }).tree;
    const activateGuards = hookStore.effects[0];
    if (!activateGuards)
      throw new Error("Expected auth guard activation effect.");
    activateGuards();

    invokeWithText(
      findInput(tree, "Email address").props.onChangeText,
      "ari@example.test",
    );
    invokeWithText(
      findInput(tree, "Password").props.onChangeText,
      "not-retained",
    );

    tree = renderAuthForm({ onAuthenticated, preserveState: true }).tree;
    invokeWithoutArguments(findInput(tree, "Password").props.onSubmitEditing);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(mocks.signInWithEmailPassword).toHaveBeenCalledTimes(1);
    expect(onAuthenticated).toHaveBeenCalledTimes(1);
  });

  it("cancels and clears a stale password submission before its late completion can authenticate", async () => {
    const signIn = createDeferred<void>();
    const onAuthenticated = vi.fn(async () => true);
    const onClose = vi.fn();
    mocks.signInWithEmailPassword.mockReturnValueOnce(signIn.promise);

    let tree = renderAuthForm({ onAuthenticated, onClose }).tree;
    const activateGuards = hookStore.effects[0];
    if (!activateGuards)
      throw new Error("Expected auth guard activation effect.");
    activateGuards();

    invokeWithText(
      findInput(tree, "Email address").props.onChangeText,
      "ari@example.test",
    );
    invokeWithText(
      findInput(tree, "Password").props.onChangeText,
      "not-retained",
    );

    tree = renderAuthForm({
      onAuthenticated,
      onClose,
      preserveState: true,
    }).tree;
    invokeWithoutArguments(findInput(tree, "Password").props.onSubmitEditing);
    expect(mocks.signInWithEmailPassword).toHaveBeenCalledWith(
      "ari@example.test",
      "not-retained",
      expect.any(Object),
    );

    const requestOptions = mocks.signInWithEmailPassword.mock.calls[0]?.[2];
    expect(isRequestOptions(requestOptions)).toBe(true);
    if (!isRequestOptions(requestOptions)) {
      throw new Error("Expected cancellable sign-in request options.");
    }

    invokeWithoutArguments(findOnly(tree, "IconButton").props.onPress);
    expect(requestOptions.signal.aborted).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(hookStore.stateValues[4]).toBe("");

    signIn.resolve(undefined);
    await signIn.promise;
    await Promise.resolve();
    expect(onAuthenticated).not.toHaveBeenCalled();
  });
});
