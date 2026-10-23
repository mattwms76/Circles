import type { Post } from "./social";

export const CIRCLE_HOME_WELCOME_MAX = 2_000;
export const CIRCLE_HOME_RULE_MAX = 300;
export const CIRCLE_HOME_RULES_MAX = 10;
export const CIRCLE_HOME_ID_MAX = 2_147_483_647;

/** Bounds count Unicode code points consistently with PostgreSQL char_length. */
export function circleHomeTextLength(value: string): number {
  return Array.from(value).length;
}

export function boundCircleHomeText(value: string, maximum: number): string {
  return Array.from(value).slice(0, maximum).join("");
}

/** Portable uniqueness: trim and fold ASCII letters; preserve other Unicode text exactly. */
export function circleHomeRuleKey(value: string): string {
  return value.trim().replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

/** Home content follows feed visibility; it is not appended to public circle discovery metadata. */
export type CircleHome = {
  circleId: number;
  viewerId: number | null;
  welcomeMessage: string;
  rules: string[];
  pinnedPost: Post | null;
  canManage: boolean;
  updatedAt: string;
};

export type CircleHomeTextInput = {
  circleId: number;
  /** Cache/request affinity only; the server must still use and match ctx.user.id. */
  viewerScope?: number | null;
  welcomeMessage: string;
  rules: string[];
};

export type CircleHomePinInput = {
  circleId: number;
  viewerScope?: number | null;
  postId: number | null;
};
