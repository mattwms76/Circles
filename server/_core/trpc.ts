import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from "../../shared/const.js";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { withDatabaseActorTransaction } from "../db";

export const UNEXPECTED_ERROR_MESSAGE =
  "The service is temporarily unavailable.";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    // Explicit TRPC business/validation errors remain actionable. Everything that tRPC classified
    // as internal is an operational boundary and must not serialize upstream, driver, or storage
    // detail to an authenticated client.
    if (error.code !== "INTERNAL_SERVER_ERROR") return shape;
    return {
      ...shape,
      message: UNEXPECTED_ERROR_MESSAGE,
      data: {
        ...shape.data,
        stack: undefined,
      },
    };
  },
});

export const router = t.router;

/**
 * The identity is fixed before input parsing and is installed with SET LOCAL in
 * one outer database transaction. Any nested service transaction is therefore
 * a savepoint and cannot acquire a different request actor.
 */
const databaseActorProcedure = t.procedure.use(async ({ ctx, next }) => {
  // createContext always installs this marker. Its absence is reserved for
  // direct router.createCaller unit fixtures, which intentionally do not open
  // a real database transaction and cannot reach an HTTP request path.
  if (!ctx.databaseActor) return next({ ctx });

  return withDatabaseActorTransaction(ctx.databaseActor, async () => {
    const result = await next({ ctx });
    // tRPC returns handled procedure failures as `{ ok: false, error }` rather
    // than rejecting this middleware. Re-throw inside the outer transaction so
    // a failed mutation can never commit before tRPC formats that same error.
    if (!result.ok) throw result.error;
    return result;
  });
});

export const publicProcedure = databaseActorProcedure;

const requireUser = t.middleware(async (opts) => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = databaseActorProcedure.use(requireUser);

export const adminProcedure = databaseActorProcedure.use(
  t.middleware(async (opts) => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);
