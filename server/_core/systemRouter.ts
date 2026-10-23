import { z } from "zod";
import { notifyOwner } from "./notification";
import { adminProcedure, publicProcedure, router } from "./trpc";
import { requestCancellation } from "./bounded-network";

export const systemRouter = router({
  health: publicProcedure
    .input(
      z.object({
        timestamp: z.number().min(0, "timestamp cannot be negative"),
      }),
    )
    .query(() => ({
      ok: true,
    })),

  notifyOwner: adminProcedure
    .input(
      z.object({
        title: z.string().min(1, "title is required"),
        content: z.string().min(1, "content is required"),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const cancellation = requestCancellation(ctx.req, ctx.res);
      try {
        const delivered = await notifyOwner(input, {
          signal: cancellation.signal,
        });
        return { success: delivered } as const;
      } finally {
        cancellation.dispose();
      }
    }),
});
