import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  INTERESTS,
  interestMatches,
  recommendationReason,
  type CircleRecommendation,
  type CircleRecommendations,
  type InterestId,
  type IntroductionTarget,
  type OnboardingStatus,
  type OnboardingStep,
} from "../shared/onboarding";
import type { Circle } from "../shared/social";
import { circles, memberships, profiles } from "../drizzle/schema";
import { getDb, type CirclesDatabase } from "./db";
import { getProfile } from "./social-service";

const APPROVED_MEMBER_ROLES = ["owner", "moderator", "member"] as const;
const RECOMMENDATION_MAX_LIMIT = 12;

type MembershipRole = "owner" | "moderator" | "member" | "pending";
type Database = CirclesDatabase;
type OnboardingProfileRow = {
  userId: number;
  interests: InterestId[];
  onboardingStep: OnboardingStep;
  onboardingCompletedAt: Date | null;
};

export type SaveOnboardingInput = {
  interests: InterestId[];
  /** Omitted saves advance an incomplete profile to circles, but preserve completion. */
  step?: "circles" | "first-post";
};

function onboardingError(code: TRPCError["code"], message: string): never {
  throw new TRPCError({ code, message });
}

async function requireDb(): Promise<Database> {
  const db = await getDb();
  if (!db) onboardingError("PRECONDITION_FAILED", "Database is unavailable");
  return db;
}

function countValue(value: unknown): number {
  const count = Number(value ?? 0);
  return Number.isFinite(count) ? count : 0;
}

function asIso(value: Date): string {
  return value.toISOString();
}

function asOnboardingStatus(row: OnboardingProfileRow): OnboardingStatus {
  return {
    userId: row.userId,
    interests: row.interests,
    step: row.onboardingStep,
    completedAt: row.onboardingCompletedAt
      ? asIso(row.onboardingCompletedAt)
      : null,
  };
}

function virtualOnboardingProfile(userId: number): OnboardingProfileRow {
  return {
    userId,
    interests: [],
    onboardingStep: "interests",
    onboardingCompletedAt: null,
  };
}

/** Read-only onboarding queries never materialize a missing social profile. */
async function findOwnOnboardingProfile(
  db: Database,
  userId: number,
): Promise<OnboardingProfileRow | null> {
  const rows = await db
    .select({
      userId: profiles.userId,
      interests: profiles.interests,
      onboardingStep: profiles.onboardingStep,
      onboardingCompletedAt: profiles.onboardingCompletedAt,
    })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);
  return rows[0] ?? null;
}

/** Save and finish are the only onboarding paths allowed to create the caller's social profile. */
async function ownMutableOnboardingProfile(
  db: Database,
  userId: number,
): Promise<OnboardingProfileRow> {
  await getProfile(userId);
  const row = await findOwnOnboardingProfile(db, userId);
  if (!row)
    onboardingError("INTERNAL_SERVER_ERROR", "Unable to initialize onboarding");
  return row;
}

/** Returns the caller's private onboarding state; no public profile response is extended. */
export async function getOnboardingStatus(
  userId: number,
): Promise<OnboardingStatus> {
  const db = await requireDb();
  return asOnboardingStatus(
    (await findOwnOnboardingProfile(db, userId)) ??
      virtualOnboardingProfile(userId),
  );
}

/**
 * Saves only the authenticated person's explicit allowlisted choices. An omitted step means the
 * initial save advances to circles, while a completed profile remains complete until the caller
 * deliberately supplies circles or first-post to reopen the flow.
 */
export async function saveOnboarding(
  userId: number,
  input: SaveOnboardingInput,
): Promise<OnboardingStatus> {
  const db = await requireDb();
  const current = await ownMutableOnboardingProfile(db, userId);
  const step =
    input.step ?? (current.onboardingCompletedAt ? "complete" : "circles");
  const completedAt =
    step === "complete" ? current.onboardingCompletedAt : null;

  const rows = await db
    .update(profiles)
    .set({
      interests: input.interests,
      onboardingStep: step,
      onboardingCompletedAt: completedAt,
      updatedAt: new Date(),
    })
    .where(eq(profiles.userId, userId))
    .returning({
      userId: profiles.userId,
      interests: profiles.interests,
      onboardingStep: profiles.onboardingStep,
      onboardingCompletedAt: profiles.onboardingCompletedAt,
    });
  const row = rows[0];
  if (!row)
    onboardingError("INTERNAL_SERVER_ERROR", "Unable to save onboarding");
  return asOnboardingStatus(row);
}

/** Marks onboarding complete without changing choices and preserves the timestamp on retries. */
export async function finishOnboarding(
  userId: number,
): Promise<OnboardingStatus> {
  const db = await requireDb();
  await ownMutableOnboardingProfile(db, userId);

  const rows = await db
    .update(profiles)
    .set({
      onboardingStep: "complete",
      onboardingCompletedAt: sql<Date>`coalesce(${profiles.onboardingCompletedAt}, now())`,
      updatedAt: new Date(),
    })
    .where(eq(profiles.userId, userId))
    .returning({
      userId: profiles.userId,
      interests: profiles.interests,
      onboardingStep: profiles.onboardingStep,
      onboardingCompletedAt: profiles.onboardingCompletedAt,
    });
  const row = rows[0];
  if (!row)
    onboardingError("INTERNAL_SERVER_ERROR", "Unable to finish onboarding");
  return asOnboardingStatus(row);
}

function isApprovedRole(
  role: MembershipRole | null,
): role is Exclude<MembershipRole, "pending"> {
  return role === "owner" || role === "moderator" || role === "member";
}

