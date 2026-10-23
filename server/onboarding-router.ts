import { z } from "zod";
import {
  INTEREST_IDS,
  MAX_INTERESTS,
  type CircleRecommendations,
  type OnboardingStatus,
  type IntroductionTarget,
} from "../shared/onboarding";
import { protectedProcedure, router } from "./_core/trpc";
import {
  finishOnboarding,
  getCircleRecommendations,
  getOnboardingStatus,
  getIntroductionTarget,
  saveOnboarding,
} from "./onboarding-service";

const interestId = z.enum(INTEREST_IDS);

/** Duplicate choices are rejected rather than silently deduplicated. */
export const saveOnboardingInput = z.object({
  interests: z
    .array(interestId)
    .max(MAX_INTERESTS)
    .refine((interests) => new Set(interests).size === interests.length, {
      message: "Choose each interest only once",
    }),
  // The service supplies the circles default for incomplete profiles and can preserve completion
  // when a completed person edits selections without explicitly reopening the flow.
  step: z.enum(["circles", "first-post"]).optional(),
});

export const recommendationsInput = z.object({
  limit: z.number().int().positive().max(12).default(6),
});

/** Every operation derives identity exclusively from protectedProcedure context. */
export const onboardingRouter = router({
  introductionTarget: protectedProcedure
    .input(z.object({ circleId: z.number().int().positive() }))
    .query(
      ({ ctx, input }): Promise<IntroductionTarget> =>
        getIntroductionTarget(ctx.user.id, input.circleId),
    ),
  status: protectedProcedure.query(
    ({ ctx }): Promise<OnboardingStatus> => getOnboardingStatus(ctx.user.id),
  ),

  save: protectedProcedure
    .input(saveOnboardingInput)
    .mutation(
      ({ ctx, input }): Promise<OnboardingStatus> =>
        saveOnboarding(ctx.user.id, input),
    ),

  finish: protectedProcedure.mutation(
    ({ ctx }): Promise<OnboardingStatus> => finishOnboarding(ctx.user.id),
  ),

  recommendations: protectedProcedure
    .input(recommendationsInput)
    .query(
      ({ ctx, input }): Promise<CircleRecommendations> =>
        getCircleRecommendations(ctx.user.id, input.limit),
    ),
});
