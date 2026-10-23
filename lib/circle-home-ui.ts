import {
  boundCircleHomeText,
  circleHomeRuleKey,
  circleHomeTextLength,
  CIRCLE_HOME_RULE_MAX,
  CIRCLE_HOME_RULES_MAX,
  CIRCLE_HOME_WELCOME_MAX,
  type CircleHome,
} from "../shared/circle-home";

export { CIRCLE_HOME_RULE_MAX, CIRCLE_HOME_RULES_MAX, CIRCLE_HOME_WELCOME_MAX };

export type CircleHomeAccess = {
  privacy: "public" | "private";
  joined?: boolean;
  role?: "owner" | "moderator" | "member" | "pending" | null;
};

export type CircleHomeScope = {
  circleId: number;
  viewerId: number | null;
};

export type CircleHomeDraft = {
  welcomeMessage: string;
  rulesText: string;
};

export type CircleHomeUiState = {
  home?: CircleHome;
  isLoading: boolean;
  isError: boolean;
  /** A response is fresh for this mount, scoped to this viewer, and not being replaced. */
  isAuthorityAvailable: boolean;
  canEdit: boolean;
};

const approvedRoles = new Set(["owner", "moderator", "member"]);

/** The largest serialized ten-rule editor value, measured in Unicode code points. */
export const CIRCLE_HOME_RULES_TEXT_MAX =
  CIRCLE_HOME_RULES_MAX * CIRCLE_HOME_RULE_MAX + (CIRCLE_HOME_RULES_MAX - 1);

/** Private home content is for a current, approved member only. */
export function canReadCircleHome(access: CircleHomeAccess): boolean {
  return (
    access.privacy === "public" ||
    (access.joined === true && approvedRoles.has(access.role ?? ""))
  );
}

/** Scope query data to both the route and current account before rendering it. */
export function isCurrentCircleHomeResponse(
  home: CircleHome | null | undefined,
  scope: CircleHomeScope,
): home is CircleHome {
  return (
    !!home &&
    home.circleId === scope.circleId &&
    home.viewerId === scope.viewerId
  );
}

export function circleHomeScopeKey(scope: CircleHomeScope): string {
  return `${scope.circleId}:${scope.viewerId ?? "guest"}`;
}

/**
 * Do not render cached account-specific content until this mount receives a response. A
 * matching response may remain readable during its normal background refresh, but it never
 * remains authoritative for an edit while that refresh is in flight.
 */
export function resolveCircleHomeUiState({
  home,
  scope,
  homeQueryEnabled,
  isError,
  isFetchedAfterMount,
  isFetching,
}: {
  home: CircleHome | null | undefined;
  scope: CircleHomeScope;
  homeQueryEnabled: boolean;
  isError: boolean;
  isFetchedAfterMount: boolean;
  isFetching: boolean;
}): CircleHomeUiState {
  const hasMatchingHome = isCurrentCircleHomeResponse(home, scope);
  const hasForeignHome = !!home && !hasMatchingHome;
  const responseIsUsable =
    homeQueryEnabled && isFetchedAfterMount && !isError && hasMatchingHome;
  const responseMismatchIsSettled =
    homeQueryEnabled && isFetchedAfterMount && hasForeignHome && !isFetching;
  const displayError =
    homeQueryEnabled && (isError || responseMismatchIsSettled);
  const displayLoading =
    homeQueryEnabled &&
    !displayError &&
    (!isFetchedAfterMount || (hasForeignHome && isFetching));
  const currentHome = responseIsUsable ? home : undefined;
  const isAuthorityAvailable = !!currentHome && !isFetching;

  return {
    home: currentHome,
    isLoading: displayLoading,
    isError: displayError,
    isAuthorityAvailable,
    canEdit: isAuthorityAvailable && currentHome.canManage,
  };
}

/** A completion belongs to the mounted UI only while its account/route scope matches. */
export function isCurrentCircleHomeScope(
  completionScope: string,
  currentScope: string,
): boolean {
  return completionScope === currentScope;
}

export function circleHomeRulesFromText(value: string): string[] {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((rule) => rule.trim())
    .filter(Boolean);
}

export function circleHomeRulesToText(rules: readonly string[]): string {
  return rules
    .map((rule) => rule.trim())
    .filter(Boolean)
    .join("\n");
}

/** Keeps an editable newline list within the server's per-rule and rule-count bounds. */
export function boundCircleHomeRulesText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .slice(0, CIRCLE_HOME_RULES_MAX)
    .map((rule) => boundCircleHomeText(rule, CIRCLE_HOME_RULE_MAX))
    .join("\n");
}

export function getCircleHomeRuleMetrics(value: string): {
  ruleCount: number;
  longestRuleLength: number;
} {
  const rules = circleHomeRulesFromText(value);
  return {
    ruleCount: rules.length,
    longestRuleLength: Math.max(
      0,
      ...rules.map((rule) => circleHomeTextLength(rule)),
    ),
  };
}

export function validateCircleHomeDraft(
  draft: CircleHomeDraft,
): string | undefined {
  if (circleHomeTextLength(draft.welcomeMessage) > CIRCLE_HOME_WELCOME_MAX) {
    return `Keep the welcome message under ${CIRCLE_HOME_WELCOME_MAX.toLocaleString()} characters.`;
  }

  const rules = circleHomeRulesFromText(draft.rulesText);
  if (rules.length > CIRCLE_HOME_RULES_MAX) {
    return `Use up to ${CIRCLE_HOME_RULES_MAX} rules.`;
  }

  if (rules.some((rule) => circleHomeTextLength(rule) > CIRCLE_HOME_RULE_MAX)) {
    return `Keep each rule under ${CIRCLE_HOME_RULE_MAX} characters.`;
  }

  const uniqueRules = new Set(rules.map(circleHomeRuleKey));
  if (uniqueRules.size !== rules.length) {
    return "Each circle rule needs to be unique.";
  }

  return undefined;
}

export function serializeCircleHomeDraft(draft: CircleHomeDraft): {
  welcomeMessage: string;
  rules: string[];
} {
  return {
    welcomeMessage: draft.welcomeMessage.trim(),
    rules: circleHomeRulesFromText(draft.rulesText),
  };
}

export function getReadableCircleHomeError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "That change could not be saved. Please try again.";
}
