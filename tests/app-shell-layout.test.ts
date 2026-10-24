import { describe, expect, it } from "vitest";
import { appShellLayout } from "../lib/app-shell-layout";

describe("app shell layout policy", () => {
  it.each([
    [320, 320, false, 16, 16, false],
    [360, 360, false, 16, 16, false],
    [390, 390, false, 20, 20, false],
    [768, 768, false, 20, 20, false],
    [900, 900, true, 30, 32, false],
    [1130, 1130, true, 30, 32, false],
    [1280, 1280, true, 30, 32, true],
  ])(
    "uses the expected policy at %ipx",
    (windowWidth, availableWidth, wide, gutter, headerGutter, showSidebar) => {
      expect(
        appShellLayout(windowWidth, { top: 0, left: 0, right: 0 }),
      ).toEqual({
        availableWidth,
        wide,
        gutter,
        headerGutter,
        showSidebar,
        framePadding: {
          paddingTop: 0,
          paddingLeft: 0,
          paddingRight: 0,
        },
      });
    },
  );

  it.each([
    [899, false, false],
    [900, true, false],
    [1130, true, false],
    [1131, true, true],
  ])(
    "uses inclusive wide and exclusive sidebar thresholds at %ipx",
    (width, wide, showSidebar) => {
      const layout = appShellLayout(width, { top: 0, left: 0, right: 0 });

      expect(layout.wide).toBe(wide);
      expect(layout.showSidebar).toBe(showSidebar);
    },
  );

  it("uses available width after asymmetric landscape safe areas", () => {
    expect(appShellLayout(920, { top: 24, left: 100, right: 0 })).toMatchObject(
      {
        availableWidth: 820,
        wide: false,
        gutter: 20,
        headerGutter: 20,
        showSidebar: false,
      },
    );
    expect(
      appShellLayout(1200, { top: 24, left: 18, right: 52 }),
    ).toMatchObject({
      availableWidth: 1130,
      wide: true,
      showSidebar: false,
    });
  });

  it("preserves wide safe-area padding without bottom or font controls", () => {
    const layout = appShellLayout(1280, { top: 27, left: 30, right: 24 });

    expect(layout).toMatchObject({
      availableWidth: 1226,
      wide: true,
      framePadding: {
        paddingTop: 27,
        paddingLeft: 30,
        paddingRight: 24,
      },
    });
    expect(layout.framePadding).toEqual({
      paddingTop: 27,
      paddingLeft: 30,
      paddingRight: 24,
    });
    expect(layout.framePadding).not.toHaveProperty("paddingBottom");
    expect(layout).not.toHaveProperty("fontScale");
  });

  it("normalizes invalid and negative dimensions and insets to zero", () => {
    expect(
      appShellLayout(Number.NaN, {
        top: -1,
        left: Number.POSITIVE_INFINITY,
        right: Number.NEGATIVE_INFINITY,
      }),
    ).toEqual({
      availableWidth: 0,
      wide: false,
      gutter: 16,
      headerGutter: 16,
      showSidebar: false,
      framePadding: {
        paddingTop: 0,
        paddingLeft: 0,
        paddingRight: 0,
      },
    });
    expect(
      appShellLayout(-120, { top: Number.NaN, left: -10, right: 5 }),
    ).toMatchObject({
      availableWidth: 0,
      framePadding: {
        paddingTop: 0,
        paddingLeft: 0,
        paddingRight: 5,
      },
    });
  });
});
