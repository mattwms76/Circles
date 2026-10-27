import { randomBytes } from "node:crypto";
import {
  APPLICATION_SESSION_TTL_MS,
  AXIOS_TIMEOUT_MS,
} from "../../shared/const.js";
import { ForbiddenError } from "../../shared/_core/errors.js";
import { create as createAxios, type AxiosInstance } from "axios";
import { parse as parseCookieHeader } from "cookie";
import type { Request } from "express";
import { SignJWT, jwtVerify } from "jose";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import {
  applicationSessionStore,
  type ApplicationSessionBinding,
  type ApplicationSessionStore,
} from "./application-sessions";
import { ENV } from "./env";
import {
  APPLICATION_SESSION_COOKIE_NAME,
  currentSessionCookie,
} from "./cookies";
import type {
  ExchangeTokenRequest,
  ExchangeTokenResponse,
  GetUserInfoResponse,
  GetUserInfoWithJwtRequest,
  GetUserInfoWithJwtResponse,
} from "./types/manusTypes";
// Utility function
const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

export type SessionPayload = {
  openId: string;
  appId: string;
  name: string;
  /** Optional for legacy sessions; email sessions bind the original numeric actor. */
  userId?: number;
};

type VerifiedApplicationSession = SessionPayload & ApplicationSessionBinding;

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

const EXCHANGE_TOKEN_PATH = `/webdev.v1.WebDevAuthPublicService/ExchangeToken`;
const GET_USER_INFO_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfo`;
const GET_USER_INFO_WITH_JWT_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfoWithJwt`;

class OAuthService {
  constructor(private client: AxiosInstance) {
    console.log("[OAuth] Client initialized");
    if (!ENV.oAuthServerUrl) {
      console.error(
        "[OAuth] ERROR: OAUTH_SERVER_URL is not configured! Set OAUTH_SERVER_URL environment variable.",
      );
    }
  }

  private decodeState(state: string): string {
    // Manus state is base64 JSON ({ redirectUri, nonce }). The nonce is verified
    // by the callback route before this exchange; the OAuth API needs only the
    // redirect URI. Retain legacy base64 redirect-only state decoding for any
    // in-flight pre-hardening login started before this deployment.
    const decoded = Buffer.from(state, "base64").toString("utf8");
    try {
      const value: unknown = JSON.parse(decoded);
      if (
        value &&
        typeof value === "object" &&
        typeof (value as Record<string, unknown>).redirectUri === "string"
      ) {
        return (value as { redirectUri: string }).redirectUri;
      }
    } catch {
      // Legacy state was the redirect URI itself, not JSON.
    }
    if (!decoded) throw new Error("Invalid OAuth state");
    return decoded;
  }

  async getTokenByCode(
    code: string,
    state: string,
  ): Promise<ExchangeTokenResponse> {
    const payload: ExchangeTokenRequest = {
      clientId: ENV.appId,
      grantType: "authorization_code",
      code,
      redirectUri: this.decodeState(state),
    };

    const { data } = await this.client.post<ExchangeTokenResponse>(
      EXCHANGE_TOKEN_PATH,
      payload,
    );

    return data;
  }

  async getUserInfoByToken(
    token: ExchangeTokenResponse,
  ): Promise<GetUserInfoResponse> {
    const { data } = await this.client.post<GetUserInfoResponse>(
      GET_USER_INFO_PATH,
      {
        accessToken: token.accessToken,
      },
    );

    return data;
  }
}

const createOAuthHttpClient = (): AxiosInstance =>
  createAxios({
    baseURL: ENV.oAuthServerUrl,
    timeout: AXIOS_TIMEOUT_MS,
  });

export class SDKServer {
  private readonly client: AxiosInstance;
  private readonly oauthService: OAuthService;

  constructor(
    client: AxiosInstance = createOAuthHttpClient(),
    private readonly sessionStore: ApplicationSessionStore = applicationSessionStore,
  ) {
    this.client = client;
    this.oauthService = new OAuthService(this.client);
  }

  private deriveLoginMethod(
    platforms: unknown,
    fallback: string | null | undefined,
  ): string | null {
    if (fallback && fallback.length > 0) return fallback;
    if (!Array.isArray(platforms) || platforms.length === 0) return null;
    const set = new Set<string>(
      platforms.filter((p): p is string => typeof p === "string"),
    );
    if (set.has("REGISTERED_PLATFORM_EMAIL")) return "email";
    if (set.has("REGISTERED_PLATFORM_GOOGLE")) return "google";
    if (set.has("REGISTERED_PLATFORM_APPLE")) return "apple";
    if (
      set.has("REGISTERED_PLATFORM_MICROSOFT") ||
      set.has("REGISTERED_PLATFORM_AZURE")
    )
      return "microsoft";
    if (set.has("REGISTERED_PLATFORM_GITHUB")) return "github";
    const first = Array.from(set)[0];
    return first ? first.toLowerCase() : null;
  }

