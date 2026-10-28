import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { openD28LiveLeaveDialog } from "../lib/d28-019-live-leave-dialog";

const liveScreenSource = readFileSync(
  new URL("../app/live/[id].tsx", import.meta.url),
  "utf8",
);

describe("D28-019 live leave confirmation keyboard dismissal", () => {
  it("dismisses the chat keyboard before opening the current host confirmation", () => {
    const events: string[] = [];
    const dismissKeyboard = vi.fn(() => events.push("dismiss"));
    const openConfirmation = vi.fn(() => events.push("open"));

    expect(
      openD28LiveLeaveDialog({
        isCurrentHost: true,
        dismissKeyboard,
        openConfirmation,
      }),
    ).toBe(true);
    expect(events).toEqual(["dismiss", "open"]);
    expect(dismissKeyboard).toHaveBeenCalledOnce();
    expect(openConfirmation).toHaveBeenCalledOnce();
  });

  it("does not dismiss or open when the caller is no longer the current host", () => {
    const dismissKeyboard = vi.fn();
    const openConfirmation = vi.fn();

    expect(
      openD28LiveLeaveDialog({
        isCurrentHost: false,
        dismissKeyboard,
        openConfirmation,
      }),
    ).toBe(false);
    expect(dismissKeyboard).not.toHaveBeenCalled();
    expect(openConfirmation).not.toHaveBeenCalled();
  });

  it("uses the guarded keyboard-aware opener for both authorized host controls", () => {
    expect(liveScreenSource).toContain("openD28LiveLeaveDialog");
    expect(liveScreenSource).toContain("dismissKeyboard: Keyboard.dismiss");
    expect(liveScreenSource).toMatch(/host\s*\? openEndConfirmation\(\)/);
    expect(liveScreenSource).toContain("onPress={openEndConfirmation}");
  });
});
