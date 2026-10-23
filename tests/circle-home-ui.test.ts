import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  boundCircleHomeText,
  circleHomeTextLength,
  type CircleHome,
} from "../shared/circle-home";
import {
  boundCircleHomeRulesText,
  canReadCircleHome,
  CIRCLE_HOME_RULES_TEXT_MAX,
  circleHomeRulesFromText,
  circleHomeRulesToText,
  circleHomeScopeKey,
  getCircleHomeRuleMetrics,
  isCurrentCircleHomeResponse,
  isCurrentCircleHomeScope,
  resolveCircleHomeUiState,
  serializeCircleHomeDraft,
  validateCircleHomeDraft,
} from "../lib/circle-home-ui";

const home: CircleHome = {
  circleId: 42,
  viewerId: 7,
  welcomeMessage: "A note from the owner.",
  rules: ["Be kind."],
  pinnedPost: null,
  canManage: true,
  updatedAt: "2026-10-23T00:00:00.000Z",
};

describe("Circle Home UI safety contracts", () => {
  it("renders a response only for the exact active circle and account", () => {
    expect(
      isCurrentCircleHomeResponse(home, { circleId: 42, viewerId: 7 }),
    ).toBe(true);
    expect(
      isCurrentCircleHomeResponse(home, { circleId: 41, viewerId: 7 }),
    ).toBe(false);
    expect(
      isCurrentCircleHomeResponse(home, { circleId: 42, viewerId: null }),
    ).toBe(false);
  });

  it("keeps private Home unavailable to pending members and outsiders", () => {
    expect(
      canReadCircleHome({ privacy: "private", joined: true, role: "pending" }),
    ).toBe(false);
    expect(
      canReadCircleHome({ privacy: "private", joined: false, role: "member" }),
    ).toBe(false);
    expect(
      canReadCircleHome({ privacy: "private", joined: true, role: "member" }),
    ).toBe(true);
    expect(
      canReadCircleHome({ privacy: "public", joined: false, role: null }),
    ).toBe(true);
  });

  it("formats only intentional non-empty rules and bounds editable rule input", () => {
    expect(
      circleHomeRulesFromText("  Be kind.\r\n\n Respect privacy. "),
    ).toEqual(["Be kind.", "Respect privacy."]);
    expect(circleHomeRulesToText([" Be kind. ", "", "Respect privacy."])).toBe(
      "Be kind.\nRespect privacy.",
    );

    const bounded = boundCircleHomeRulesText(
      Array.from({ length: 12 }, (_, index) => `${index}`.repeat(350)).join(
        "\n",
      ),
    );
    const metrics = getCircleHomeRuleMetrics(bounded);
    expect(metrics.ruleCount).toBe(10);
    expect(metrics.longestRuleLength).toBe(300);
  });

  it("validates raw draft limits without inventing required Home content", () => {
    expect(
      validateCircleHomeDraft({ welcomeMessage: "", rulesText: "\n\n" }),
    ).toBeUndefined();
    expect(
      validateCircleHomeDraft({
        welcomeMessage: "x".repeat(2_001),
        rulesText: "",
      }),
    ).toMatch(/2,000/);
    expect(
      validateCircleHomeDraft({
        welcomeMessage: "",
        rulesText: "x".repeat(301),
      }),
    ).toMatch(/300/);
    expect(
      validateCircleHomeDraft({
        welcomeMessage: "",
        rulesText: Array.from(
          { length: 11 },
          (_, index) => `Rule ${index}`,
        ).join("\n"),
      }),
    ).toMatch(/10/);
    expect(
      validateCircleHomeDraft({
        welcomeMessage: "",
        rulesText: "Be kind.\nbe KIND.",
      }),
    ).toMatch(/unique/i);
    expect(
      serializeCircleHomeDraft({
        welcomeMessage: " A real welcome. ",
        rulesText: "  Rule one.\rRule two.\r\n Rule three. ",
      }),
    ).toEqual({
      welcomeMessage: "A real welcome.",
      rules: ["Rule one.", "Rule two.", "Rule three."],
    });
    expect(
      serializeCircleHomeDraft({
        welcomeMessage: "",
        rulesText: "First\rSecond\nThird",
      }).rules.every((rule) => !/[\r\n]/.test(rule)),
    ).toBe(true);
  });

  it("uses Unicode code points for astral welcome and rule boundaries", () => {
    const astral = "😀";
    const maxWelcome = astral.repeat(2_000);
    const overWelcome = astral.repeat(2_001);
    const maxRule = astral.repeat(300);
    const overRule = astral.repeat(301);

    expect(circleHomeTextLength(maxWelcome)).toBe(2_000);
    expect(maxWelcome.length).toBe(4_000);
    expect(
      validateCircleHomeDraft({ welcomeMessage: maxWelcome, rulesText: "" }),
    ).toBeUndefined();
    expect(
      validateCircleHomeDraft({ welcomeMessage: overWelcome, rulesText: "" }),
    ).toMatch(/2,000/);
    expect(
      validateCircleHomeDraft({ welcomeMessage: "", rulesText: maxRule }),
    ).toBeUndefined();
    expect(
      validateCircleHomeDraft({ welcomeMessage: "", rulesText: overRule }),
    ).toMatch(/300/);
    expect(circleHomeTextLength(boundCircleHomeText(overWelcome, 2_000))).toBe(
      2_000,
    );

    const boundedRules = boundCircleHomeRulesText(overRule);
    expect(getCircleHomeRuleMetrics(boundedRules)).toEqual({
      ruleCount: 1,
      longestRuleLength: 300,
    });
    expect(boundedRules.endsWith("\ud83d")).toBe(false);
    expect(
      circleHomeTextLength(boundCircleHomeRulesText(`${maxRule}\n`.repeat(10))),
    ).toBe(CIRCLE_HOME_RULES_TEXT_MAX);
  });

  it("renders only a fresh matching response and disables actions during refresh or failure", () => {
    const scope = { circleId: 42, viewerId: 7 };
    const fresh = resolveCircleHomeUiState({
      home,
      scope,
      homeQueryEnabled: true,
      isError: false,
      isFetchedAfterMount: true,
      isFetching: false,
    });
    expect(fresh.home).toBe(home);
    expect(fresh.isAuthorityAvailable).toBe(true);
    expect(fresh.canEdit).toBe(true);

    const preMountCache = resolveCircleHomeUiState({
      home,
      scope,
      homeQueryEnabled: true,
      isError: false,
      isFetchedAfterMount: false,
      isFetching: true,
    });
    expect(preMountCache).toMatchObject({
      home: undefined,
      isLoading: true,
      isError: false,
      isAuthorityAvailable: false,
      canEdit: false,
    });

    const refreshing = resolveCircleHomeUiState({
      home,
      scope,
      homeQueryEnabled: true,
      isError: false,
      isFetchedAfterMount: true,
      isFetching: true,
    });
    expect(refreshing.home).toBe(home);
    expect(refreshing.isAuthorityAvailable).toBe(false);
    expect(refreshing.canEdit).toBe(false);

    const freshFailureWithCache = resolveCircleHomeUiState({
      home,
      scope,
      homeQueryEnabled: true,
      isError: true,
      isFetchedAfterMount: true,
      isFetching: false,
    });
    expect(freshFailureWithCache).toMatchObject({
      home: undefined,
      isLoading: false,
      isError: true,
      isAuthorityAvailable: false,
      canEdit: false,
    });

    const foreignResult = { ...home, viewerId: 8 };
    expect(
      resolveCircleHomeUiState({
        home: foreignResult,
        scope,
        homeQueryEnabled: true,
        isError: false,
        isFetchedAfterMount: true,
        isFetching: false,
      }),
    ).toMatchObject({ home: undefined, isError: true, isLoading: false });
    expect(
      resolveCircleHomeUiState({
        home: foreignResult,
        scope,
        homeQueryEnabled: true,
        isError: false,
        isFetchedAfterMount: true,
        isFetching: true,
      }),
    ).toMatchObject({ home: undefined, isError: false, isLoading: true });
  });

  it("rejects stale completions after an account or route scope changes", () => {
    const firstScope = circleHomeScopeKey({ circleId: 42, viewerId: 7 });
    expect(firstScope).toBe("42:7");
    expect(isCurrentCircleHomeScope(firstScope, "42:7")).toBe(true);
    expect(isCurrentCircleHomeScope(firstScope, "42:8")).toBe(false);
    expect(isCurrentCircleHomeScope(firstScope, "43:7")).toBe(false);
  });

  it("keeps the scoped query, mutation affinity, and draft-mount continuity source contracts", () => {
    const circleScreen = readFileSync(
      join(process.cwd(), "app/circle/[id].tsx"),
      "utf8",
    );
    const editor = readFileSync(
      join(process.cwd(), "components/circle-home-panel.tsx"),
      "utf8",
    );

    expect(circleScreen).toMatch(
      /circleHome\.get\.useQuery\(\s*\{ circleId, viewerScope: user\?\.id \?\? null \}/s,
    );
    expect(circleScreen).toContain(
      "isFetchedAfterMount: home.isFetchedAfterMount",
    );
    expect(circleScreen).toMatch(/homeEditorIsOpen \? \(\s*<CircleHomeEditor/s);
    expect(circleScreen).toContain("key={homeScopeKey}");
    expect(editor.match(/viewerScope: home\.viewerId/g)).toHaveLength(2);
    expect(editor).toContain("home?: CircleHome");
    expect(editor).toContain("mounted.current = true");
    expect(editor).toContain("isAuthorityAvailable && home && !home.canManage");
  });
});
