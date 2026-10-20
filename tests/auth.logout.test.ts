import { describe, expect, it } from "vitest";
import { appRouter } from "../server/routers";
import type { TrpcContext } from "../server/_core/context";
import { getSessionCookieName } from "../server/_core/cookies";

type CookieCall = {
  name: string;
  options: Record<string, unknown>;
};

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(protocol: "https" | "http" = "https"): {
  ctx: TrpcContext;
  clearedCookies: CookieCall[];
} {
  const clearedCookies: CookieCall[] = [];

  const user: AuthenticatedUser = {
    id: 1,
    openId: "sample-user",
    email: "sample@example.com",
    name: "Sample User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  const ctx: TrpcContext = {
    user,
    req: {
      protocol,
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: (name: string, options: Record<string, unknown>) => {
        clearedCookies.push({ name, options });
      },
    } as TrpcContext["res"],
  };

  return { ctx, clearedCookies };
}

describe("auth.logout", () => {
  it("clears both secure session cookies and reports success", async () => {
    const { ctx, clearedCookies } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.auth.logout();

    expect(result).toEqual({ success: true });
    expect(clearedCookies.map((cookie) => cookie.name)).toEqual([
      "webdev_app_session",
      getSessionCookieName(ctx.req),
    ]);
    for (const cookie of clearedCookies) {
      expect(cookie.options).toMatchObject({
        maxAge: -1,
        secure: true,
        sameSite: "none",
        httpOnly: true,
        path: "/",
      });
      expect(cookie.options).not.toHaveProperty("domain");
    }
  });

  it("keeps plain-HTTP local logout cookies compatible", async () => {
    const { ctx, clearedCookies } = createAuthContext("http");
    const result = await appRouter.createCaller(ctx).auth.logout();

    expect(result).toEqual({ success: true });
    expect(clearedCookies.map((cookie) => cookie.name)).toEqual([
      "webdev_app_session",
      getSessionCookieName(ctx.req),
    ]);
    for (const cookie of clearedCookies) {
      expect(cookie.options).toMatchObject({
        maxAge: -1,
        secure: false,
        sameSite: "lax",
        httpOnly: true,
        path: "/",
      });
    }
  });
});
