import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../server/_core/context";
import { circles, memberships, profiles } from "../drizzle/schema";
import {
  onboardingRouter,
  saveOnboardingInput,
} from "../server/onboarding-router";
import {
  finishOnboarding,
  getCircleRecommendations,
  getOnboardingStatus,
  rankCircleRecommendations,
  saveOnboarding,
} from "../server/onboarding-service";
import type { Circle } from "../shared/social";

const onboardingDbMocks = vi.hoisted(() => ({ getDb: vi.fn() }));
const onboardingProfileMocks = vi.hoisted(() => ({ getProfile: vi.fn() }));

vi.mock("../server/db", () => ({ getDb: onboardingDbMocks.getDb }));
vi.mock("../server/social-service", () => ({
  getProfile: onboardingProfileMocks.getProfile,
}));

type SyntheticProfile = {
  userId: number;
  interests: string[];
  onboardingStep: "interests" | "circles" | "first-post" | "complete";
  onboardingCompletedAt: Date | null;
};

const firstFinishAt = new Date("2026-10-23T11:00:00.000Z");

function circle(overrides: Partial<Circle> = {}): Circle {
  return {
    id: 1,
    name: "Circle one",
    description: "A real public circle",
    category: "Lifestyle",
    image: "",
    color: "#ED604A",
    memberCount: 0,
    ownerId: 5,
    privacy: "public",
    ...overrides,
  };
}

/** Minimal Drizzle-shaped state fixture; it permits only profile updates and bounded public reads. */
function onboardingFixture(
  options: {
    profile?: Partial<SyntheticProfile>;
    profileMissing?: boolean;
    circles?: Circle[];
    membershipRoles?: (
      | "owner"
      | "moderator"
      | "member"
      | "pending"
      | undefined
    )[];
    memberCounts?: number[];
  } = {},
) {
  const profile: SyntheticProfile = {
    userId: options.profile?.userId ?? 71,
    interests: options.profile?.interests ?? ["design"],
    onboardingStep: options.profile?.onboardingStep ?? "interests",
    onboardingCompletedAt: options.profile?.onboardingCompletedAt ?? null,
  };
  const circleRows = options.circles ?? [];
  const membershipRoles = options.membershipRoles ?? [];
  const memberCounts = options.memberCounts ?? [];
  let roleIndex = 0;
  let countIndex = 0;
  let publicCircleLimit: number | undefined;
  const insert = vi.fn();
  const post = vi.fn();
  const update = vi.fn((table: unknown) => {
    if (table !== profiles)
      throw new Error("Only profiles may be updated by onboarding");
    return {
      set: (values: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            if (Array.isArray(values.interests))
              profile.interests = [...values.interests] as string[];
            if (typeof values.onboardingStep === "string") {
              profile.onboardingStep =
                values.onboardingStep as SyntheticProfile["onboardingStep"];
            }
            if (values.onboardingCompletedAt === null) {
              profile.onboardingCompletedAt = null;
            } else if (profile.onboardingStep === "complete") {
              profile.onboardingCompletedAt ??= firstFinishAt;
            }
            return [profileRow()];
          },
        }),
      }),
    };
  });

  const profileRow = () => ({ ...profile, interests: [...profile.interests] });
  const database = {
    select: (selection?: Record<string, unknown>) => ({
      from: (table: unknown) => {
        if (table === profiles) {
          return {
            where: () => ({
              limit: async () => (options.profileMissing ? [] : [profileRow()]),
            }),
          };
        }
        if (table === circles) {
          return {
            where: () => ({
              orderBy: () => ({
                limit: async (limit: number) => {
                  publicCircleLimit = limit;
                  // The real query has a public privacy predicate. The fixture refuses to leak a
                  // private row even if its source list contains one.
                  return circleRows
                    .filter((candidate) => candidate.privacy === "public")
                    .slice(0, limit);
                },
              }),
            }),
          };
        }
        if (table === memberships) {
          if (selection && "role" in selection) {
            return {
              where: () => ({
                limit: async () => {
                  const role = membershipRoles[roleIndex++];
                  return role ? [{ role }] : [];
                },
              }),
            };
          }
          return {
            where: async () => [{ total: memberCounts[countIndex++] ?? 0 }],
          };
        }
        throw new Error("Unexpected onboarding select table");
      },
    }),
    update,
    insert,
    post,
  };

  return {
    database,
    profile,
    insert,
    post,
    update,
    publicCircleLimit: () => publicCircleLimit,
  };
}

