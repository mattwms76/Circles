import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";
import {
  databaseActorFromAuthenticatedUser,
  GUEST_DATABASE_ACTOR,
  type DatabaseActor,
} from "../actor-context";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  /**
   * Derived from `sdk.authenticateRequest`, never from a tRPC input field.
   * Optional only so isolated `router.createCaller` unit fixtures retain their
   * deliberately database-free seam; createContext always supplies it.
   */
  databaseActor?: DatabaseActor;
};

export async function createContext(
  opts: CreateExpressContextOptions,
): Promise<TrpcContext> {
  let user: User | null = null;
  let databaseActor: DatabaseActor = GUEST_DATABASE_ACTOR;

  try {
    const authenticatedUser = await sdk.authenticateRequest(opts.req);
    databaseActor = databaseActorFromAuthenticatedUser(authenticatedUser);
    user = authenticatedUser;
  } catch {
    // Authentication is optional for public procedures. A malformed principal
    // is never converted into a caller-selected database actor.
    user = null;
    databaseActor = GUEST_DATABASE_ACTOR;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    databaseActor,
  };
}