/**
 * Pure ranking seam. It rejects any accidental non-public candidate defensively, keeps exact
 * case-folded categories ahead of explore fallbacks, and makes ties stable independently of DB
 * collation. Already joined and pending public circles intentionally remain selectable.
 */
export function rankCircleRecommendations(
  candidates: readonly Circle[],
  interests: readonly InterestId[],
  limit: number,
): CircleRecommendation[] {
  return candidates
    .filter((circle) => circle.privacy === "public")
    .map((circle) => ({
      circle,
      matchedInterests: interestMatches(circle.category, interests),
    }))
    .sort((left, right) => {
      const matchDifference =
        Number(right.matchedInterests.length > 0) -
        Number(left.matchedInterests.length > 0);
      if (matchDifference) return matchDifference;
      const categoryDifference = left.circle.category
        .trim()
        .toLowerCase()
        .localeCompare(right.circle.category.trim().toLowerCase(), "en");
      if (categoryDifference) return categoryDifference;
      const nameDifference = left.circle.name
        .trim()
        .toLowerCase()
        .localeCompare(right.circle.name.trim().toLowerCase(), "en");
      if (nameDifference) return nameDifference;
      return left.circle.id - right.circle.id;
    })
    .slice(0, limit)
    .map(({ circle, matchedInterests }) => ({
      circle,
      matchedInterests,
      reason: recommendationReason(matchedInterests),
    }));
}

function matchingCategoryNames(interests: readonly InterestId[]): string[] {
  return INTERESTS.filter((interest) => interests.includes(interest.id)).map(
    (interest) => interest.category.trim().toLowerCase(),
  );
}

/**
 * Reads at most the request limit from public circles. SQL applies the same exact category rank
 * before the limit, so a small early explore batch cannot displace a later saved-interest match.
 */
async function publicRecommendationCircles(
  db: Database,
  userId: number,
  interests: readonly InterestId[],
  limit: number,
): Promise<Circle[]> {
  const categories = matchingCategoryNames(interests);
  const categoryRank = categories.length
    ? sql<number>`CASE WHEN lower(btrim(${circles.category})) IN (${sql.join(
        categories.map((category) => sql`${category}`),
        sql`, `,
      )}) THEN 0 ELSE 1 END`
    : sql<number>`1`;
  const normalizedCategory = sql<string>`lower(btrim(${circles.category}))`;
  const normalizedName = sql<string>`lower(btrim(${circles.name}))`;
  const rows = await db
    .select()
    .from(circles)
    .where(eq(circles.privacy, "public"))
    .orderBy(
      asc(categoryRank),
      asc(normalizedCategory),
      asc(normalizedName),
      asc(circles.id),
    )
    .limit(Math.min(limit, RECOMMENDATION_MAX_LIMIT));

  return Promise.all(
    rows.map(async (circle): Promise<Circle> => {
      const [membershipRows, memberCountRows] = await Promise.all([
        db
          .select({ role: memberships.role })
          .from(memberships)
          .where(
            and(
              eq(memberships.circleId, circle.id),
              eq(memberships.userId, userId),
            ),
          )
          .limit(1),
        db
          .select({ total: sql<number>`count(*)` })
          .from(memberships)
          .where(
            and(
              eq(memberships.circleId, circle.id),
              inArray(memberships.role, APPROVED_MEMBER_ROLES),
            ),
          ),
      ]);
      const role =
        (membershipRows[0]?.role as MembershipRole | undefined) ?? null;
      return {
        id: circle.id,
        name: circle.name,
        description: circle.description,
        category: circle.category,
        image: circle.image,
        color: circle.color,
        memberCount: countValue(memberCountRows[0]?.total),
        ownerId: circle.ownerId,
        privacy: "public",
        role,
        joined: isApprovedRole(role),
      };
    }),
  );
}

/**
 * Builds recommendations from saved explicit interests only. It never examines posts, private
 * circles, private memberships, or inferred behavior, and it never mutates membership or content.
 */
export async function getCircleRecommendations(
  userId: number,
  requestedLimit: number,
): Promise<CircleRecommendations> {
  const db = await requireDb();
  const profile =
    (await findOwnOnboardingProfile(db, userId)) ??
    virtualOnboardingProfile(userId);
  const limit = Math.min(
    Math.max(Math.floor(requestedLimit), 1),
    RECOMMENDATION_MAX_LIMIT,
  );
  const candidates = await publicRecommendationCircles(
    db,
    userId,
    profile.interests,
    limit,
  );
  return {
    userId,
    interests: [...profile.interests],
    items: rankCircleRecommendations(candidates, profile.interests, limit),
    basis: profile.interests.length ? "interests" : "explore",
  };
}

/** One statement proves completed setup and current public/approved membership; no row mutations. */
export async function getIntroductionTarget(
  userId: number,
  circleId: number,
): Promise<IntroductionTarget> {
  const db = await requireDb();
  const rows = await db
    .select({ id: circles.id })
    .from(circles)
    .innerJoin(
      memberships,
      and(
        eq(memberships.circleId, circles.id),
        eq(memberships.userId, userId),
        inArray(memberships.role, APPROVED_MEMBER_ROLES),
      ),
    )
    .innerJoin(
      profiles,
      and(
        eq(profiles.userId, userId),
        eq(profiles.onboardingStep, "complete"),
        isNotNull(profiles.onboardingCompletedAt),
      ),
    )
    .where(and(eq(circles.id, circleId), eq(circles.privacy, "public")))
    .limit(1);
  return { userId, circleId, eligible: rows.length === 1 };
}
