import { describe, expect, it, vi } from "vitest";
import { profiles } from "../drizzle/schema";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getProfile: vi.fn(),
}));
vi.mock("../server/db", () => ({ getDb: mocks.getDb }));
vi.mock("../server/social-service", () => ({ getProfile: mocks.getProfile }));

const { finishOnboarding, saveOnboarding } =
  await import("../server/onboarding-service");

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

/** Disposable in-memory row/lock adapter; it has no network, credentials, or PostgreSQL connection. */
function onboardingRaceFixture() {
  const completion = new Date("2026-10-27T08:00:00.000Z");
  const profile = {
    userId: 71,
    interests: ["design"],
    onboardingStep: "interests" as
      | "interests"
      | "circles"
      | "first-post"
      | "complete",
    onboardingCompletedAt: null as Date | null,
  };
  const saveLockSeen = deferred();
  let transactionTail = Promise.resolve();
  const db: any = {};
  db.transaction = async <Value>(
    callback: (tx: typeof db) => Promise<Value>,
  ) => {
    const previous = transactionTail;
    let release!: () => void;
    transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await callback(db);
    } finally {
      release();
    }
  };
  db.select = () => ({
    from: (table: unknown) => {
      if (table !== profiles)
        throw new Error("Unexpected onboarding fixture read");
      return {
        where: () => ({
          limit: () => ({
            for: async (mode: string) => {
              expect(mode).toBe("update");
              saveLockSeen.resolve();
              return [{ ...profile, interests: [...profile.interests] }];
            },
          }),
        }),
      };
    },
  });
  db.update = (table: unknown) => {
    if (table !== profiles)
      throw new Error("Unexpected onboarding fixture write");
    return {
      set: (values: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            if (Array.isArray(values.interests))
              profile.interests = [...values.interests] as string[];
            if (typeof values.onboardingStep === "string") {
              profile.onboardingStep =
                values.onboardingStep as typeof profile.onboardingStep;
            }
            if (values.onboardingCompletedAt === null) {
              profile.onboardingCompletedAt = null;
            } else if (profile.onboardingStep === "complete") {
              profile.onboardingCompletedAt ??= completion;
            }
            return [{ ...profile, interests: [...profile.interests] }];
          },
        }),
      }),
    };
  };
  return { db, profile, saveLockSeen };
}

describe("parity27 onboarding completion serialization", () => {
  it("locks before deriving save state, so a queued finish cannot be erased by an older save", async () => {
    const fixture = onboardingRaceFixture();
    mocks.getDb.mockResolvedValue(fixture.db);
    mocks.getProfile.mockResolvedValue({ id: 71 });

    const save = saveOnboarding(71, { interests: ["music"] });
    await fixture.saveLockSeen.promise;
    const finish = finishOnboarding(71);
    const [saved, finished] = await Promise.all([save, finish]);

    expect(saved).toMatchObject({ step: "circles", completedAt: null });
    expect(finished).toMatchObject({
      step: "complete",
      completedAt: "2026-10-27T08:00:00.000Z",
    });
    expect(fixture.profile).toMatchObject({
      interests: ["music"],
      onboardingStep: "complete",
      onboardingCompletedAt: new Date("2026-10-27T08:00:00.000Z"),
    });
  });
});
