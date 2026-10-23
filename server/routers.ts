import { clearAcceptedSessionCookies } from "./_core/cookies";
import { authorizeLogoutRequest } from "./_core/oauth";
import { sdk } from "./_core/sdk";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { socialRouter } from "./social-router";
import { liveRouter } from "./live-router";
import { onboardingRouter } from "./onboarding-router";

export const appRouter = router({
  onboarding: onboardingRouter,
  social: socialRouter,
  live: liveRouter,
  // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(async ({ ctx }) => {
      try {
        try {
          await authorizeLogoutRequest(ctx.req);
        } catch {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Logout request was not accepted",
          });
        }
        await sdk.revokeRequestSessions(ctx.req);
        return {
          success: true,
        } as const;
      } finally {
        // Browser authority is removed even when persistent revocation fails;
        // the thrown failure prevents a false successful logout response.
        clearAcceptedSessionCookies(ctx.req, ctx.res);
      }
    }),
  }),

  // TODO: add feature routers here, e.g.
  // todo: router({
  //   list: protectedProcedure.query(({ ctx }) =>
  //     db.getUserTodos(ctx.user.id)
  //   ),
  // }),
});

export type AppRouter = typeof appRouter;
