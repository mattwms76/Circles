import { z } from "zod";
import { ACTIVITY_ID_MAX, ACTIVITY_PAGE_MAX } from "../shared/activity";
import { protectedProcedure, router } from "./_core/trpc";
import {
  getActivityPreferences,
  getActivityUnread,
  listActivity,
  markActivityRead,
  markAllActivityRead,
  resolveActivityTarget,
  setActivityCircleMuted,
  updateActivityCategories,
} from "./activity-service";

const id = z.number().int().min(1).max(ACTIVITY_ID_MAX);
const scope = z.object({ viewerScope: id.optional() }).strict();
const listInput = scope
  .extend({
    limit: z.number().int().min(1).max(ACTIVITY_PAGE_MAX).optional(),
    cursor: z.object({ beforeId: id }).strict().optional(),
  })
  .strict();
const preferencesInput = scope.extend({ circleId: id.optional() }).strict();
const itemInput = scope.extend({ id }).strict();
const markAllInput = scope
  .extend({ throughId: z.number().int().min(0).max(ACTIVITY_ID_MAX) })
  .strict();
const categoriesInput = scope
  .extend({
    commentsEnabled: z.boolean().optional(),
    membershipApprovalsEnabled: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.commentsEnabled !== undefined ||
      value.membershipApprovalsEnabled !== undefined,
    { message: "Choose at least one activity category" },
  );
const circleMutedInput = scope
  .extend({ circleId: id, muted: z.boolean() })
  .strict();

/** Recipient-only inbox procedures; `viewerScope` rejects stale account cache affinity only. */
export const activityRouter = router({
  list: protectedProcedure
    .input(listInput.optional())
    .query(({ ctx, input }) => listActivity(ctx.user.id, input ?? {})),
  unreadCount: protectedProcedure
    .input(scope.optional())
    .query(({ ctx, input }) => getActivityUnread(ctx.user.id, input ?? {})),
  preferences: protectedProcedure
    .input(preferencesInput.optional())
    .query(({ ctx, input }) =>
      getActivityPreferences(ctx.user.id, input ?? {}),
    ),
  resolveTarget: protectedProcedure
    .input(itemInput)
    .query(({ ctx, input }) => resolveActivityTarget(ctx.user.id, input)),
  markRead: protectedProcedure
    .input(itemInput)
    .mutation(({ ctx, input }) => markActivityRead(ctx.user.id, input)),
  markAllRead: protectedProcedure
    .input(markAllInput)
    .mutation(({ ctx, input }) => markAllActivityRead(ctx.user.id, input)),
  updateCategories: protectedProcedure
    .input(categoriesInput)
    .mutation(({ ctx, input }) => updateActivityCategories(ctx.user.id, input)),
  setCircleMuted: protectedProcedure
    .input(circleMutedInput)
    .mutation(({ ctx, input }) => setActivityCircleMuted(ctx.user.id, input)),
});
