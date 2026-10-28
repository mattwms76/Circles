import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

type HookInstance = {
  states: unknown[];
  effects: (() => void | (() => void))[];
  cleanups: (() => void)[];
  stateIndex: number;
  effectIndex: number;
};

const control = vi.hoisted(() => ({
  instance: null as HookInstance | null,
  platform: "ios",
  nativeState: "active" as string | null,
  nativeListeners: new Set<(state: string) => void>(),
}));

vi.mock("react", () => ({
  useState(initial: unknown) {
    const instance = control.instance!;
    const index = instance.stateIndex++;
    if (!(index in instance.states)) {
      instance.states[index] =
        typeof initial === "function" ? initial() : initial;
    }
    return [
      instance.states[index],
      (value: unknown) => {
        instance.states[index] =
          typeof value === "function" ? value(instance.states[index]) : value;
      },
    ];
  },
  useEffect(effect: () => void | (() => void)) {
    const instance = control.instance!;
    const index = instance.effectIndex++;
    instance.effects[index] ??= effect;
  },
}));

vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return control.platform;
    },
  },
  AppState: {
    get currentState() {
      return control.nativeState;
    },
    addEventListener(_event: string, listener: (state: string) => void) {
      control.nativeListeners.add(listener);
      return { remove: () => control.nativeListeners.delete(listener) };
    },
  },
}));

const { useForegroundState } = await import("../hooks/use-foreground-state");

function ForegroundProbe() {
  return useForegroundState();
}

function render(instance: HookInstance) {
  control.instance = instance;
  instance.stateIndex = 0;
  instance.effectIndex = 0;
  try {
    return ForegroundProbe();
  } finally {
    control.instance = null;
  }
}

const mounted: HookInstance[] = [];
function mount() {
  const instance: HookInstance = {
    states: [],
    effects: [],
    cleanups: [],
    stateIndex: 0,
    effectIndex: 0,
  };
  render(instance);
  for (const effect of instance.effects) {
    const cleanup = effect();
    if (cleanup) instance.cleanups.push(cleanup);
  }
  mounted.push(instance);
  return instance;
}
function unmount(instance: HookInstance) {
  for (const cleanup of instance.cleanups.splice(0)) cleanup();
}
function eventTarget() {
  const listeners = new Map<string, Set<() => void>>();
  return {
    listeners,
    addEventListener(event: string, listener: () => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
    },
    removeEventListener(event: string, listener: () => void) {
      listeners.get(event)?.delete(listener);
    },
    emit(event: string) {
      for (const listener of listeners.get(event) ?? []) listener();
    },
  };
}

afterEach(() => {
  for (const instance of mounted.splice(0)) unmount(instance);
  control.nativeListeners.clear();
  control.nativeState = "active";
  control.platform = "ios";
  vi.unstubAllGlobals();
});

describe("foreground hook logic with mocked React/native/DOM lifecycle", () => {
  it("treats unknown native state as background, follows changes and removes its listener", () => {
    control.nativeState = null;
    const instance = mount();
    expect(render(instance)).toBe(false);
    for (const listener of control.nativeListeners) listener("active");
    expect(render(instance)).toBe(true);
    for (const listener of control.nativeListeners) listener("inactive");
    expect(render(instance)).toBe(false);
    unmount(instance);
    expect(control.nativeListeners.size).toBe(0);
  });

  it("requires web visibility and focus and removes every DOM listener", () => {
    control.platform = "web";
    const doc = {
      ...eventTarget(),
      visibilityState: "visible",
      hasFocus: () => focused,
    };
    const win = eventTarget();
    let focused = true;
    vi.stubGlobal("document", doc);
    vi.stubGlobal("window", win);
    const instance = mount();
    expect(render(instance)).toBe(true);
    expect(control.nativeListeners.size).toBe(0);
    focused = false;
    win.emit("blur");
    expect(render(instance)).toBe(false);
    focused = true;
    win.emit("focus");
    expect(render(instance)).toBe(true);
    doc.visibilityState = "hidden";
    doc.emit("visibilitychange");
    expect(render(instance)).toBe(false);
    doc.visibilityState = "visible";
    doc.emit("visibilitychange");
    expect(render(instance)).toBe(true);
    unmount(instance);
    expect(
      [...doc.listeners.values()].every((listeners) => listeners.size === 0),
    ).toBe(true);
    expect(
      [...win.listeners.values()].every((listeners) => listeners.size === 0),
    ).toBe(true);
  });

  it("preserves visible-web fallback without hasFocus and document-less rendering", () => {
    control.platform = "web";
    vi.stubGlobal("document", { ...eventTarget(), visibilityState: "visible" });
    vi.stubGlobal("window", eventTarget());
    const visible = mount();
    expect(render(visible)).toBe(true);
    unmount(visible);
    vi.stubGlobal("document", undefined);
    vi.stubGlobal("window", undefined);
    expect(render(mount())).toBe(true);
    expect(control.nativeListeners.size).toBe(0);
  });

  it("keeps separate consumers' state and subscriptions independent", () => {
    const first = mount();
    const second = mount();
    expect(control.nativeListeners.size).toBe(2);
    expect(render(first)).toBe(true);
    expect(render(second)).toBe(true);
    unmount(first);
    expect(control.nativeListeners.size).toBe(1);
    for (const listener of control.nativeListeners) listener("background");
    expect(first.states[0]).toBe(true);
    expect(render(second)).toBe(false);
    unmount(second);
    expect(control.nativeListeners.size).toBe(0);
  });

  it("uses the shared hook in both consumers without duplicate local implementations (source contract)", () => {
    for (const path of [
      "components/source-revalidation.tsx",
      "hooks/live-avatar-context.tsx",
    ]) {
      const source = readFileSync(path, "utf8");
      expect(source).toContain('from "@/hooks/use-foreground-state"');
      expect(source).toContain("const foreground = useForegroundState()");
      expect(source).not.toContain("function readWebForeground");
      expect(source).not.toContain("function useForegroundState");
      expect(source).not.toContain("function useLiveAvatarForeground");
    }
  });
});
