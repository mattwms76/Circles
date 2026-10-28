import { describe, expect, it } from "vitest";
import { controlAccessibilityProps } from "../lib/control-accessibility";
import { countLabel, countNoun } from "../lib/count-copy";
import { documentTitle, routeTitle } from "../lib/route-title";
import { isSearchShortcut, searchShortcutLabel } from "../lib/search-shortcut";
import { isPendingAccountResourceScope } from "../lib/batch3-account-resource-scope";

describe("guest membership and account-scoped pending state", () => {
  it("does not turn an absent guest scope into a permanent loading operation", () => {
    expect(isPendingAccountResourceScope(null, null)).toBe(false);
    expect(isPendingAccountResourceScope(null, "7:circle:2")).toBe(false);
    expect(isPendingAccountResourceScope("7:circle:2", null)).toBe(false);
  });

  it("only blocks the account and resource that actually own the flight", () => {
    expect(isPendingAccountResourceScope("7:circle:2", "7:circle:2")).toBe(
      true,
    );
    expect(isPendingAccountResourceScope("7:circle:2", "8:circle:2")).toBe(
      false,
    );
    expect(isPendingAccountResourceScope("7:circle:2", "7:circle:3")).toBe(
      false,
    );
  });
});

describe("web and native control semantics", () => {
  it("preserves native state and distinguishes toggle buttons from tabs", () => {
    const state = { selected: true, busy: false, disabled: false };
    const button = controlAccessibilityProps(state);
    expect(button.accessibilityState).toBe(state);
    expect(button["aria-pressed"]).toBe(true);
    expect(button["aria-selected"]).toBeUndefined();
    const tab = controlAccessibilityProps(state, "tab");
    expect(tab["aria-selected"]).toBe(true);
    expect(tab["aria-pressed"]).toBeUndefined();
    expect(tab["aria-disabled"]).toBe(false);
    expect(tab["aria-busy"]).toBe(false);
    expect(
      controlAccessibilityProps({ selected: false }, "tab")["aria-selected"],
    ).toBe(false);
  });

  it("exposes checked, busy and disabled switch state without discarding native semantics", () => {
    const state = { checked: true, busy: true, disabled: true };
    expect(controlAccessibilityProps(state, "switch")).toMatchObject({
      accessibilityState: state,
      "aria-checked": true,
      "aria-busy": true,
      "aria-disabled": true,
    });
    expect(
      controlAccessibilityProps({ selected: true }, "radio"),
    ).toMatchObject({
      accessibilityState: { selected: true, checked: true },
      "aria-checked": true,
    });
    expect(
      controlAccessibilityProps(undefined).accessibilityState,
    ).toBeUndefined();
  });
});

describe("screen titles and shared count copy", () => {
  it("formats zero, one and multiple objects consistently", () => {
    expect([0, 1, 2].map((n) => countLabel(n, "member"))).toEqual([
      "0 members",
      "1 member",
      "2 members",
    ]);
    expect(countLabel(1, "moment")).toBe("1 moment");
    expect(countNoun(1, "person", "people")).toBe("person");
    expect(countNoun(0, "person", "people")).toBe("people");
  });

  it("gives detail routes and all production destinations meaningful fallback titles", () => {
    for (const pathname of [
      "/",
      "/discover",
      "/circles",
      "/messages",
      "/profile",
      "/account/email",
      "/create",
      "/live",
      "/oauth/callback",
      "/onboarding",
      "/updates",
      "/updates/preferences",
      "/circle/2",
      "/person/2",
      "/chat/1",
      "/live/1",
      "/moderation/2",
      "/updates/1",
    ]) {
      expect(routeTitle(pathname)).not.toBe("Page not found");
      expect(documentTitle(routeTitle(pathname))).toMatch(/ · Circles$/);
    }
    expect(routeTitle("/updates/preferences/")).toBe("Update preferences");
    expect(documentTitle(" Jules Park ")).toBe("Jules Park · Circles");
    expect(documentTitle("  ")).toBe("Circles");
  });
});

describe("search shortcut", () => {
  const event = {
    key: "k",
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    defaultPrevented: false,
    editable: false,
  };
  it("supports both platform modifiers with matching shortcut labels", () => {
    expect(isSearchShortcut(event)).toBe(true);
    expect(
      isSearchShortcut({ ...event, key: "K", ctrlKey: false, metaKey: true }),
    ).toBe(true);
    expect(searchShortcutLabel("Win32")).toBe("Ctrl K");
    expect(searchShortcutLabel("MacIntel")).toBe("⌘ K");
  });
  it("leaves typing, other key combinations and previously handled events alone", () => {
    for (const change of [
      { editable: true },
      { defaultPrevented: true },
      { altKey: true },
      { shiftKey: true },
      { ctrlKey: false },
      { key: "j" },
    ]) {
      expect(isSearchShortcut({ ...event, ...change })).toBe(false);
    }
  });
});
