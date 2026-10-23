import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  MODERATION_NOTE_MAX,
  MODERATION_PAGE_MAX,
  moderationNote,
  moderationTextLength,
} from "../shared/moderation";
import { protectedProcedure, router } from "./_core/trpc";
import {
  getModerationCaseDetail,
  listModerationCases,
  resolveModerationCase,
} from "./moderation-service";

const id = z.number().int().positive().max(2_147_483_647);
const scope = z.object({ circleId: id, viewerScope: id }).strict();
const cursor = z.object({ id }).strict();
const note = z
  .string()
  .transform(moderationNote)
  .refine(
    (value) => moderationTextLength(value) <= MODERATION_NOTE_MAX,
    "Resolution note is too long",
  );

export const moderationListInput = scope
  .extend({
    filter: z.enum(["open", "resolved"]),
    cursor: cursor.optional(),
    limit: z.number().int().min(1).max(MODERATION_PAGE_MAX).optional(),
  })
  .strict();
export const moderationDetailInput = scope.extend({ caseId: id }).strict();
export const moderationResolveInput = scope
  .extend({ caseId: id, decision: z.enum(["keep", "remove"]), note })
  .strict();

function assertViewerScope(viewerId: number, viewerScope: number): void {
  if (viewerScope !== viewerId) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "Account changed. Please try again.",
    });
  }
}

/** Current protected context is authoritative; viewerScope is only an account-cache affinity key. */
export const moderationRouter = router({
  list: protectedProcedure
    .input(moderationListInput)
    .query(({ ctx, input }) => {
      assertViewerScope(ctx.user.id, input.viewerScope);
      return listModerationCases(ctx.user.id, input);
    }),
  detail: protectedProcedure
    .input(moderationDetailInput)
    .query(({ ctx, input }) => {
      assertViewerScope(ctx.user.id, input.viewerScope);
      return getModerationCaseDetail(ctx.user.id, input);
    }),
  resolve: protectedProcedure
    .input(moderationResolveInput)
    .mutation(({ ctx, input }) => {
      assertViewerScope(ctx.user.id, input.viewerScope);
      return resolveModerationCase(ctx.user.id, input);
    }),
});