  /**
   * Exchange OAuth authorization code for access token
   * @example
   * const tokenResponse = await sdk.exchangeCodeForToken(code, state);
   */
  async exchangeCodeForToken(
    code: string,
    state: string,
  ): Promise<ExchangeTokenResponse> {
    return this.oauthService.getTokenByCode(code, state);
  }

  /**
   * Get user information using access token
   * @example
   * const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
   */
  async getUserInfo(accessToken: string): Promise<GetUserInfoResponse> {
    const data = await this.oauthService.getUserInfoByToken({
      accessToken,
    } as ExchangeTokenResponse);
    const loginMethod = this.deriveLoginMethod(
      (data as any)?.platforms,
      (data as any)?.platform ?? data.platform ?? null,
    );
    return {
      ...(data as any),
      platform: loginMethod,
      loginMethod,
    } as GetUserInfoResponse;
  }

  private getSessionSecret() {
    const secret = ENV.cookieSecret;
    return new TextEncoder().encode(secret);
  }

  /**
   * Create a session token for a Manus user openId
   * @example
   * const sessionToken = await sdk.createSessionToken(userInfo.openId);
   */
  async createSessionToken(
    openId: string,
    options: { expiresInMs?: number; name?: string; userId?: number } = {},
  ): Promise<string> {
    return this.signSession(
      {
        openId,
        appId: ENV.appId,
        name: options.name || "",
        ...(options.userId !== undefined ? { userId: options.userId } : {}),
      },
      options,
    );
  }

  async signSession(
    payload: SessionPayload,
    options: { expiresInMs?: number } = {},
  ): Promise<string> {
    const issuedAt = Date.now();
    const requestedLifetime = options.expiresInMs ?? APPLICATION_SESSION_TTL_MS;
    if (!Number.isFinite(requestedLifetime) || requestedLifetime <= 0) {
      throw new Error("Application session lifetime must be positive");
    }
    if (
      payload.userId !== undefined &&
      (!Number.isSafeInteger(payload.userId) || payload.userId <= 0)
    ) {
      throw new Error(
        "Application session actor binding must be a positive integer",
      );
    }
    const expiresInMs = Math.min(requestedLifetime, APPLICATION_SESSION_TTL_MS);
    const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1000);
    const sessionId = randomBytes(32).toString("base64url");
    const secretKey = this.getSessionSecret();