function authenticatedContext(userId = 71): TrpcContext {
  const now = new Date("2026-10-23T10:00:00.000Z");
  return {
    user: {
      id: userId,
      openId: `synthetic-${userId}`,
      name: null,
      email: null,
      loginMethod: null,
      role: "user",
      createdAt: now,
      updatedAt: now,
      lastSignedIn: now,
    },
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

beforeEach(() => {
  onboardingDbMocks.getDb.mockReset();
  onboardingProfileMocks.getProfile.mockReset();
  onboardingProfileMocks.getProfile.mockResolvedValue({ id: 71 });
});

describe("approved onboarding router authority and validation", () => {
  it("requires an authenticated context for every private onboarding endpoint", async () => {
    const caller = onboardingRouter.createCaller({
      user: null,
      req: {} as TrpcContext["req"],
      res: {} as TrpcContext["res"],
    });

    await expect(caller.status()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(caller.finish()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(caller.recommendations({ limit: 6 })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("allows only unique allowlisted interest IDs through the six-choice boundary", () => {
    expect(
      saveOnboardingInput.safeParse({ interests: ["design", "music"] }).success,
    ).toBe(true);
    expect(
      saveOnboardingInput.safeParse({ interests: ["not-an-interest"] }).success,
    ).toBe(false);
    expect(
      saveOnboardingInput.safeParse({ interests: ["design", "design"] })
        .success,
    ).toBe(false);
    expect(
      saveOnboardingInput.safeParse({
        interests: [
          "lifestyle",
          "outdoors",
          "design",
          "photography",
          "fitness",
          "music",
          "food",
        ],
      }).success,
    ).toBe(false);
  });

  it("takes the caller identity from context, not an input user id", async () => {
    const fixture = onboardingFixture({ profile: { userId: 71 } });
    onboardingDbMocks.getDb.mockResolvedValue(fixture.database);
    const caller = onboardingRouter.createCaller(authenticatedContext(71));

    const status = await caller.save({
      interests: ["music"],
      userId: 999,
    } as never);

    expect(status).toMatchObject({
      userId: 71,
      interests: ["music"],
      step: "circles",
    });
    expect(onboardingProfileMocks.getProfile).toHaveBeenCalledWith(71);
    expect(fixture.profile.userId).toBe(71);
  });
});

describe("approved onboarding persistence", () => {
  it("keeps status and recommendations read-only and returns virtual defaults before a profile exists", async () => {
    const fixture = onboardingFixture({
      profileMissing: true,
      circles: [circle({ id: 1, category: "Design" })],
      membershipRoles: [undefined],
      memberCounts: [0],
    });
    onboardingDbMocks.getDb.mockResolvedValue(fixture.database);

    const status = await getOnboardingStatus(71);
    const recommendations = await getCircleRecommendations(71, 6);

    expect(status).toEqual({
      userId: 71,
      interests: [],
      step: "interests",
      completedAt: null,
    });
    expect(recommendations).toMatchObject({ userId: 71, basis: "explore" });
    expect(onboardingProfileMocks.getProfile).not.toHaveBeenCalled();
    expect(fixture.update).not.toHaveBeenCalled();
    expect(fixture.insert).not.toHaveBeenCalled();
    expect(fixture.post).not.toHaveBeenCalled();
  });

  it("preserves a first finish timestamp, never changes interests on finish, and does not auto-write joins or posts", async () => {
    const fixture = onboardingFixture({
      profile: { interests: ["design"], onboardingStep: "first-post" },
    });
    onboardingDbMocks.getDb.mockResolvedValue(fixture.database);

    const saved = await saveOnboarding(71, {
      interests: ["music"],
      step: "first-post",
    });
    const first = await finishOnboarding(71);
    const second = await finishOnboarding(71);

    expect(saved).toMatchObject({
      userId: 71,
      interests: ["music"],
      step: "first-post",
      completedAt: null,
    });
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      userId: 71,
      interests: ["music"],
      step: "complete",
      completedAt: firstFinishAt.toISOString(),
    });
    expect(fixture.insert).not.toHaveBeenCalled();
    expect(fixture.post).not.toHaveBeenCalled();
  });

  it("lets a completed person edit choices without reopening unless a new step is explicit", async () => {
    const fixture = onboardingFixture({
      profile: {
        interests: ["design"],
        onboardingStep: "complete",
        onboardingCompletedAt: firstFinishAt,
      },
    });
    onboardingDbMocks.getDb.mockResolvedValue(fixture.database);

    const retained = await saveOnboarding(71, { interests: ["art"] });
    const reopened = await saveOnboarding(71, {
      interests: ["art"],
      step: "circles",
    });

    expect(retained).toMatchObject({
      step: "complete",
      completedAt: firstFinishAt.toISOString(),
    });
    expect(reopened).toMatchObject({ step: "circles", completedAt: null });
  });
});

describe("public circle recommendation boundaries", () => {
  it("puts exact case-folded saved-interest matches ahead of explore fallbacks with deterministic reasons", () => {
    const items = rankCircleRecommendations(
      [
        circle({ id: 8, name: "Explore", category: "Lifestyle" }),
        circle({
          id: 7,
          name: "Private design",
          category: "DESIGN",
          privacy: "private",
        }),
        circle({
          id: 4,
          name: "Studio",
          category: "  dEsIgN  ",
          role: "member",
          joined: true,
        }),
      ],
      ["design"],
      6,
    );

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      circle: { id: 4, joined: true, role: "member" },
      matchedInterests: ["design"],
      reason: "Because you chose Design.",
    });
    expect(items[1]).toMatchObject({
      circle: { id: 8 },
      matchedInterests: [],
      reason: "A public circle to explore — not an interest match.",
    });
    expect(items.map((item) => item.circle.id)).not.toContain(7);
  });

  it("reads a bounded public set only, keeps real membership statuses and approved counts, and never auto-joins", async () => {
    const fixture = onboardingFixture({
      profile: { interests: ["design"] },
      circles: [
        circle({ id: 1, name: "Design club", category: "Design" }),
        circle({ id: 2, name: "Weekend", category: "Lifestyle" }),
        circle({
          id: 3,
          name: "Private design",
          category: "Design",
          privacy: "private",
        }),
      ],
      membershipRoles: ["pending", "member"],
      memberCounts: [2, 9],
    });
    onboardingDbMocks.getDb.mockResolvedValue(fixture.database);

    const recommendations = await getCircleRecommendations(71, 12);

    expect(fixture.publicCircleLimit()).toBe(12);
    expect(recommendations).toMatchObject({ userId: 71, basis: "interests" });
    expect(recommendations.items).toEqual([
      expect.objectContaining({
        circle: expect.objectContaining({
          id: 1,
          privacy: "public",
          role: "pending",
          joined: false,
          memberCount: 2,
        }),
        matchedInterests: ["design"],
      }),
      expect.objectContaining({
        circle: expect.objectContaining({
          id: 2,
          privacy: "public",
          role: "member",
          joined: true,
          memberCount: 9,
        }),
        matchedInterests: [],
      }),
    ]);
    expect(recommendations.items.map((item) => item.circle.id)).not.toContain(
      3,
    );
    expect(fixture.insert).not.toHaveBeenCalled();
    expect(fixture.post).not.toHaveBeenCalled();
  });
});
