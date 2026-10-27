import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  CIRCLE_HOME_ID_MAX,
  CIRCLE_HOME_RULE_MAX,
  CIRCLE_HOME_RULES_MAX,
  CIRCLE_HOME_WELCOME_MAX,
  circleHomeRuleKey,
  circleHomeTextLength,
  type CircleHome,
} from "../shared/circle-home";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import {
  getCircleHome,
  getCirclePrompt,
  setCirclePinnedPost,
  setCirclePrompt,
  updateCircleHome,
} from "./social-service";

const circleHomeId = z.number().int().positive().max(CIRCLE_HOME_ID_MAX);
const circleHomeViewerScope = z.number().int().positive().nullable().optional();
const circleHomeRule = z
  .string()
  .refine((value) => !/[\r\n]/.test(value), "Circle rules must be single-line")
  .trim()
  .min(1)
  .refine(
    (value) => circleHomeTextLength(value) <= CIRCLE_HOME_RULE_MAX,
    "Circle rule is too long",
  );

const CIRCLE_HOME_ACCOUNT_CHANGED_MESSAGE =
  "Account changed. Please try again.";

function assertCircleHomeViewerScope(
  viewerScope: number | null | undefined,
  viewerId: number | null,
): void {
  if (viewerScope !== undefined && viewerScope !== viewerId) {
    throw new TRPCError({
      code: "CONFLICT",
      message: CIRCLE_HOME_ACCOUNT_CHANGED_MESSAGE,
    });
  }
}

export const circleHomeUpdateInput = z
  .object({
    circleId: circleHomeId,
    viewerScope: circleHomeViewerScope,
    welcomeMessage: z
      .string()
      .trim()
      .refine(
        (value) => circleHomeTextLength(value) <= CIRCLE_HOME_WELCOME_MAX,
        "Welcome message is too long",
      ),
    rules: z.array(circleHomeRule).max(CIRCLE_HOME_RULES_MAX),
  })
  .strict()
  .superRefine((value, context) => {
    const seen = new Set<string>();
    value.rules.forEach((rule, index) => {
      const key = circleHomeRuleKey(rule);
      if (seen.has(key)) {
        context.addIssue({
          code: "custom",
          message: "Circle rules must be unique",
          path: ["rules", index],
        });
      }
      seen.add(key);
    });
  });

export const circleHomePinInput = z
  .object({
    circleId: circleHomeId,
    viewerScope: circleHomeViewerScope,
    postId: circleHomeId.nullable(),
  })
  .strict();

const circleHomeGetInput = z
  .object({ circleId: circleHomeId, viewerScope: circleHomeViewerScope })
  .strict();

/** Circle Home has no side effects on read and uses the current context session for every mutation. */
export const circleHomeRouter = router({
  get: publicProcedure
    .input(circleHomeGetInput)
    .query(({ ctx, input }): Promise<CircleHome> => {
      const viewerId = ctx.user?.id ?? null;
      assertCircleHomeViewerScope(input.viewerScope, viewerId);
      return getCircleHome(viewerId, input.circleId);
    }),

  update: protectedProcedure
    .input(circleHomeUpdateInput)
    .mutation(({ ctx, input }) => {
      assertCircleHomeViewerScope(input.viewerScope, ctx.user?.id ?? null);
      return updateCircleHome(ctx.user.id, input);
    }),

  pin: protectedProcedure
    .input(circleHomePinInput)
    .mutation(({ ctx, input }) => {
      assertCircleHomeViewerScope(input.viewerScope, ctx.user?.id ?? null);
      return setCirclePinnedPost(ctx.user.id, input);
    }),

  prompt: publicProcedure
    .input(circleHomeGetInput)
    .query(({ ctx, input }) => {
      const viewerId = ctx.user?.id ?? null;
      assertCircleHomeViewerScope(input.viewerScope, viewerId);
      return getCirclePrompt(viewerId, input.circleId);
    }),

  setPrompt: protectedProcedure
    .input(
      z
        .object({
          circleId: circleHomeId,
          viewerScope: circleHomeViewerScope,
          body: z.string().max(400),
        })
        .strict(),
    )
    .mutation(({ ctx, input }) => {
      assertCircleHomeViewerScope(input.viewerScope, ctx.user?.id ?? null);
      return setCirclePrompt(ctx.user.id, input.circleId, input.body);
    }),
});