    const token = await new SignJWT({
      openId: payload.openId,
      appId: payload.appId,
      name: payload.name,
      ...(payload.userId !== undefined ? { userId: payload.userId } : {}),
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuedAt(Math.floor(issuedAt / 1000))
      .setJti(sessionId)
      .setExpirationTime(expirationSeconds)
      .sign(secretKey);
    // A token is returned only after durable authority exists. If the store is
    // absent (including before its migration), login fails rather than issuing
    // another self-contained, non-revocable credential.
    await this.sessionStore.create({
      sessionId,
      openId: payload.openId,
      appId: payload.appId,
      expiresAt: new Date(expirationSeconds * 1000),
    });
    return token;
  }

  private async verifySignedSession(
    token: string | undefined | null,
  ): Promise<VerifiedApplicationSession | null> {
    if (!token) return null;
    try {
      const secretKey = this.getSessionSecret();
      const { payload } = await jwtVerify(token, secretKey, {
        algorithms: ["HS256"],
      });
      const { openId, appId, name, jti, userId } = payload as Record<
        string,
        unknown
      >;

      if (
        !isNonEmptyString(openId) ||
        !isNonEmptyString(appId) ||
        typeof name !== "string" ||
        !isNonEmptyString(jti) ||
        !SESSION_ID_PATTERN.test(jti)
      ) {
        return null;
      }

      if (
        userId !== undefined &&
        (typeof userId !== "number" ||
          !Number.isSafeInteger(userId) ||
          userId <= 0)
      ) {
        return null;
      }
      if (appId !== ENV.appId) {
        return null;
      }

      return {
        openId,
        appId,
        name,
        sessionId: jti,
        ...(typeof userId === "number" ? { userId } : {}),
      };
    } catch {
      return null;
    }
  }

  async verifySession(
    cookieValue: string | undefined | null,
  ): Promise<SessionPayload | null> {
    const session = await this.verifySignedSession(cookieValue);
    if (!session) {
      console.warn("[Auth] Session verification failed");
      return null;
    }

    try {
      const persisted = await this.sessionStore.findActive(session, new Date());
      if (
        !persisted ||
        persisted.sessionId !== session.sessionId ||
        persisted.openId !== session.openId ||
        persisted.appId !== session.appId ||
        persisted.revokedAt !== null ||
        persisted.expiresAt <= new Date()
      ) {
        console.warn("[Auth] Session is inactive");
        return null;
      }
      return {
        openId: session.openId,
        appId: session.appId,
        name: session.name,
        ...(session.userId !== undefined ? { userId: session.userId } : {}),
      };
    } catch {
      // Database errors and a missing pre-cutover table are authentication
      // failures; SDK/OAuth fallback must never restore JWT-only authority.
      console.warn("[Auth] Persistent session validation unavailable");
      return null;
    }
  }

  /** Revokes each distinct valid app credential presented on a logout request. */
  async revokeRequestSessions(req: Request): Promise<void> {
    const authHeader = req.headers.authorization || req.headers.Authorization;
    const bearer =
      typeof authHeader === "string" && authHeader.startsWith("Bearer ")
        ? authHeader.slice("Bearer ".length).trim()
        : undefined;
    const parsedCookies = req.headers.cookie
      ? parseCookieHeader(req.headers.cookie)
      : {};
    const candidates = [
      bearer,
      parsedCookies[APPLICATION_SESSION_COOKIE_NAME],
      currentSessionCookie(req),
    ];

    const seen = new Set<string>();
    for (const candidate of candidates) {
      if (!candidate || seen.has(candidate)) continue;
      seen.add(candidate);
      const session = await this.verifySignedSession(candidate);
      if (session) await this.sessionStore.revoke(session, new Date());
    }
  }

  async getUserInfoWithJwt(
    jwtToken: string,
  ): Promise<GetUserInfoWithJwtResponse> {
    const payload: GetUserInfoWithJwtRequest = {
      jwtToken,
      projectId: ENV.appId,
    };

    const { data } = await this.client.post<GetUserInfoWithJwtResponse>(
      GET_USER_INFO_WITH_JWT_PATH,
      payload,
    );

    const loginMethod = this.deriveLoginMethod(
      (data as any)?.platforms,
      (data as any)?.platform ?? data.platform ?? null,
    );
    return {
      ...(data as any),
      platform: loginMethod,
      loginMethod,
    } as GetUserInfoWithJwtResponse;
  }

  async authenticateRequest(req: Request): Promise<AuthenticatedUser> {
    // Regular authentication flow
    const authHeader = req.headers.authorization || req.headers.Authorization;
    let token: string | undefined;
    if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
      token = authHeader.slice("Bearer ".length).trim();
    }

    const exactApplicationCookie = req.headers.cookie
      ? parseCookieHeader(req.headers.cookie)[APPLICATION_SESSION_COOKIE_NAME]
      : undefined;
    const sessionCookie =
      token || exactApplicationCookie || currentSessionCookie(req);
    const session = await this.verifySession(sessionCookie);

    if (!session) {
      throw ForbiddenError("Invalid session cookie");
    }

    if (session.openId.startsWith(CRON_OPEN_ID_PREFIX)) {
      const userInfo = await this.getUserInfoWithJwt(sessionCookie ?? "");
      const taskUid = userInfo.taskUid ?? null;
      if (!taskUid) {
        throw ForbiddenError("Cron session missing task_uid");
      }
      return buildCronUser(userInfo);
    }

    const sessionUserId = session.openId;
    const signedInAt = new Date();
    let user = await db.getUserByOpenId(sessionUserId);

    if (session.userId !== undefined && (!user || user.id !== session.userId)) {
      throw ForbiddenError("Session actor binding is no longer valid");
    }
    // If user not in DB, sync from OAuth server automatically
    if (!user) {
      try {
        const userInfo = await this.getUserInfoWithJwt(sessionCookie ?? "");
        await db.upsertUser({
          openId: userInfo.openId,
          name: userInfo.name || null,
          email: userInfo.email ?? null,
          loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
          lastSignedIn: signedInAt,
        });
        user = await db.getUserByOpenId(userInfo.openId);
      } catch {
        console.error("[Auth] Failed to sync user from OAuth");
        throw ForbiddenError("Failed to sync user info");
      }
    }

    if (!user) {
      throw ForbiddenError("User not found");
    }

    await db.upsertUser({
      openId: user.openId,
      lastSignedIn: signedInAt,
    });

    return user;
  }
}

const CRON_OPEN_ID_PREFIX = "cron_";

/** Result of `sdk.authenticateRequest`. Cron callbacks set `isCron=true` and `taskUid`; see `/home/ubuntu/skills/webdev-periodic-updates/SKILL.md`. */
export type AuthenticatedUser = User & {
  taskUid?: string;
  isCron?: boolean;
};

function buildCronUser(
  userInfo: GetUserInfoWithJwtResponse,
): AuthenticatedUser {
  const now = new Date();
  return {
    id: -1,
    openId: userInfo.openId,
    name: userInfo.name || "Manus Scheduled Task",
    email: null,
    loginMethod: null,
    role: "user",
    createdAt: now,
    updatedAt: now,
    lastSignedIn: now,
    taskUid: userInfo.taskUid ?? undefined,
    isCron: true,
  } as AuthenticatedUser;
}

export const sdk = new SDKServer();
