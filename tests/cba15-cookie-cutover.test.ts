import type { Request, Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LEGACY_APPLICATION_SESSION_COOKIE_NAME,
  canIssueSessionCookie,
  clearAcceptedSessionCookies,
  clearLegacySessionCookie,
  currentSessionCookie,
  getSessionCookieName,
  setSessionCookie,
} from "../server/_core/cookies";
import { SDKServer } from "../server/_core/sdk";
import { LEGACY_COOKIE_NAME, SESSION_COOKIE_SUFFIX } from "../shared/const";

vi.hoisted(() => {
  // Synthetic test-only settings; no deployment configuration is read.
  process.env.MANUS_PROJECT_ID = "cba15-cookie-cutover";
  process.env.MANUS_JWT_SECRET =
    "cba15-synthetic-cookie-cutover-signing-secret";
  process.env.MANUS_OAUTH_API_URL = "https://oauth.synthetic.invalid";
});

function secureRequest(cookie?: string): Request {
  return {
    protocol: "https",
    hostname: "api.synthetic.invalid",
    headers: cookie ? { cookie } : {},
  } as Request;
}

describe("CBA-15 host-prefixed browser session cutover", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("uses only the __Host- cookie as HTTPS identity when a generic duplicate is present", async () => {
    const request = secureRequest();
    const hostCookieName = getSessionCookieName(request);
    expect(hostCookieName).toBe(
      `__Host-manus_session_${SESSION_COOKIE_SUFFIX}`,
    );

    const server = new SDKServer();
    const verifySession = vi
      .spyOn(server, "verifySession")
      .mockResolvedValue(null);

    await expect(
      server.authenticateRequest(
        secureRequest(
          `${LEGACY_APPLICATION_SESSION_COOKIE_NAME}=attacker-session; ${hostCookieName}=host-session`,
        ),
      ),
    ).rejects.toThrow("Invalid session cookie");
    expect(verifySession).toHaveBeenLastCalledWith("host-session");
    expect(
      currentSessionCookie(
        secureRequest(
          `${LEGACY_APPLICATION_SESSION_COOKIE_NAME}=attacker-session`,
        ),
      ),
    ).toBeUndefined();

    await expect(
      server.authenticateRequest(
        secureRequest(
          `${LEGACY_APPLICATION_SESSION_COOKIE_NAME}=attacker-session`,
        ),
      ),
    ).rejects.toThrow("Invalid session cookie");
    expect(verifySession).toHaveBeenLastCalledWith(undefined);
  });

  it("issues the secure host-only cookie or the distinct loopback development cookie, never generic HTTP identity", () => {
    const issued: {
      name: string;
      value: string;
      options: Record<string, unknown>;
    }[] = [];
    const response = {
      cookie: (
        name: string,
        value: string,
        options: Record<string, unknown>,
      ) => {
        issued.push({ name, value, options });
      },
    } as unknown as Response;

    const secure = secureRequest();
    expect(setSessionCookie(secure, response, "secure-token", 60_000)).toBe(
      true,
    );
    expect(issued).toEqual([
      {
        name: `__Host-manus_session_${SESSION_COOKIE_SUFFIX}`,
        value: "secure-token",
        options: {
          httpOnly: true,
          path: "/",
          sameSite: "none",
          secure: true,
          maxAge: 60_000,
        },
      },
    ]);

    const insecureRemote = {
      protocol: "http",
      hostname: "api.synthetic.invalid",
      headers: {},
    } as Request;
    expect(canIssueSessionCookie(insecureRemote)).toBe(false);
    expect(setSessionCookie(insecureRemote, response, "rejected", 60_000)).toBe(
      false,
    );
    expect(issued).toHaveLength(1);

    const loopback = {
      protocol: "http",
      hostname: "127.0.0.1",
      headers: {},
    } as Request;
    expect(canIssueSessionCookie(loopback)).toBe(true);
    expect(setSessionCookie(loopback, response, "local-token", 60_000)).toBe(
      true,
    );
    expect(issued[1]).toEqual({
      name: `manus_local_session_${SESSION_COOKIE_SUFFIX}`,
      value: "local-token",
      options: {
        httpOnly: true,
        path: "/",
        sameSite: "lax",
        secure: false,
        maxAge: 60_000,
      },
    });
  });

  it("expires host-only and parent-domain historical cookies on a configured Preview API host", () => {
    // Synthetic Preview configuration only; no deployment configuration is read.
    vi.stubEnv(
      "EXPO_PACKAGER_PROXY_URL",
      "https://8081-cba15.preview.manus.com",
    );
    const request = {
      protocol: "https",
      hostname: "3000-cba15.preview.manus.com",
      headers: {},
    } as Request;
    const cleared: { name: string; options: Record<string, unknown> }[] = [];
    const response = {
      clearCookie: (name: string, options: Record<string, unknown>) => {
        cleared.push({ name, options });
      },
    } as unknown as Response;

    clearAcceptedSessionCookies(request, response);

    expect(cleared).toEqual([
      {
        name: LEGACY_APPLICATION_SESSION_COOKIE_NAME,
        options: {
          httpOnly: true,
          path: "/",
          sameSite: "none",
          secure: true,
        },
      },
      {
        name: LEGACY_APPLICATION_SESSION_COOKIE_NAME,
        options: {
          domain: ".manus.com",
          httpOnly: true,
          path: "/",
          sameSite: "none",
          secure: true,
        },
      },
      {
        name: LEGACY_COOKIE_NAME,
        options: {
          httpOnly: true,
          path: "/",
          sameSite: "none",
          secure: true,
        },
      },
      {
        name: LEGACY_COOKIE_NAME,
        options: {
          domain: ".manus.com",
          httpOnly: true,
          path: "/",
          sameSite: "none",
          secure: true,
        },
      },
      {
        name: `__Host-manus_session_${SESSION_COOKIE_SUFFIX}`,
        options: {
          httpOnly: true,
          path: "/",
          sameSite: "none",
          secure: true,
        },
      },
    ]);

    const next = vi.fn();
    clearLegacySessionCookie()(request, response, next);
    expect(next).toHaveBeenCalledOnce();
    expect(cleared.slice(5)).toEqual([
      {
        name: LEGACY_COOKIE_NAME,
        options: {
          httpOnly: true,
          path: "/",
          sameSite: "none",
          secure: true,
        },
      },
      {
        name: LEGACY_COOKIE_NAME,
        options: {
          domain: ".manus.com",
          httpOnly: true,
          path: "/",
          sameSite: "none",
          secure: true,
        },
      },
    ]);
  });

  it("clears generic and historical legacy cookie names on logout without making either an identity input", () => {
    const cleared: { name: string; options: Record<string, unknown> }[] = [];
    clearAcceptedSessionCookies(secureRequest(), {
      clearCookie: (name: string, options: Record<string, unknown>) => {
        cleared.push({ name, options });
      },
    } as unknown as Response);

    expect(cleared.map((entry) => entry.name)).toEqual([
      LEGACY_APPLICATION_SESSION_COOKIE_NAME,
      LEGACY_COOKIE_NAME,
      `__Host-manus_session_${SESSION_COOKIE_SUFFIX}`,
    ]);
    for (const entry of cleared) {
      expect(entry.options).toMatchObject({
        httpOnly: true,
        path: "/",
        sameSite: "none",
        secure: true,
      });
      expect(entry.options).not.toHaveProperty("domain");
    }
  });
});
