import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  gt,
  ilike,
  inArray,
  isNull,
  lt,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { TRPCError } from "@trpc/server";
import {
  isTrustedStarterMediaUrl,
  managedSocialMediaKeyFromUrl,
  managedSocialMediaUrlForKey,
} from "../shared/media";
import {
  bookmarks,
  circles,
  comments,
  conversationParticipants,
  conversations,
  follows,
  memberships,
  messages,
  posts,
  profiles,
  reactions,
  reports,
  socialUploads,
  users,
} from "../drizzle/schema";
import {
  postPublishReceiptInsertProjection,
  postPublishReceipts,
} from "../drizzle/post-publish-receipt-schema";
import { streams } from "../drizzle/live-schema";
import type {
  Circle,
  Comment,
  Conversation,
  Member,
  Message,
  Post,
  Profile,
} from "../shared/social";
import { INTEREST_IDS } from "../shared/onboarding";
import {
  MESSAGE_PAGE_DEFAULT_LIMIT,
  MESSAGE_PAGE_MAX_LIMIT,
} from "../shared/message-pagination";
import {
  CIRCLE_HOME_ID_MAX,
  CIRCLE_HOME_RULE_MAX,
  CIRCLE_HOME_RULES_MAX,
  CIRCLE_HOME_WELCOME_MAX,
  circleHomeRuleKey,
  circleHomeTextLength,
  type CircleHome,
  type CircleHomePinInput,
  type CircleHomeTextInput,
} from "../shared/circle-home";
import { getDb, type CirclesDatabase, type CirclesTransaction } from "./db";
import { assertPlatformFeature } from "./platform-settings";
import { getPostPublicationStatus as getDatabasePostPublicationStatus } from "./_core/database-contracts";
import {
  recordCommentActivity,
  recordMembershipApprovalActivity,
} from "./activity-events";
import { recordModerationReport } from "./moderation-events";

export type CircleRole = "owner" | "moderator" | "member" | "pending";
type ApprovedCircleRole = Exclude<CircleRole, "pending">;
type Database = CirclesDatabase;
type ConversationMutationTransaction = CirclesTransaction;
type SocialTransaction = CirclesTransaction;
type FeedFilter = "for-you" | "following" | "circles" | "saved";

const APPROVED_ROLES: readonly ApprovedCircleRole[] = [
  "owner",
  "moderator",
  "member",
];
const DEFAULT_AVATAR = "";
const MEDIA_ENCRYPTION_MAGIC = Buffer.from("CIRMED01", "ascii");
const MEDIA_ENCRYPTION_IV_BYTES = 12;
const MEDIA_ENCRYPTION_TAG_BYTES = 16;
/** Bytes added to each encrypted social upload's self-contained binary frame. */
export const SOCIAL_MEDIA_FRAME_OVERHEAD =
  MEDIA_ENCRYPTION_MAGIC.length +
  MEDIA_ENCRYPTION_IV_BYTES +
  MEDIA_ENCRYPTION_TAG_BYTES;

function socialError(code: TRPCError["code"], message: string): never {
  throw new TRPCError({ code, message });
}

function normalizeCircleHomeId(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > CIRCLE_HOME_ID_MAX
  ) {
    socialError("BAD_REQUEST", "Invalid circle home identifier");
  }
  return value;
}

/** Defense in depth for direct server callers; routers apply the same public bounds. */
export function normalizeCircleHomeTextInput(
  input: CircleHomeTextInput,
): CircleHomeTextInput {
  const circleId = normalizeCircleHomeId(input.circleId);
  if (typeof input.welcomeMessage !== "string") {
    socialError("BAD_REQUEST", "Welcome message must be plain text");
  }
  const welcomeMessage = input.welcomeMessage.trim();
  if (circleHomeTextLength(welcomeMessage) > CIRCLE_HOME_WELCOME_MAX) {
    socialError("BAD_REQUEST", "Welcome message is too long");
  }
  if (
    !Array.isArray(input.rules) ||
    input.rules.length > CIRCLE_HOME_RULES_MAX
  ) {
    socialError("BAD_REQUEST", "Too many circle rules");
  }

  const seenRules = new Set<string>();
  const rules = input.rules.map((rule) => {
    if (typeof rule !== "string") {
      socialError("BAD_REQUEST", "Circle rules must be plain text");
    }
    if (/[\r\n]/.test(rule)) {
      socialError("BAD_REQUEST", "Circle rules must be single-line");
    }
    const normalized = rule.trim();
    if (
      !normalized ||
      circleHomeTextLength(normalized) > CIRCLE_HOME_RULE_MAX
    ) {
      socialError("BAD_REQUEST", "Circle rule is blank or too long");
    }
    const duplicateKey = circleHomeRuleKey(normalized);
    if (seenRules.has(duplicateKey)) {
      socialError("BAD_REQUEST", "Circle rules must be unique");
    }
    seenRules.add(duplicateKey);
    return normalized;
  });

  return { circleId, welcomeMessage, rules };
}

/** Defense in depth for direct server callers; `null` is the only explicit unpin state. */
export function normalizeCircleHomePinInput(
  input: CircleHomePinInput,
): CircleHomePinInput {
  const circleId = normalizeCircleHomeId(input.circleId);
  if (input.postId === null) return { circleId, postId: null };
  return { circleId, postId: normalizeCircleHomeId(input.postId) };
}

/**
 * Encrypts a social upload as `magic | iv | GCM auth tag | ciphertext`.
 *
 * The key is intentionally derived at use time rather than stored. This MVP therefore requires
 * MANUS_JWT_SECRET to remain stable; rotating it makes existing encrypted uploads unreadable.
 */
export function encryptSocialMedia(
  plaintext: Buffer,
  secret: string | undefined = process.env.MANUS_JWT_SECRET,
): Buffer {
  if (!secret) throw new Error("Social media encryption is unavailable");
  const key = createHash("sha256")
    .update(secret)
    .update("circles-media-v1")
    .digest();
  const iv = randomBytes(MEDIA_ENCRYPTION_IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([
    MEDIA_ENCRYPTION_MAGIC,
    iv,
    cipher.getAuthTag(),
    ciphertext,
  ]);
}

/** Decrypts and authenticates the binary social-upload frame; malformed/tampered data fails closed. */
export function decryptSocialMedia(
  framed: Buffer,
  secret: string | undefined = process.env.MANUS_JWT_SECRET,
): Buffer {
  if (!secret) throw new Error("Social media encryption is unavailable");
  if (
    framed.length < SOCIAL_MEDIA_FRAME_OVERHEAD ||
    !framed
      .subarray(0, MEDIA_ENCRYPTION_MAGIC.length)
      .equals(MEDIA_ENCRYPTION_MAGIC)
  ) {
    throw new Error("Invalid encrypted social media frame");
  }
  const key = createHash("sha256")
    .update(secret)
    .update("circles-media-v1")
    .digest();
  const ivStart = MEDIA_ENCRYPTION_MAGIC.length;
  const tagStart = ivStart + MEDIA_ENCRYPTION_IV_BYTES;
  const ciphertextStart = tagStart + MEDIA_ENCRYPTION_TAG_BYTES;
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    framed.subarray(ivStart, tagStart),
  );
  decipher.setAuthTag(framed.subarray(tagStart, ciphertextStart));
  return Buffer.concat([
    decipher.update(framed.subarray(ciphertextStart)),
    decipher.final(),
  ]);
}

async function requireDb(): Promise<Database> {
  const db = await getDb();
  if (!db) socialError("PRECONDITION_FAILED", "Database is unavailable");
  return db;
}

function countValue(value: unknown): number {
  const count = Number(value ?? 0);
  return Number.isFinite(count) ? count : 0;
}

function toIso(value: Date): string {
  return value.toISOString();
}

function isPostgresUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

const POST_PUBLISH_OPERATION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{15,95}$/;

export type PostPublishInput = {
  text: string;
  media?: string;
  mediaType: "text" | "photo" | "video";
  circleId?: number;
  /** Optional during rollout; supplied IDs make a publication attempt durable and exact. */
  clientPublishId?: string;
};

/** The exact canonical payload stored only as a one-way receipt hash, never post content itself. */
export function postPublicationPayloadHash(
  input: Pick<PostPublishInput, "text" | "media" | "mediaType" | "circleId">,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        text: input.text.trim(),
        media: input.media?.trim() || null,
        mediaType: input.mediaType,
        circleId: input.circleId ?? null,
      }),
    )
    .digest("hex");
}

/** Direct service callers receive the same bounded nonce contract as the public router. */
function assertPostPublishOperationId(value: string | undefined): void {
  if (value === undefined) return;
  if (!POST_PUBLISH_OPERATION_ID.test(value)) {
    socialError("BAD_REQUEST", "Invalid publication operation identifier");
  }
}

/** A prepared-but-not-applied private receipt migration must never degrade retries to new posts. */
function isMissingPostPublishReceiptSchema(error: unknown): boolean {
  let current: unknown = error;
  // Drizzle preserves PostgreSQL's SQLSTATE on a driver error nested in `cause`.
  for (let depth = 0; depth < 3; depth += 1) {
    if (typeof current !== "object" || current === null) return false;
    const value = current as { code?: unknown; cause?: unknown };
    if (value.code === "42P01" || value.code === "3F000") return true;
    current = value.cause;
  }
  return false;
}

export type PostPublicationStatus = { ready: boolean };

/**
 * A protected composer may make this catalog-only probe before it uploads bytes. The DB-14
 * helper preserves this API shape and fails closed for a missing/prepared or drifted contract.
 */
export async function getPostPublicationStatus(): Promise<PostPublicationStatus> {
  return getDatabasePostPublicationStatus();
}

/** Pure role predicate used by every private-circle gate. */
export function isApprovedCircleRole(
  role: CircleRole | null | undefined,
): role is ApprovedCircleRole {
  return (
    role !== null &&
    role !== undefined &&
    APPROVED_ROLES.includes(role as ApprovedCircleRole)
  );
}

/** Owners and moderators may moderate circle posts and pending applications. */
export function canModerateCircle(
  role: CircleRole | null | undefined,
): boolean {
  return role === "owner" || role === "moderator";
}

/** Pending join requests are visible only to the owner or a moderator. */
export function canViewPendingMembers(
  role: CircleRole | null | undefined,
): boolean {
  return canModerateCircle(role);
}

/** Only an owner can promote or demote a non-owner member. */
export function canSetCircleRole(
  actorRole: CircleRole | null | undefined,
  targetRole: CircleRole | null | undefined,
): boolean {
  return (
    actorRole === "owner" &&
    targetRole !== null &&
    targetRole !== undefined &&
    targetRole !== "owner"
  );
}

/** Moderators cannot remove owners or peer moderators; owners retain final control. */
export function canRemoveCircleMember(
  actorRole: CircleRole | null | undefined,
  targetRole: CircleRole | null | undefined,
): boolean {
  if (!targetRole || targetRole === "owner") return false;
  if (actorRole === "owner") return true;
  return (
    actorRole === "moderator" &&
    (targetRole === "member" || targetRole === "pending")
  );
}

/** Public circles are readable by everyone; private circles require an approved role. */
export function canReadCircleContent(
  privacy: "public" | "private",
  role: CircleRole | null | undefined,
): boolean {
  return privacy === "public" || isApprovedCircleRole(role);
}

async function membershipRoleWithDb(
  db: Database | SocialTransaction,
  userId: number | null | undefined,
  circleId: number,
): Promise<CircleRole | null> {
  if (!userId) return null;
  const rows = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(
      and(eq(memberships.circleId, circleId), eq(memberships.userId, userId)),
    )
    .limit(1);
  return (rows[0]?.role as CircleRole | undefined) ?? null;
}

async function circleRowOrThrow(
  db: Database | SocialTransaction,
  circleId: number,
) {
  const rows = await db
    .select()
    .from(circles)
    .where(eq(circles.id, circleId))
    .limit(1);
  if (!rows[0]) socialError("NOT_FOUND", "Circle not found");
  return rows[0];
}

/**
 * Membership removal and every protected circle write take this same parent-row lock. A removal
 * that commits first therefore makes the later write re-check fail; a write that commits first is
 * the last action authorized by the still-approved membership.
 */
async function lockCircleForProtectedMutation(
  tx: SocialTransaction,
  circleId: number,
) {
  const rows = await tx
    .select()
    .from(circles)
    .where(eq(circles.id, circleId))
    .limit(1)
    .for("update");
  if (!rows[0]) socialError("NOT_FOUND", "Circle not found");
  return rows[0];
}

/**
 * Private DTO readers share this parent-row lock with membership removal. `FOR SHARE` permits
 * concurrent readers but conflicts with the remover's `FOR UPDATE`, so a projection is either
 * the final one for an approved role or it rechecks the already-revoked role before mapping.
 */
async function lockCircleForProtectedRead(
  tx: SocialTransaction,
  circleId: number,
) {
  const rows = await tx
    .select()
    .from(circles)
    .where(eq(circles.id, circleId))
    .limit(1)
    .for("share");
  if (!rows[0]) socialError("NOT_FOUND", "Circle not found");
  return rows[0];
}

async function lockCircleAccessForProtectedMutation(
  tx: SocialTransaction,
  userId: number,
  circleId: number,
) {
  const circle = await lockCircleForProtectedMutation(tx, circleId);
  const role = await membershipRoleWithDb(tx, userId, circleId);
  return { circle, role };
}

async function lockCircleAccessForProtectedRead(
  tx: SocialTransaction,
  userId: number | null,
  circleId: number,
) {
  const circle = await lockCircleForProtectedRead(tx, circleId);
  const role = await membershipRoleWithDb(tx, userId, circleId);
  return { circle, role };
}

/**
 * Reads current circle-content authority under the same parent SHARE lock used by every private
 * DTO projection. A removal that already holds the parent UPDATE lock wins and is rechecked as a
 * denial; a read that acquired SHARE first completes its DTO before the remover can commit.
 */
export async function getCircleContentAccessForProtectedRead(
  tx: SocialTransaction,
  userId: number | null,
  circleId: number,
): Promise<{ privacy: "public" | "private"; role: CircleRole | null } | null> {
  const { circle, role } = await lockCircleAccessForProtectedRead(
    tx,
    userId,
    circleId,
  );
  if (!canReadCircleContent(circle.privacy, role)) return null;
  return { privacy: circle.privacy, role };
}

async function postRowOrThrow(
  db: Database | SocialTransaction,
  postId: number,
) {
  const rows = await db
    .select()
    .from(posts)
    .where(eq(posts.id, postId))
    .limit(1);
  if (!rows[0]) socialError("NOT_FOUND", "Post not found");
  return rows[0];
}

async function findProfileWithDb(
  db: Database | SocialTransaction,
  userId: number,
  viewerId: number | null = null,
): Promise<Profile | null> {
  const profileRows = await db
    .select()
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);
  const profile = profileRows[0];
  if (!profile) return null;

  const [followersResult, followingResult, followingRows] = await Promise.all([
    db
      .select({ total: sql<number>`count(*)` })
      .from(follows)
      .where(eq(follows.followingId, userId)),
    db
      .select({ total: sql<number>`count(*)` })
      .from(follows)
      .where(eq(follows.followerId, userId)),
    viewerId
      ? db
          .select({ id: follows.id })
          .from(follows)
          .where(
            and(
              eq(follows.followerId, viewerId),
              eq(follows.followingId, userId),
            ),
          )
          .limit(1)
      : Promise.resolve([]),
  ]);

  return {
    id: profile.userId,
    name: profile.name,
    handle: profile.handle,
    bio: profile.bio,
    avatar: profile.avatar,
    ...(profile.cover ? { cover: profile.cover } : {}),
    followers: countValue(followersResult[0]?.total),
    following: countValue(followingResult[0]?.total),
    ...(viewerId ? { isFollowing: followingRows.length > 0 } : {}),
  };
}

async function ensureProfileWithDb(
  db: Database | SocialTransaction,
  userId: number,
): Promise<Profile> {
  const existing = await findProfileWithDb(db, userId, userId);
  if (existing) return existing;

  const userRows = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const user = userRows[0];
  if (!user) socialError("NOT_FOUND", "User not found");

  const name = user.name?.trim() || "Circles member";
  await db
    .insert(profiles)
    .values({
      userId,
      name,
      handle: `member-${userId}`,
      bio: "",
      avatar: DEFAULT_AVATAR,
    })
    // A parallel authenticated action may have materialized the same profile first.
    .onConflictDoNothing({ target: profiles.userId });

  const profile = await findProfileWithDb(db, userId, userId);
  if (!profile)
    socialError("INTERNAL_SERVER_ERROR", "Unable to create profile");
  return profile;
}

async function displayProfileWithDb(
  db: Database | SocialTransaction,
  userId: number,
  viewerId: number | null = null,
): Promise<Profile> {
  const existing = await findProfileWithDb(db, userId, viewerId);
  if (existing) return existing;

  const userRows = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const name = userRows[0]?.name?.trim() || "Circles member";
  return {
    id: userId,
    name,
    handle: `member-${userId}`,
    bio: "",
    avatar: DEFAULT_AVATAR,
    followers: 0,
    following: 0,
    ...(viewerId ? { isFollowing: false } : {}),
  };
}

/**
 * Returns a stable display shape without creating a social row. Live discovery uses this for
 * historic or orphaned streams so a public read cannot materialize a host profile.
 */
export async function getDisplayProfile(userId: number): Promise<Profile> {
  const db = await requireDb();
  return displayProfileWithDb(db, userId);
}

/**
 * Read-only formatters that already own a protected transaction use this instead of reopening an
 * unlocked database read. It deliberately never materializes a profile row.
 */
export async function getDisplayProfileWithDb(
  db: Database | SocialTransaction,
  userId: number,
): Promise<Profile> {
  return displayProfileWithDb(db, userId);
}

/**
 * Authenticated feature actions use this helper to materialize the minimal social row on a
 * user's first social interaction. Discovery and other read paths use getDisplayProfile instead.
 */
export async function getProfile(userId: number): Promise<Profile> {
  const db = await requireDb();
  return ensureProfileWithDb(db, userId);
}

/** Returns whether a person may read content from a circle, without leaking private posts. */
export async function canAccessCircle(
  userId: number | null,
  circleId: number,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const circle = await db
    .select()
    .from(circles)
    .where(eq(circles.id, circleId))
    .limit(1);
  if (!circle[0]) return false;
  const role = await membershipRoleWithDb(db, userId, circleId);
  return canReadCircleContent(circle[0].privacy, role);
}

async function circleOutputWithDb(
  db: Database,
  circleId: number,
  viewerId: number | null = null,
): Promise<Circle> {
  const circle = await circleRowOrThrow(db, circleId);
  const [membershipRole, memberCount] = await Promise.all([
    membershipRoleWithDb(db, viewerId, circle.id),
    db
      .select({ total: sql<number>`count(*)` })
      .from(memberships)
      .where(
        and(
          eq(memberships.circleId, circle.id),
          inArray(memberships.role, ["owner", "moderator", "member"]),
        ),
      ),
  ]);

  return {
    id: circle.id,
    name: circle.name,
    description: circle.description,
    category: circle.category,
    image: circle.image,
    color: circle.color,
    memberCount: countValue(memberCount[0]?.total),
    ownerId: circle.ownerId,
    privacy: circle.privacy,
    ...(viewerId
      ? { role: membershipRole, joined: isApprovedCircleRole(membershipRole) }
      : {}),
  };
}

export async function listCircles(
  viewerId: number | null,
  filters: { search?: string; category?: string },
): Promise<Circle[]> {
  const db = await requireDb();
  const clauses: SQL[] = [];
  if (filters.search?.trim()) {
    const needle = `%${filters.search.trim()}%`;
    clauses.push(
      or(ilike(circles.name, needle), ilike(circles.description, needle))!,
    );
  }
  if (filters.category?.trim())
    clauses.push(ilike(circles.category, filters.category.trim()));
  const rows = await db
    .select()
    .from(circles)
    .where(clauses.length ? and(...clauses) : undefined)
    .orderBy(desc(circles.createdAt), asc(circles.name))
    .limit(100);
  return Promise.all(
    rows.map((circle) => circleOutputWithDb(db, circle.id, viewerId)),
  );
}

export async function getCircle(
  viewerId: number | null,
  circleId: number,
): Promise<Circle> {
  const db = await requireDb();
  return circleOutputWithDb(db, circleId, viewerId);
}

export type DateIdCursor = { createdAt: Date; id: number };
/** Retains PostgreSQL microseconds across an ISO/JS Date page hop. */
export type CircleDateIdCursor = DateIdCursor & { createdAtExact?: string };
export type IdCursor = { id: number };
export type CursorPage<Item, Cursor> = {
  items: Item[];
  nextCursor: Cursor | null;
  hasMore: boolean;
};

const SOCIAL_PAGE_DEFAULT_LIMIT = 20;
const SOCIAL_PAGE_MAX_LIMIT = 50;

function socialPageLimit(value: number | undefined): number {
  return Math.min(
    Math.max(Math.floor(value ?? SOCIAL_PAGE_DEFAULT_LIMIT), 1),
    SOCIAL_PAGE_MAX_LIMIT,
  );
}

export async function listCirclesPage(
  viewerId: number | null,
  filters: {
    search?: string;
    category?: string;
    /** Limits the directory to the authenticated viewer's approved memberships. */
    joinedOnly?: boolean;
    cursor?: CircleDateIdCursor;
    limit?: number;
  },
): Promise<CursorPage<Circle, CircleDateIdCursor>> {
  if (filters.joinedOnly && !viewerId) {
    return { items: [], nextCursor: null, hasMore: false };
  }
  const db = await requireDb();
  const clauses: SQL[] = [];
  if (filters.search?.trim()) {
    const needle = `%${filters.search.trim()}%`;
    clauses.push(
      or(ilike(circles.name, needle), ilike(circles.description, needle))!,
    );
  }
  if (filters.category?.trim()) {
    clauses.push(ilike(circles.category, filters.category.trim()));
  }
  if (filters.joinedOnly) {
    // `viewerId` comes only from the request context. A pending application remains a
    // discoverable private-circle teaser in the unfiltered directory, but is not a joined circle.
    clauses.push(
      sql`exists (
        select 1 from ${memberships}
        where ${memberships.circleId} = ${circles.id}
          and ${memberships.userId} = ${viewerId}
          and ${memberships.role} in ('owner', 'moderator', 'member')
      )`,
    );
  }
  if (filters.cursor) {
    const cursorCreatedAt = filters.cursor.createdAtExact
      ? sql`${filters.cursor.createdAtExact}::timestamptz`
      : filters.cursor.createdAt;
    clauses.push(
      or(
        lt(circles.createdAt, cursorCreatedAt),
        and(
          eq(circles.createdAt, cursorCreatedAt),
          lt(circles.id, filters.cursor.id),
        ),
      )!,
    );
  }
  const limit = socialPageLimit(filters.limit);
  const rows = await db
    .select({
      ...getTableColumns(circles),
      preciseCreatedAt: sql<string>`to_char(${circles.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
    })
    .from(circles)
    .where(clauses.length ? and(...clauses) : undefined)
    .orderBy(desc(circles.createdAt), desc(circles.id))
    .limit(limit + 1);
  const pageRows = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  const last = pageRows[pageRows.length - 1];
  return {
    items: await Promise.all(
      pageRows.map((circle) => circleOutputWithDb(db, circle.id, viewerId)),
    ),
    nextCursor:
      hasMore && last
        ? {
            createdAt: last.createdAt,
            id: last.id,
            ...(last.preciseCreatedAt
              ? { createdAtExact: last.preciseCreatedAt }
              : {}),
          }
        : null,
    hasMore,
  };
}

export async function listProfiles(
  viewerId: number | null,
  search?: string,
): Promise<Profile[]> {
  const db = await requireDb();
  const term = search?.trim();
  const rows = await db
    .select({ userId: profiles.userId })
    .from(profiles)
    .where(
      term
        ? or(
            ilike(profiles.name, `%${term}%`),
            ilike(profiles.handle, `%${term}%`),
          )
        : undefined,
    )
    .orderBy(asc(profiles.name))
    .limit(100);
  const result = await Promise.all(
    rows.map((row) => findProfileWithDb(db, row.userId, viewerId)),
  );
  return result.filter((profile): profile is Profile => profile !== null);
}

export async function findProfile(
  userId: number,
  viewerId: number | null,
): Promise<Profile | null> {
  const db = await requireDb();
  return findProfileWithDb(db, userId, viewerId);
}

export async function listProfilesPage(
  viewerId: number | null,
  options: { search?: string; cursor?: IdCursor; limit?: number },
): Promise<CursorPage<Profile, IdCursor>> {
  const db = await requireDb();
  const term = options.search?.trim();
  const limit = socialPageLimit(options.limit);

  /**
   * Ranking inputs remain inside this runtime-role query. It returns only public-profile IDs and
   * cursor validity; no private interests, score totals, or intermediate follow identities leave
   * PostgreSQL. The JSON CASE handles historic non-array values and DISTINCT plus the fixed
   * onboarding allowlist make duplicate or unknown JSON entries inert.
   */
  type RankedProfileRow = { userId: number | null; cursorValid: boolean };
  const searchNeedle = term ? `%${term}%` : null;
  const cursorId = options.cursor?.id ?? null;
  const allowedInterests = sql.join(
    INTEREST_IDS.map((interest) => sql`${interest}`),
    sql`, `,
  );
  const rankedResult = await db.execute(
    sql`
      WITH scoped_profiles AS (
        SELECT
          candidate."userId" AS user_id,
          candidate.interests,
          EXISTS (
            SELECT 1
            FROM ${follows} AS direct_follow
            WHERE direct_follow."followerId" = ${viewerId}::integer
              AND direct_follow."followingId" = candidate."userId"
          ) AS already_followed
        FROM ${profiles} AS candidate
        WHERE (${viewerId}::integer IS NULL OR candidate."userId" <> ${viewerId}::integer)
          AND (
            ${searchNeedle}::text IS NULL
            OR candidate.name ILIKE ${searchNeedle}::text
            OR candidate.handle ILIKE ${searchNeedle}::text
          )
      ),
      viewer_interests AS (
        SELECT DISTINCT viewer_interest.value AS interest
        FROM ${profiles} AS viewer_profile
        CROSS JOIN LATERAL pg_catalog.jsonb_array_elements_text(
          CASE
            WHEN pg_catalog.jsonb_typeof(viewer_profile.interests) = 'array'
              THEN viewer_profile.interests
            ELSE '[]'::jsonb
          END
        ) AS viewer_interest(value)
        WHERE viewer_profile."userId" = ${viewerId}::integer
          AND viewer_interest.value = ANY(ARRAY[${allowedInterests}]::text[])
      ),
      candidate_interests AS (
        SELECT DISTINCT scoped_profiles.user_id, candidate_interest.value AS interest
        FROM scoped_profiles
        CROSS JOIN LATERAL pg_catalog.jsonb_array_elements_text(
          CASE
            WHEN pg_catalog.jsonb_typeof(scoped_profiles.interests) = 'array'
              THEN scoped_profiles.interests
            ELSE '[]'::jsonb
          END
        ) AS candidate_interest(value)
        WHERE candidate_interest.value = ANY(ARRAY[${allowedInterests}]::text[])
      ),
      interest_scores AS (
        SELECT candidate_interests.user_id,
          pg_catalog.count(*)::integer AS shared_interest_count
        FROM candidate_interests
        INNER JOIN viewer_interests
          ON viewer_interests.interest = candidate_interests.interest
        GROUP BY candidate_interests.user_id
      ),
      two_hop_scores AS (
        SELECT second_hop."followingId" AS user_id,
          pg_catalog.count(DISTINCT first_hop."followingId")::integer AS two_hop_count
        FROM ${follows} AS first_hop
        INNER JOIN ${follows} AS second_hop
          ON second_hop."followerId" = first_hop."followingId"
        INNER JOIN scoped_profiles
          ON scoped_profiles.user_id = second_hop."followingId"
        WHERE first_hop."followerId" = ${viewerId}::integer
        GROUP BY second_hop."followingId"
      ),
      ranked AS (
        SELECT
          scoped_profiles.user_id,
          scoped_profiles.already_followed,
          (
            100 * COALESCE(interest_scores.shared_interest_count, 0)
            + 10 * LEAST(COALESCE(two_hop_scores.two_hop_count, 0), 9)
          )::integer AS relevance_score
        FROM scoped_profiles
        LEFT JOIN interest_scores
          ON interest_scores.user_id = scoped_profiles.user_id
        LEFT JOIN two_hop_scores
          ON two_hop_scores.user_id = scoped_profiles.user_id
      ),
      cursor_anchor AS (
        SELECT user_id, already_followed, relevance_score
        FROM ranked
        WHERE user_id = ${cursorId}::integer
      ),
      cursor_state AS (
        SELECT (
          ${cursorId}::integer IS NULL
          OR EXISTS (SELECT 1 FROM cursor_anchor)
        ) AS cursor_valid
      ),
      page AS (
        SELECT ranked.user_id, ranked.already_followed, ranked.relevance_score
        FROM ranked
        CROSS JOIN cursor_state
        WHERE cursor_state.cursor_valid
          AND (
            ${cursorId}::integer IS NULL
            OR EXISTS (
              SELECT 1
              FROM cursor_anchor
              WHERE ranked.already_followed > cursor_anchor.already_followed
                OR (
                  ranked.already_followed = cursor_anchor.already_followed
                  AND ranked.relevance_score < cursor_anchor.relevance_score
                )
                OR (
                  ranked.already_followed = cursor_anchor.already_followed
                  AND ranked.relevance_score = cursor_anchor.relevance_score
                  AND ranked.user_id > cursor_anchor.user_id
                )
            )
          )
        ORDER BY ranked.already_followed ASC, ranked.relevance_score DESC, ranked.user_id ASC
        LIMIT ${limit + 1}
      )
      SELECT
        page.user_id AS "userId",
        cursor_state.cursor_valid AS "cursorValid"
      FROM cursor_state
      LEFT JOIN page ON true
      ORDER BY page.already_followed ASC NULLS LAST,
        page.relevance_score DESC NULLS LAST,
        page.user_id ASC NULLS LAST
    `,
  );
  const rows = rankedResult.rows as RankedProfileRow[];
  if (!rows[0]?.cursorValid) {
    socialError(
      "BAD_REQUEST",
      "People recommendations changed. Refresh to continue.",
    );
  }
  const rankedIds = rows
    .map((row) => row.userId)
    .filter((userId): userId is number => Number.isSafeInteger(userId));
  const pageIds = rankedIds.slice(0, limit);
  const hasMore = rankedIds.length > limit;
  const lastId = pageIds[pageIds.length - 1];
  const items = await Promise.all(
    pageIds.map((userId) => findProfileWithDb(db, userId, viewerId)),
  );
  return {
    items: items.filter((profile): profile is Profile => profile !== null),
    nextCursor: hasMore && lastId ? { id: lastId } : null,
    hasMore,
  };
}

async function assertCircleContentAccess(
  db: Database | SocialTransaction,
  userId: number | null,
  circleId: number,
) {
  const circle = await circleRowOrThrow(db, circleId);
  const role = await membershipRoleWithDb(db, userId, circleId);
  if (!canReadCircleContent(circle.privacy, role)) {
    socialError(
      "FORBIDDEN",
      "You must be an approved member to access this private circle",
    );
  }
  return { circle, role };
}

async function assertPostAccess(
  db: Database | SocialTransaction,
  userId: number | null,
  postId: number,
) {
  const post = await postRowOrThrow(db, postId);
  if (!post.circleId)
    return { post, circle: null, role: null as CircleRole | null };
  const { circle, role } = await assertCircleContentAccess(
    db,
    userId,
    post.circleId,
  );
  return { post, circle, role };
}

async function assertPostAccessForProtectedMutation(
  tx: SocialTransaction,
  userId: number,
  postId: number,
) {
  const post = await postRowOrThrow(tx, postId);
  if (!post.circleId) {
    return { post, circle: null, role: null as CircleRole | null };
  }
  const { circle, role } = await lockCircleAccessForProtectedMutation(
    tx,
    userId,
    post.circleId,
  );
  if (!canReadCircleContent(circle.privacy, role)) {
    socialError(
      "FORBIDDEN",
      "You must be an approved member to access this private circle",
    );
  }
  return { post, circle, role };
}

/** Locks a post's exact parent before private content or related metadata is projected. */
async function assertPostAccessForProtectedRead(
  tx: SocialTransaction,
  userId: number | null,
  postId: number,
) {
  const post = await postRowOrThrow(tx, postId);
  if (!post.circleId) {
    return { post, circle: null, role: null as CircleRole | null };
  }
  const { circle, role } = await lockCircleAccessForProtectedRead(
    tx,
    userId,
    post.circleId,
  );
  if (!canReadCircleContent(circle.privacy, role)) {
    socialError(
      "FORBIDDEN",
      "You must be an approved member to access this private circle",
    );
  }
  return { post, circle, role };
}

/**
 * A feed candidate is not safe to serialize merely because its earlier scan saw membership.
 * Re-read it and map it under the parent shared lock; a concurrent revocation simply omits that
 * candidate without turning unrelated public feed rows into an authorization error.
 */
async function postOutputForProtectedRead(
  db: Database,
  viewerId: number | null,
  postId: number,
): Promise<Post | null> {
  try {
    return await db.transaction(async (tx) => {
      await assertPostAccessForProtectedRead(tx, viewerId, postId);
      return postOutputWithDb(tx, postId, viewerId);
    });
  } catch (error) {
    if (
      error instanceof TRPCError &&
      (error.code === "NOT_FOUND" || error.code === "FORBIDDEN")
    ) {
      return null;
    }
    throw error;
  }
}

async function postOutputWithDb(
  db: Database | SocialTransaction,
  postId: number,
  viewerId: number | null,
): Promise<Post> {
  const post = await postRowOrThrow(db, postId);
  const circle = post.circleId
    ? await db
        .select()
        .from(circles)
        .where(eq(circles.id, post.circleId))
        .limit(1)
    : [];
  const [author, likesResult, commentsResult, likedRows, savedRows] =
    await Promise.all([
      displayProfileWithDb(db, post.authorId, viewerId),
      db
        .select({ total: sql<number>`count(*)` })
        .from(reactions)
        .where(eq(reactions.postId, post.id)),
      db
        .select({ total: sql<number>`count(*)` })
        .from(comments)
        .where(eq(comments.postId, post.id)),
      viewerId
        ? db
            .select({ id: reactions.id })
            .from(reactions)
            .where(
              and(
                eq(reactions.postId, post.id),
                eq(reactions.userId, viewerId),
              ),
            )
            .limit(1)
        : Promise.resolve([]),
      viewerId
        ? db
            .select({ id: bookmarks.id })
            .from(bookmarks)
            .where(
              and(
                eq(bookmarks.postId, post.id),
                eq(bookmarks.userId, viewerId),
              ),
            )
            .limit(1)
        : Promise.resolve([]),
    ]);

  return {
    id: post.id,
    author,
    circleId: post.circleId,
    circleName: circle[0]?.name ?? null,
    text: post.text,
    media: post.media,
    mediaType: post.mediaType,
    likes: countValue(likesResult[0]?.total),
    comments: countValue(commentsResult[0]?.total),
    liked: likedRows.length > 0,
    saved: savedRows.length > 0,
    createdAt: toIso(post.createdAt),
  };
}

/**
 * Activity resolution repeats current post/context and approved-membership checks before
 * mapping the ordinary Post DTO. A former circle item can never be treated as global.
 */
export async function getActivityPostTarget(
  viewerId: number,
  postId: number,
  expectedCircleId: number | null,
): Promise<Post | null> {
  const db = await requireDb();
  return db.transaction(async (tx) => {
    try {
      if (expectedCircleId === null) {
        const rows = await tx
          .select({ id: posts.id, circleId: posts.circleId })
          .from(posts)
          .where(and(eq(posts.id, postId), isNull(posts.circleId)))
          .limit(1);
        if (!rows[0] || rows[0].circleId !== null) return null;
        return await postOutputWithDb(tx, postId, viewerId);
      }

      // Lock the expected parent before the protected target lookup. This keeps a former
      // circle item from being projected after the removal transaction commits.
      const { circle, role } = await lockCircleAccessForProtectedRead(
        tx,
        viewerId,
        expectedCircleId,
      );
      if (!canReadCircleContent(circle.privacy, role)) return null;
      const rows = await tx
        .select({ id: posts.id, circleId: posts.circleId })
        .from(posts)
        .where(and(eq(posts.id, postId), eq(posts.circleId, expectedCircleId)))
        .limit(1);
      if (!rows[0] || rows[0].circleId !== expectedCircleId) return null;
      return await postOutputWithDb(tx, postId, viewerId);
    } catch (error) {
      // A deletion/revocation may win after the verified lookup. Do not sanitize operational errors.
      if (
        error instanceof TRPCError &&
        (error.code === "NOT_FOUND" || error.code === "FORBIDDEN")
      ) {
        return null;
      }
      throw error;
    }
  });
}

/**
 * Moderation detail has already locked and authorized its exact circle. Recheck the current
 * resource against that same parent before mapping the ordinary Post DTO; stale/foreign/deleted
 * targets deliberately appear as unavailable rather than leaking another post.
 */
export async function getModerationPostTarget(
  tx: SocialTransaction,
  viewerId: number,
  postId: number,
  expectedCircleId: number,
): Promise<Post | null> {
  const rows = await tx
    .select({ id: posts.id, circleId: posts.circleId })
    .from(posts)
    .where(and(eq(posts.id, postId), eq(posts.circleId, expectedCircleId)))
    .limit(1);
  if (!rows[0] || rows[0].circleId !== expectedCircleId) return null;
  try {
    await assertPostAccess(tx, viewerId, postId);
    return await postOutputWithDb(tx, postId, viewerId);
  } catch (error) {
    if (
      error instanceof TRPCError &&
      (error.code === "NOT_FOUND" || error.code === "FORBIDDEN")
    ) {
      return null;
    }
    throw error;
  }
}

async function circleHomeOutputWithDb(
  db: SocialTransaction,
  viewerId: number | null,
  circleId: number,
): Promise<CircleHome> {
  const { circle, role } = await lockCircleAccessForProtectedRead(
    db,
    viewerId,
    circleId,
  );
  if (!canReadCircleContent(circle.privacy, role)) {
    socialError(
      "FORBIDDEN",
      "You must be an approved member to access this private circle",
    );
  }

  let pinnedPost: Post | null = null;
  if (circle.pinnedPostId) {
    // Bind the target lookup to this circle before mapping. This safely hides legacy/corrupt
    // foreign metadata even before the FK has been validated against historic rows.
    const pinnedRows = await db
      .select({ id: posts.id, circleId: posts.circleId })
      .from(posts)
      .where(
        and(eq(posts.id, circle.pinnedPostId), eq(posts.circleId, circle.id)),
      )
      .limit(1);
    if (pinnedRows[0]?.circleId === circle.id) {
      try {
        pinnedPost = await postOutputWithDb(db, pinnedRows[0].id, viewerId);
      } catch (error) {
        // A post deletion may commit between the verified lookup and DTO mapper on a read path.
        // The FK clears metadata; meanwhile, omit the no-longer-current pinned item safely.
        if (!(error instanceof TRPCError) || error.code !== "NOT_FOUND")
          throw error;
      }
    }
  }

  return {
    circleId: circle.id,
    viewerId,
    welcomeMessage: circle.welcomeMessage,
    rules: [...circle.rules],
    pinnedPost,
    canManage: canModerateCircle(role),
    updatedAt: toIso(circle.updatedAt),
  };
}

/** Read-only Circle Home lookup. Public circles remain public; private circles require a current approved role. */
export async function getCircleHome(
  viewerId: number | null,
  circleId: number,
): Promise<CircleHome> {
  const normalizedCircleId = normalizeCircleHomeId(circleId);
  const db = await requireDb();
  // Keep the visibility decision, pinned-target verification, and display mapping on the runtime
  // role connection without materializing a social profile or mutating home metadata.
  return db.transaction((tx) =>
    circleHomeOutputWithDb(tx, viewerId, normalizedCircleId),
  );
}

/** Managers may replace welcome/rules without touching an independently managed pin. */
export async function updateCircleHome(
  userId: number,
  input: CircleHomeTextInput,
): Promise<{ success: true }> {
  const normalized = normalizeCircleHomeTextInput(input);
  const db = await requireDb();
  await db.transaction(async (tx) => {
    const { circle, role } = await lockCircleAccessForProtectedMutation(
      tx,
      userId,
      normalized.circleId,
    );
    if (!canModerateCircle(role)) {
      socialError(
        "FORBIDDEN",
        "Only a circle owner or moderator may manage circle home content",
      );
    }
    const sameRules =
      circle.rules.length === normalized.rules.length &&
      circle.rules.every((rule, index) => rule === normalized.rules[index]);
    if (circle.welcomeMessage === normalized.welcomeMessage && sameRules)
      return;
    await tx
      .update(circles)
      .set({
        welcomeMessage: normalized.welcomeMessage,
        rules: normalized.rules,
        updatedAt: new Date(),
      })
      .where(eq(circles.id, normalized.circleId));
  });
  return { success: true };
}

/** Managers set a concrete existing circle post or explicitly clear the pin; there is no toggle. */
export async function setCirclePinnedPost(
  userId: number,
  input: CircleHomePinInput,
): Promise<{ success: true }> {
  const normalized = normalizeCircleHomePinInput(input);
  const db = await requireDb();
  await db.transaction(async (tx) => {
    const { circle, role } = await lockCircleAccessForProtectedMutation(
      tx,
      userId,
      normalized.circleId,
    );
    if (!canModerateCircle(role)) {
      socialError(
        "FORBIDDEN",
        "Only a circle owner or moderator may manage circle home content",
      );
    }

    if (normalized.postId !== null) {
      // The existing parent-row lock serializes this target read with deletePost's circle lock.
      const postRows = await tx
        .select({ id: posts.id, circleId: posts.circleId })
        .from(posts)
        .where(
          and(eq(posts.id, normalized.postId), eq(posts.circleId, circle.id)),
        )
        .limit(1);
      const post = postRows[0];
      // The predicate suppresses foreign posts; retain this defensive check for non-SQL mocks.
      if (!post || post.circleId !== circle.id) {
        socialError("NOT_FOUND", "Post is unavailable for this circle");
      }
    }

    if (circle.pinnedPostId === normalized.postId) return;
    await tx
      .update(circles)
      .set({ pinnedPostId: normalized.postId, updatedAt: new Date() })
      .where(eq(circles.id, normalized.circleId));
  });
  return { success: true };
}

const FEED_PAGE_SIZE = 100;
const FEED_SCAN_BATCH_SIZE = 200;
const FEED_MAX_SCAN_BATCHES = 10;

/** Retains PostgreSQL microseconds across a feed page hop without changing legacy cursors. */
export type FeedScanCursor = DateIdCursor & { createdAtExact?: string };

type FeedScanCandidate = FeedScanCursor & {
  circleId: number | null;
};

function feedScanCursorFromCandidate(
  candidate: FeedScanCandidate,
): FeedScanCursor {
  return {
    createdAt: candidate.createdAt,
    id: candidate.id,
    ...(candidate.createdAtExact
      ? { createdAtExact: candidate.createdAtExact }
      : {}),
  };
}

export type FeedPageOptions = {
  /** Exclusive compound cursor from the last returned post. */
  cursor?: FeedScanCursor;
  /** Optional bounded page size; omission preserves the historical 100-item array response. */
  limit?: number;
  /** Optional post-text search, normalized by the public router before use. */
  search?: string;
};

/** Escapes PostgreSQL LIKE metacharacters so user search remains literal under ILIKE. */
export function escapePostSearchLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

/**
 * Reads newest-first post batches until the requested eligible page is full or no older posts
 * remain. The compound cursor keeps equal-timestamp posts in a stable order between batches.
 */
export async function collectEligibleFeedPostIds(
  readPage: (cursor: FeedScanCursor | null) => Promise<FeedScanCandidate[]>,
  isEligible: (post: FeedScanCandidate) => Promise<boolean>,
  options: FeedPageOptions = {},
): Promise<number[]> {
  return (await collectEligibleFeedPage(readPage, isEligible, options)).items;
}

export type EligibleFeedPage = CursorPage<number, FeedScanCursor>;

/**
 * A bounded feed scan can advance through inaccessible private candidates without calling the
 * end of the feed. Its continuation names the final consumed candidate, including empty pages.
 */
export async function collectEligibleFeedPage(
  readPage: (cursor: FeedScanCursor | null) => Promise<FeedScanCandidate[]>,
  isEligible: (post: FeedScanCandidate) => Promise<boolean>,
  options: FeedPageOptions = {},
): Promise<EligibleFeedPage> {
  const eligiblePostIds: number[] = [];
  let cursor: FeedScanCursor | null = options.cursor ?? null;
  const pageSize = Math.min(
    Math.max(Math.floor(options.limit ?? FEED_PAGE_SIZE), 1),
    FEED_PAGE_SIZE,
  );
  let scannedBatches = 0;

  while (
    eligiblePostIds.length < pageSize &&
    scannedBatches < FEED_MAX_SCAN_BATCHES
  ) {
    scannedBatches += 1;
    const candidates = await readPage(cursor);
    if (!candidates.length) break;

    for (const [index, candidate] of candidates.entries()) {
      if (await isEligible(candidate)) {
        eligiblePostIds.push(candidate.id);
        if (eligiblePostIds.length === pageSize) {
          const hasMore =
            index < candidates.length - 1 ||
            candidates.length === FEED_SCAN_BATCH_SIZE;
          return {
            items: eligiblePostIds,
            nextCursor: hasMore ? feedScanCursorFromCandidate(candidate) : null,
            hasMore,
          };
        }
      }
    }

    if (candidates.length < FEED_SCAN_BATCH_SIZE) {
      return { items: eligiblePostIds, nextCursor: null, hasMore: false };
    }
    const oldestCandidate = candidates[candidates.length - 1];
    cursor = feedScanCursorFromCandidate(oldestCandidate);
  }

  return {
    items: eligiblePostIds,
    nextCursor: cursor,
    hasMore: cursor !== null,
  };
}

type AuthorizedFeedItem<Item> = {
  item: Item;
  cursor: FeedScanCursor;
};

/**
 * Maps only candidates that remain authorized under their protected parent read lock. Scan
 * cursors may cross a candidate that loses access while mapping, but that transient cursor stays
 * internal: callers receive a continuation only from the final serialized item. This continues
 * through removals rather than returning a false empty/end page.
 */
export async function collectAuthorizedFeedPage<Item>(
  readPage: (cursor: FeedScanCursor | null) => Promise<FeedScanCandidate[]>,
  mapAuthorizedCandidate: (
    candidate: FeedScanCandidate,
  ) => Promise<Item | null>,
  options: FeedPageOptions = {},
): Promise<CursorPage<Item, FeedScanCursor>> {
  const pageSize = Math.min(
    Math.max(Math.floor(options.limit ?? FEED_PAGE_SIZE), 1),
    FEED_PAGE_SIZE,
  );
  const authorized: AuthorizedFeedItem<Item>[] = [];
  let scanCursor: FeedScanCursor | null = options.cursor ?? null;

  // SQL visibility filtering limits ordinary scans to public/currently-authorized rows. Keep
  // scanning only when a concurrent removal invalidates one between that selection and its
  // parent-lock recheck, so an invalidated row never becomes a continuation boundary.
  while (authorized.length < pageSize + 1) {
    const candidates = await readPage(scanCursor);
    if (!candidates.length) break;

    for (const candidate of candidates) {
      scanCursor = feedScanCursorFromCandidate(candidate);
      const item = await mapAuthorizedCandidate(candidate);
      if (item !== null) {
        authorized.push({
          item,
          cursor: feedScanCursorFromCandidate(candidate),
        });
        if (authorized.length === pageSize + 1) break;
      }
    }

    if (authorized.length === pageSize + 1) break;
    if (candidates.length < FEED_SCAN_BATCH_SIZE) break;
  }

  const page = authorized.slice(0, pageSize);
  const hasMore = authorized.length > pageSize;
  const last = page[page.length - 1];
  return {
    items: page.map(({ item }) => item),
    nextCursor: hasMore && last ? last.cursor : null,
    hasMore,
  };
}

/**
 * The feed query itself excludes private-circle posts unless the request actor is currently an
 * approved member. The post mapper repeats that decision under the parent SHARE lock because a
 * membership may be removed after SQL selection and before serialization.
 */
function visibleFeedPostCondition(viewerId: number | null): SQL {
  const approvedMembership =
    viewerId === null
      ? sql`false`
      : sql`exists (
          select 1 from ${memberships}
          where ${memberships.circleId} = ${posts.circleId}
            and ${memberships.userId} = ${viewerId}
            and ${memberships.role} in ('owner', 'moderator', 'member')
        )`;
  return or(
    isNull(posts.circleId),
    sql`exists (
      select 1 from ${circles}
      where ${circles.id} = ${posts.circleId}
        and (${circles.privacy} = 'public' or ${approvedMembership})
    )`,
  )!;
}

export async function feed(
  viewerId: number | null,
  filter: FeedFilter,
  circleId?: number,
  authorId?: number,
  options: FeedPageOptions = {},
): Promise<Post[]> {
  const db = await requireDb();
  const clauses: SQL[] = [];

  if (circleId) clauses.push(eq(posts.circleId, circleId));
  if (authorId) clauses.push(eq(posts.authorId, authorId));

  if (filter === "following") {
    if (!viewerId) return [];
    const followRows = await db
      .select({ followingId: follows.followingId })
      .from(follows)
      .where(eq(follows.followerId, viewerId));
    if (!followRows.length) return [];
    clauses.push(
      inArray(
        posts.authorId,
        followRows.map((row) => row.followingId),
      ),
    );
  }

  if (filter === "circles") {
    if (!viewerId) return [];
    const membershipRows = await db
      .select({ circleId: memberships.circleId })
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, viewerId),
          inArray(memberships.role, ["owner", "moderator", "member"]),
        ),
      );
    if (!membershipRows.length) return [];
    clauses.push(
      inArray(
        posts.circleId,
        membershipRows.map((row) => row.circleId),
      ),
    );
  }

  if (filter === "saved") {
    if (!viewerId) return [];
    const savedRows = await db
      .select({ postId: bookmarks.postId })
      .from(bookmarks)
      .where(eq(bookmarks.userId, viewerId));
    if (!savedRows.length) return [];
    clauses.push(
      inArray(
        posts.id,
        savedRows.map((row) => row.postId),
      ),
    );
  }

  const visiblePostIds = await collectEligibleFeedPostIds(
    async (cursor) => {
      const cursorClause = cursor
        ? cursor.createdAtExact
          ? or(
              lt(posts.createdAt, sql`${cursor.createdAtExact}::timestamptz`),
              and(
                eq(posts.createdAt, sql`${cursor.createdAtExact}::timestamptz`),
                lt(posts.id, cursor.id),
              ),
            )
          : or(
              lt(posts.createdAt, cursor.createdAt),
              and(
                eq(posts.createdAt, cursor.createdAt),
                lt(posts.id, cursor.id),
              ),
            )
        : null;
      const cursorClauses = cursorClause ? [...clauses, cursorClause] : clauses;
      return db
        .select()
        .from(posts)
        .where(cursorClauses.length ? and(...cursorClauses) : undefined)
        .orderBy(desc(posts.createdAt), desc(posts.id))
        .limit(FEED_SCAN_BATCH_SIZE);
    },
    async (post) => {
      if (!post.circleId) return true;
      const circleRows = await db
        .select({ id: circles.id, privacy: circles.privacy })
        .from(circles)
        .where(eq(circles.id, post.circleId))
        .limit(1);
      const circle = circleRows[0];
      if (!circle) return false;
      if (circle.privacy === "public") return true;
      return isApprovedCircleRole(
        await membershipRoleWithDb(db, viewerId, post.circleId),
      );
    },
    options,
  );

  const output = await Promise.all(
    visiblePostIds.map((postId) =>
      postOutputForProtectedRead(db, viewerId, postId),
    ),
  );
  return output.filter((post): post is Post => post !== null);
}

export async function feedPage(
  viewerId: number | null,
  filter: FeedFilter,
  circleId?: number,
  authorId?: number,
  options: FeedPageOptions = {},
): Promise<CursorPage<Post, FeedScanCursor>> {
  const db = await requireDb();
  const clauses: SQL[] = [];
  if (circleId) clauses.push(eq(posts.circleId, circleId));
  if (authorId) clauses.push(eq(posts.authorId, authorId));
  const search = options.search?.trim();
  if (search) {
    clauses.push(ilike(posts.text, `%${escapePostSearchLikePattern(search)}%`));
  }
  clauses.push(visibleFeedPostCondition(viewerId));

  if (filter === "following") {
    if (!viewerId) return { items: [], nextCursor: null, hasMore: false };
    const followRows = await db
      .select({ followingId: follows.followingId })
      .from(follows)
      .where(eq(follows.followerId, viewerId));
    if (!followRows.length)
      return { items: [], nextCursor: null, hasMore: false };
    clauses.push(
      inArray(
        posts.authorId,
        followRows.map((row) => row.followingId),
      ),
    );
  }
  if (filter === "circles") {
    if (!viewerId) return { items: [], nextCursor: null, hasMore: false };
    const membershipRows = await db
      .select({ circleId: memberships.circleId })
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, viewerId),
          inArray(memberships.role, ["owner", "moderator", "member"]),
        ),
      );
    if (!membershipRows.length)
      return { items: [], nextCursor: null, hasMore: false };
    clauses.push(
      inArray(
        posts.circleId,
        membershipRows.map((row) => row.circleId),
      ),
    );
  }
  if (filter === "saved") {
    if (!viewerId) return { items: [], nextCursor: null, hasMore: false };
    const savedRows = await db
      .select({ postId: bookmarks.postId })
      .from(bookmarks)
      .where(eq(bookmarks.userId, viewerId));
    if (!savedRows.length)
      return { items: [], nextCursor: null, hasMore: false };
    clauses.push(
      inArray(
        posts.id,
        savedRows.map((row) => row.postId),
      ),
    );
  }

  // Unlike the legacy collectEligibleFeedPage array helper, this paged route selects only
  // visible candidates in SQL and keeps any cursor from a removal-raced candidate internal.
  const page = await collectAuthorizedFeedPage(
    async (cursor) => {
      const cursorClause = cursor
        ? cursor.createdAtExact
          ? or(
              lt(posts.createdAt, sql`${cursor.createdAtExact}::timestamptz`),
              and(
                eq(posts.createdAt, sql`${cursor.createdAtExact}::timestamptz`),
                lt(posts.id, cursor.id),
              ),
            )
          : or(
              lt(posts.createdAt, cursor.createdAt),
              and(
                eq(posts.createdAt, cursor.createdAt),
                lt(posts.id, cursor.id),
              ),
            )
        : null;
      const cursorClauses = cursorClause ? [...clauses, cursorClause] : clauses;
      const rows = await db
        .select({
          ...getTableColumns(posts),
          preciseCreatedAt: sql<string>`to_char(${posts.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        })
        .from(posts)
        .where(cursorClauses.length ? and(...cursorClauses) : undefined)
        .orderBy(desc(posts.createdAt), desc(posts.id))
        .limit(FEED_SCAN_BATCH_SIZE);
      return rows.map(({ preciseCreatedAt, ...post }) => ({
        ...post,
        ...(preciseCreatedAt ? { createdAtExact: preciseCreatedAt } : {}),
      }));
    },
    async (post) => postOutputForProtectedRead(db, viewerId, post.id),
    { ...options, limit: socialPageLimit(options.limit) },
  );
  return page;
}

async function assertMediaOwnership(
  db: Database | SocialTransaction,
  userId: number,
  media?: string,
) {
  if (!media) return;
  const key = managedSocialMediaKeyFromUrl(media);
  if (!key) {
    if (!isTrustedStarterMediaUrl(media)) {
      socialError(
        "BAD_REQUEST",
        "Media must be a canonical managed upload or an approved starter asset",
      );
    }
    return;
  }
  const owned = await db
    .select({
      id: socialUploads.id,
      storageKey: socialUploads.storageKey,
      url: socialUploads.url,
    })
    .from(socialUploads)
    .where(
      and(eq(socialUploads.userId, userId), eq(socialUploads.storageKey, key)),
    )
    .limit(1);
  if (!owned.length)
    socialError("FORBIDDEN", "You can only attach your own uploaded media");
  if (owned[0].storageKey !== key || owned[0].url !== media) {
    socialError(
      "FORBIDDEN",
      "Media must match the recorded managed upload URL",
    );
  }
}

/** Marks an owned managed upload as committed only after the referencing write succeeds. */
async function claimMediaOwnership(
  db: Database | SocialTransaction,
  userId: number,
  media?: string | null,
): Promise<void> {
  if (!media) return;
  const key = managedSocialMediaKeyFromUrl(media);
  if (!key) return;
  await assertMediaOwnership(db, userId, media);
  await db
    .update(socialUploads)
    .set({ claimedAt: new Date() })
    .where(
      and(eq(socialUploads.userId, userId), eq(socialUploads.storageKey, key)),
    );
}

const POST_PHOTO_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/**
 * A post cannot relabel an owned file. The authoritative MIME came from social.upload after
 * byte validation, so a caller's mediaType is checked only against that persisted metadata.
 */
async function assertPostMediaTypeOwnership(
  db: Database | SocialTransaction,
  userId: number,
  media: string | undefined,
  mediaType: PostPublishInput["mediaType"],
): Promise<void> {
  if (!media) {
    if (mediaType !== "text") {
      socialError("BAD_REQUEST", "Photo and video posts need media");
    }
    return;
  }
  if (mediaType === "text") {
    socialError("BAD_REQUEST", "Text posts cannot include media");
  }
  const key = managedSocialMediaKeyFromUrl(media);
  if (!key) {
    if (!isTrustedStarterMediaUrl(media)) {
      socialError(
        "BAD_REQUEST",
        "Media must be a canonical managed upload or an approved starter asset",
      );
    }
    if (mediaType !== "photo") {
      socialError(
        "BAD_REQUEST",
        "Starter media can only be attached as a photo",
      );
    }
    return;
  }
  const rows = await db
    .select({
      storageKey: socialUploads.storageKey,
      url: socialUploads.url,
      mimeType: socialUploads.mimeType,
    })
    .from(socialUploads)
    .where(
      and(eq(socialUploads.userId, userId), eq(socialUploads.storageKey, key)),
    )
    .limit(1);
  const upload = rows[0];
  if (!upload || upload.storageKey !== key || upload.url !== media) {
    socialError("FORBIDDEN", "You can only attach your own uploaded media");
  }
  const expectedMime =
    mediaType === "video"
      ? upload.mimeType === "video/mp4"
      : POST_PHOTO_MIME_TYPES.has(upload.mimeType);
  if (!expectedMime) {
    socialError(
      "BAD_REQUEST",
      mediaType === "video"
        ? "Video posts require an MP4 upload"
        : "Photo posts require a JPEG, PNG, or WEBP upload",
    );
  }
}

/** Marks a type-verified managed post attachment as claimed inside the publication transaction. */
async function claimPostMediaOwnership(
  db: Database | SocialTransaction,
  userId: number,
  media: string | undefined,
  mediaType: PostPublishInput["mediaType"],
): Promise<void> {
  await assertPostMediaTypeOwnership(db, userId, media, mediaType);
  if (!media) return;
  const key = managedSocialMediaKeyFromUrl(media);
  if (!key) return;
  await db
    .update(socialUploads)
    .set({ claimedAt: new Date() })
    .where(
      and(eq(socialUploads.userId, userId), eq(socialUploads.storageKey, key)),
    );
}

const CIRCLE_COVER_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export function isCircleCoverImageMime(mimeType: string): boolean {
  return CIRCLE_COVER_IMAGE_MIME_TYPES.has(mimeType);
}

/** A managed circle cover must retain its server-recorded image MIME, not just a picker hint. */
export async function assertCircleCoverImageOwnership(
  db: Database | SocialTransaction,
  userId: number,
  media?: string,
): Promise<void> {
  await assertMediaOwnership(db, userId, media);
  if (!media) return;
  const key = managedSocialMediaKeyFromUrl(media);
  // Starter assets are an explicit trusted allowlist and have no socialUploads metadata row.
  if (!key) return;
  const rows = await db
    .select({ mimeType: socialUploads.mimeType, url: socialUploads.url })
    .from(socialUploads)
    .where(
      and(eq(socialUploads.userId, userId), eq(socialUploads.storageKey, key)),
    )
    .limit(1);
  if (!rows[0] || rows[0].url !== media) {
    socialError("FORBIDDEN", "You can only attach your own uploaded media");
  }
  if (!isCircleCoverImageMime(rows[0].mimeType)) {
    socialError(
      "BAD_REQUEST",
      "A circle cover must be a JPEG, PNG, or WEBP image",
    );
  }
}

/**
 * Removes only the authorization metadata for a caller's still-unclaimed upload. The encrypted
 * object remains opaque and no longer has an application route after this succeeds; physical
 * object deletion requires a separately authorized storage delete capability.
 */
export async function discardUnusedUpload(
  userId: number,
  media: string,
): Promise<{ success: true }> {
  const key = managedSocialMediaKeyFromUrl(media);
  if (!key)
    socialError("BAD_REQUEST", "Upload must be a canonical managed media URL");
  const db = await requireDb();
  await db.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: socialUploads.id,
        url: socialUploads.url,
        claimedAt: socialUploads.claimedAt,
      })
      .from(socialUploads)
      .where(
        and(
          eq(socialUploads.userId, userId),
          eq(socialUploads.storageKey, key),
        ),
      )
      .limit(1)
      .for("update");
    const upload = rows[0];
    if (!upload || upload.url !== media)
      socialError("NOT_FOUND", "Upload not found");
    if (upload.claimedAt)
      socialError("CONFLICT", "A referenced upload cannot be discarded");

    const [
      profileReference,
      circleReference,
      postReference,
      messageReference,
      streamReference,
    ] = await Promise.all([
      tx
        .select({ id: profiles.id })
        .from(profiles)
        .where(or(eq(profiles.avatar, media), eq(profiles.cover, media)))
        .limit(1),
      tx
        .select({ id: circles.id })
        .from(circles)
        .where(eq(circles.image, media))
        .limit(1),
      tx
        .select({ id: posts.id })
        .from(posts)
        .where(eq(posts.media, media))
        .limit(1),
      tx
        .select({ id: messages.id })
        .from(messages)
        .where(eq(messages.media, media))
        .limit(1),
      tx
        .select({ id: streams.id })
        .from(streams)
        .where(eq(streams.thumbnail, media))
        .limit(1),
    ]);
    if (
      profileReference.length ||
      circleReference.length ||
      postReference.length ||
      messageReference.length ||
      streamReference.length
    ) {
      socialError("CONFLICT", "A referenced upload cannot be discarded");
    }
    await tx.delete(socialUploads).where(eq(socialUploads.id, upload.id));
  });
  return { success: true };
}

export async function updateProfile(
  userId: number,
  input: { name: string; handle: string; bio: string; avatar?: string },
): Promise<Profile> {
  const db = await requireDb();
  await ensureProfileWithDb(db, userId);
  await assertMediaOwnership(db, userId, input.avatar);
  const current = await db
    .select()
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);
  if (!current[0])
    socialError("INTERNAL_SERVER_ERROR", "Profile is unavailable");

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(profiles)
        .set({
          name: input.name.trim(),
          handle: input.handle.trim().replace(/^@+/, "").toLowerCase(),
          bio: input.bio.trim(),
          updatedAt: new Date(),
          ...(input.avatar !== undefined ? { avatar: input.avatar } : {}),
        })
        .where(eq(profiles.userId, userId));
      await claimMediaOwnership(tx, userId, input.avatar);
    });
  } catch (error) {
    if (isPostgresUniqueViolation(error)) {
      socialError("CONFLICT", "That handle is already in use");
    }
    throw error;
  }

  return ensureProfileWithDb(db, userId);
}

export async function toggleFollow(
  userId: number,
  targetUserId: number,
  desiredFollowing?: boolean,
): Promise<{ following: boolean }> {
  if (userId === targetUserId)
    socialError("BAD_REQUEST", "You cannot follow yourself");
  const db = await requireDb();
  const target = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, targetUserId))
    .limit(1);
  if (!target.length) socialError("NOT_FOUND", "Profile not found");

  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: follows.id })
      .from(follows)
      .where(
        and(
          eq(follows.followerId, userId),
          eq(follows.followingId, targetUserId),
        ),
      )
      .limit(1);
    // Omitted desired state is the legacy toggle contract. Concurrent legacy retries converge on
    // the state observed by this transaction rather than throwing a unique-key error.
    const following = desiredFollowing ?? !existing.length;
    if (!following) {
      await tx
        .delete(follows)
        .where(
          and(
            eq(follows.followerId, userId),
            eq(follows.followingId, targetUserId),
          ),
        );
      return { following: false };
    }
    await tx
      .insert(follows)
      .values({ followerId: userId, followingId: targetUserId })
      .onConflictDoNothing({
        target: [follows.followerId, follows.followingId],
      });
    return { following: true };
  });
}

export async function createCircle(
  userId: number,
  input: {
    name: string;
    description: string;
    category: string;
    privacy: "public" | "private";
    image?: string;
    color?: string;
  },
): Promise<Circle> {
  const db = await requireDb();
  const circleId = await db.transaction(async (tx) => {
    await assertPlatformFeature(tx, "circleCreationEnabled");
    await ensureProfileWithDb(tx, userId);
    await assertCircleCoverImageOwnership(tx, userId, input.image);
    const created = await tx
      .insert(circles)
      .values({
        ownerId: userId,
        name: input.name.trim(),
        description: input.description.trim(),
        category: input.category.trim(),
        privacy: input.privacy,
        image: input.image?.trim() || "",
        color: input.color?.trim() || "#ED604A",
      })
      .returning({ id: circles.id });
    const id = created[0]?.id;
    if (!id) socialError("INTERNAL_SERVER_ERROR", "Unable to create circle");
    await tx
      .insert(memberships)
      .values({ circleId: id, userId, role: "owner" });
    await claimMediaOwnership(tx, userId, input.image);
    return id;
  });
  return circleOutputWithDb(db, circleId, userId);
}

export async function joinCircle(
  userId: number,
  circleId: number,
): Promise<{ role: string | null }> {
  const result = await setCircleMembership(userId, circleId, true);
  return { role: result.role };
}

export type CircleMembershipState = {
  role: CircleRole | null;
  joined: boolean;
};

/**
 * The only desired-state membership writer. The parent circle row lock serializes applications,
 * approvals/removals, and cancellation so duplicate requests converge without a stale toggle.
 */
export async function setCircleMembership(
  userId: number,
  circleId: number,
  desiredJoined: boolean,
  options: { requireExistingWhenLeaving?: boolean } = {},
): Promise<CircleMembershipState> {
  const db = await requireDb();
  return db.transaction(async (tx) => {
    const circle = await lockCircleForProtectedMutation(tx, circleId);
    const role = await membershipRoleWithDb(tx, userId, circleId);
    if (desiredJoined) {
      if (!role) {
        const requestedRole: CircleRole =
          circle.privacy === "private" ? "pending" : "member";
        await tx
          .insert(memberships)
          .values({ circleId, userId, role: requestedRole })
          .onConflictDoNothing({
            target: [memberships.circleId, memberships.userId],
          });
      }
    } else if (role) {
      if (role === "owner") {
        socialError("FORBIDDEN", "The circle owner cannot leave their circle");
      }
      await tx
        .delete(memberships)
        .where(
          and(
            eq(memberships.circleId, circleId),
            eq(memberships.userId, userId),
          ),
        );
    } else if (options.requireExistingWhenLeaving) {
      socialError("NOT_FOUND", "You are not a member of this circle");
    }
    const persistedRole = desiredJoined
      ? await membershipRoleWithDb(tx, userId, circleId)
      : null;
    if (desiredJoined && !persistedRole) {
      socialError(
        "INTERNAL_SERVER_ERROR",
        "Unable to confirm circle membership",
      );
    }
    return {
      role: persistedRole,
      joined: isApprovedCircleRole(persistedRole),
    };
  });
}

export async function leaveCircle(
  userId: number,
  circleId: number,
): Promise<{ success: true }> {
  await setCircleMembership(userId, circleId, false, {
    requireExistingWhenLeaving: true,
  });
  return { success: true };
}

export async function listMembers(
  userId: number | null,
  circleId: number,
): Promise<Member[]> {
  const db = await requireDb();
  return db.transaction(async (tx) => {
    const { circle, role: viewerRole } = await lockCircleAccessForProtectedRead(
      tx,
      userId,
      circleId,
    );
    if (!canReadCircleContent(circle.privacy, viewerRole)) {
      socialError(
        "FORBIDDEN",
        "You must be an approved member to access this private circle",
      );
    }
    const rows = await tx
      .select({ userId: memberships.userId, role: memberships.role })
      .from(memberships)
      .where(
        canViewPendingMembers(viewerRole)
          ? eq(memberships.circleId, circleId)
          : and(
              eq(memberships.circleId, circleId),
              ne(memberships.role, "pending"),
            ),
      )
      .orderBy(asc(memberships.createdAt));
    return Promise.all(
      rows.map(async (row) => ({
        user: await displayProfileWithDb(tx, row.userId, userId),
        role: row.role as CircleRole,
      })),
    );
  });
}

export async function listMembersPage(
  userId: number | null,
  circleId: number,
  options: { cursor?: CircleDateIdCursor; limit?: number } = {},
): Promise<CursorPage<Member, CircleDateIdCursor>> {
  const db = await requireDb();
  return db.transaction(async (tx) => {
    const { circle, role: viewerRole } = await lockCircleAccessForProtectedRead(
      tx,
      userId,
      circleId,
    );
    if (!canReadCircleContent(circle.privacy, viewerRole)) {
      socialError(
        "FORBIDDEN",
        "You must be an approved member to access this private circle",
      );
    }
    const clauses: SQL[] = [eq(memberships.circleId, circleId)];
    if (!canViewPendingMembers(viewerRole)) {
      clauses.push(ne(memberships.role, "pending"));
    }
    if (options.cursor) {
      const cursorCreatedAt = options.cursor.createdAtExact
        ? sql`${options.cursor.createdAtExact}::timestamptz`
        : options.cursor.createdAt;
      clauses.push(
        or(
          gt(memberships.createdAt, cursorCreatedAt),
          and(
            eq(memberships.createdAt, cursorCreatedAt),
            gt(memberships.id, options.cursor.id),
          ),
        )!,
      );
    }
    const limit = socialPageLimit(options.limit);
    const rows = await tx
      .select({
        id: memberships.id,
        userId: memberships.userId,
        role: memberships.role,
        createdAt: memberships.createdAt,
        preciseCreatedAt: sql<string>`to_char(${memberships.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      })
      .from(memberships)
      .where(and(...clauses))
      .orderBy(asc(memberships.createdAt), asc(memberships.id))
      .limit(limit + 1);
    const pageRows = rows.slice(0, limit);
    const hasMore = rows.length > limit;
    const last = pageRows[pageRows.length - 1];
    return {
      items: await Promise.all(
        pageRows.map(async (row) => ({
          user: await displayProfileWithDb(tx, row.userId, userId),
          role: row.role as CircleRole,
        })),
      ),
      nextCursor:
        hasMore && last
          ? {
              createdAt: last.createdAt,
              id: last.id,
              ...(last.preciseCreatedAt
                ? { createdAtExact: last.preciseCreatedAt }
                : {}),
            }
          : null,
      hasMore,
    };
  });
}

async function getActorAndTargetRoles(
  db: Database | SocialTransaction,
  actorId: number,
  circleId: number,
  targetUserId: number,
) {
  const [actorRole, targetRole] = await Promise.all([
    membershipRoleWithDb(db, actorId, circleId),
    membershipRoleWithDb(db, targetUserId, circleId),
  ]);
  if (!actorRole)
    socialError("FORBIDDEN", "You are not a member of this circle");
  if (!targetRole) socialError("NOT_FOUND", "Circle member not found");
  return { actorRole, targetRole };
}

export async function setMemberRole(
  actorId: number,
  circleId: number,
  targetUserId: number,
  role: "moderator" | "member",
): Promise<{ success: true }> {
  const db = await requireDb();
  await db.transaction(async (tx) => {
    await lockCircleForProtectedMutation(tx, circleId);
    const { actorRole, targetRole } = await getActorAndTargetRoles(
      tx,
      actorId,
      circleId,
      targetUserId,
    );
    if (!canSetCircleRole(actorRole, targetRole) || targetRole === "pending") {
      socialError(
        "FORBIDDEN",
        "Only the owner may change a non-owner member’s role",
      );
    }
    await tx
      .update(memberships)
      .set({ role, updatedAt: new Date() })
      .where(
        and(
          eq(memberships.circleId, circleId),
          eq(memberships.userId, targetUserId),
        ),
      );
  });
  return { success: true };
}

export async function removeMember(
  actorId: number,
  circleId: number,
  targetUserId: number,
): Promise<{ success: true }> {
  const db = await requireDb();
  await db.transaction(async (tx) => {
    await lockCircleForProtectedMutation(tx, circleId);
    const { actorRole, targetRole } = await getActorAndTargetRoles(
      tx,
      actorId,
      circleId,
      targetUserId,
    );
    if (!canRemoveCircleMember(actorRole, targetRole)) {
      socialError("FORBIDDEN", "You cannot remove this circle member");
    }
    await tx
      .delete(memberships)
      .where(
        and(
          eq(memberships.circleId, circleId),
          eq(memberships.userId, targetUserId),
        ),
      );
  });
  return { success: true };
}

export async function approveMember(
  actorId: number,
  circleId: number,
  targetUserId: number,
): Promise<{ success: true }> {
  const db = await requireDb();
  await db.transaction(async (tx) => {
    await lockCircleForProtectedMutation(tx, circleId);
    const { actorRole, targetRole } = await getActorAndTargetRoles(
      tx,
      actorId,
      circleId,
      targetUserId,
    );
    if (!canModerateCircle(actorRole) || targetRole !== "pending") {
      socialError(
        "FORBIDDEN",
        "Only an owner or moderator may approve a pending member",
      );
    }
    const approved = await tx
      .update(memberships)
      .set({ role: "member", updatedAt: new Date() })
      .where(
        and(
          eq(memberships.circleId, circleId),
          eq(memberships.userId, targetUserId),
        ),
      )
      .returning({ id: memberships.id });
    const membershipId = approved[0]?.id;
    if (!membershipId) {
      socialError(
        "INTERNAL_SERVER_ERROR",
        "Unable to approve the pending member",
      );
    }
    await recordMembershipApprovalActivity(tx, {
      recipientId: targetUserId,
      actorId,
      sourceId: membershipId,
      circleId,
    });
  });
  return { success: true };
}

export async function createPost(
  userId: number,
  input: PostPublishInput,
): Promise<Post> {
  const db = await requireDb();
  assertPostPublishOperationId(input.clientPublishId);
  const normalized = {
    text: input.text.trim(),
    media: input.media?.trim() || undefined,
    mediaType: input.mediaType,
    circleId: input.circleId,
    clientPublishId: input.clientPublishId,
  };
  const payloadHash = normalized.clientPublishId
    ? postPublicationPayloadHash(normalized)
    : null;
  await ensureProfileWithDb(db, userId);
  let postId: number;
  try {
    postId = await db.transaction(async (tx) => {
      // Preserve the established circle-parent lock before all membership and publication writes.
      if (normalized.circleId) {
        const { role } = await lockCircleAccessForProtectedMutation(
          tx,
          userId,
          normalized.circleId,
        );
        if (!isApprovedCircleRole(role)) {
          socialError(
            "FORBIDDEN",
            "Only approved members may post to this circle",
          );
        }
      }

      if (normalized.clientPublishId && payloadHash) {
        // The unique insert is the transaction-scoped operation claim. A competing request waits
        // for this transaction, then resolves the one durable receipt instead of creating a post.
        const receiptInsert = postPublishReceiptInsertProjection();
        const claimedReceipt = await tx
          .insert(receiptInsert)
          .values({
            actorId: userId,
            operationId: normalized.clientPublishId,
            payloadHash,
          })
          .onConflictDoNothing({
            target: [
              postPublishReceipts.actorId,
              postPublishReceipts.operationId,
            ],
          })
          .returning({ postId: receiptInsert.postId });

        if (!claimedReceipt[0]) {
          const existingReceipts = await tx
            .select({
              payloadHash: postPublishReceipts.payloadHash,
              postId: postPublishReceipts.postId,
            })
            .from(postPublishReceipts)
            .where(
              and(
                eq(postPublishReceipts.actorId, userId),
                eq(postPublishReceipts.operationId, normalized.clientPublishId),
              ),
            )
            .limit(1)
            .for("update");
          const existing = existingReceipts[0];
          if (!existing) {
            socialError(
              "INTERNAL_SERVER_ERROR",
              "Publication receipt could not be resolved",
            );
          }
          if (existing.payloadHash !== payloadHash) {
            socialError(
              "CONFLICT",
              "Publication operation identifier was already used with different content",
            );
          }
          // Exact retries still revalidate caller ownership and stored MIME inside the boundary.
          await assertPostMediaTypeOwnership(
            tx,
            userId,
            normalized.media,
            normalized.mediaType,
          );
          if (existing.postId === null) {
            socialError(
              "CONFLICT",
              "The original publication was deleted and cannot be recreated",
            );
          }
          return existing.postId;
        }
      }

      const created = await tx
        .insert(posts)
        .values({
          authorId: userId,
          circleId: normalized.circleId ?? null,
          text: normalized.text,
          media: normalized.media ?? null,
          mediaType: normalized.mediaType,
        })
        .returning({ id: posts.id });
      const id = created[0]?.id;
      if (!id) socialError("INTERNAL_SERVER_ERROR", "Unable to create post");
      await claimPostMediaOwnership(
        tx,
        userId,
        normalized.media,
        normalized.mediaType,
      );
      if (normalized.clientPublishId) {
        await tx
          .update(postPublishReceipts)
          .set({ postId: id })
          .where(
            and(
              eq(postPublishReceipts.actorId, userId),
              eq(postPublishReceipts.operationId, normalized.clientPublishId),
            ),
          );
      }
      return id;
    });
  } catch (error) {
    if (
      normalized.clientPublishId &&
      isMissingPostPublishReceiptSchema(error)
    ) {
      socialError(
        "PRECONDITION_FAILED",
        "Retry-safe publishing is temporarily unavailable",
      );
    }
    throw error;
  }
  if (!postId) socialError("INTERNAL_SERVER_ERROR", "Unable to create post");
  return postOutputWithDb(db, postId, userId);
}

export async function toggleLike(
  userId: number,
  postId: number,
  desiredLiked?: boolean,
): Promise<{ liked: boolean }> {
  const db = await requireDb();
  return db.transaction(async (tx) => {
    await assertPostAccessForProtectedMutation(tx, userId, postId);
    const existing = await tx
      .select({ id: reactions.id })
      .from(reactions)
      .where(and(eq(reactions.postId, postId), eq(reactions.userId, userId)))
      .limit(1);
    const liked = desiredLiked ?? !existing.length;
    if (!liked) {
      await tx
        .delete(reactions)
        .where(and(eq(reactions.postId, postId), eq(reactions.userId, userId)));
      return { liked: false };
    }
    await tx
      .insert(reactions)
      .values({ postId, userId, type: "like" })
      .onConflictDoNothing({ target: [reactions.postId, reactions.userId] });
    return { liked: true };
  });
}

export async function toggleSave(
  userId: number,
  postId: number,
  desiredSaved?: boolean,
): Promise<{ saved: boolean }> {
  const db = await requireDb();
  return db.transaction(async (tx) => {
    await assertPostAccessForProtectedMutation(tx, userId, postId);
    const existing = await tx
      .select({ id: bookmarks.id })
      .from(bookmarks)
      .where(and(eq(bookmarks.postId, postId), eq(bookmarks.userId, userId)))
      .limit(1);
    const saved = desiredSaved ?? !existing.length;
    if (!saved) {
      await tx
        .delete(bookmarks)
        .where(and(eq(bookmarks.postId, postId), eq(bookmarks.userId, userId)));
      return { saved: false };
    }
    await tx
      .insert(bookmarks)
      .values({ postId, userId })
      .onConflictDoNothing({ target: [bookmarks.postId, bookmarks.userId] });
    return { saved: true };
  });
}

export async function listComments(
  userId: number | null,
  postId: number,
): Promise<Comment[]> {
  const db = await requireDb();
  return db.transaction(async (tx) => {
    await assertPostAccessForProtectedRead(tx, userId, postId);
    const rows = await tx
      .select()
      .from(comments)
      .where(eq(comments.postId, postId))
      .orderBy(asc(comments.createdAt), asc(comments.id));
    return Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        author: await displayProfileWithDb(tx, row.authorId, userId),
        text: row.text,
        createdAt: toIso(row.createdAt),
      })),
    );
  });
}

export async function createComment(
  userId: number,
  postId: number,
  text: string,
): Promise<Comment> {
  const db = await requireDb();
  await ensureProfileWithDb(db, userId);
  const row = await db.transaction(async (tx) => {
    const access = await assertPostAccessForProtectedMutation(
      tx,
      userId,
      postId,
    );
    const created = await tx
      .insert(comments)
      .values({ authorId: userId, postId, text: text.trim() })
      .returning({
        id: comments.id,
        text: comments.text,
        createdAt: comments.createdAt,
      });
    const row = created[0];
    if (!row) socialError("INTERNAL_SERVER_ERROR", "Unable to create comment");
    await recordCommentActivity(tx, {
      recipientId: access.post.authorId,
      actorId: userId,
      sourceId: row.id,
      postId,
      circleId: access.post.circleId,
    });
    return row;
  });
  if (!row) socialError("INTERNAL_SERVER_ERROR", "Unable to create comment");
  return {
    id: row.id,
    author: await ensureProfileWithDb(db, userId),
    text: row.text,
    createdAt: toIso(row.createdAt),
  };
}

export async function deletePost(
  userId: number,
  postId: number,
): Promise<{ success: true }> {
  const db = await requireDb();
  await db.transaction(async (tx) => {
    const { post, role } = await assertPostAccessForProtectedMutation(
      tx,
      userId,
      postId,
    );
    await deletePostWithAuthority(tx, userId, post, role);
  });
  return { success: true };
}

async function deletePostWithAuthority(
  tx: SocialTransaction,
  userId: number,
  post: { id: number; authorId: number },
  role: CircleRole | null,
): Promise<void> {
  if (post.authorId !== userId && !canModerateCircle(role)) {
    socialError(
      "FORBIDDEN",
      "Only the author or a circle moderator can delete this post",
    );
  }
  await tx.delete(posts).where(eq(posts.id, post.id));
}

/**
 * A moderation removal reuses the ordinary authorized deletion operation in the caller's
 * transaction. It locks the same circle before its scoped post lookup, never opens a nested
 * transaction, and treats a vanished/foreign target as safely unavailable.
 */
export async function deleteCirclePostForModeration(
  tx: SocialTransaction,
  userId: number,
  circleId: number,
  postId: number,
): Promise<boolean> {
  const { role } = await lockCircleAccessForProtectedMutation(
    tx,
    userId,
    circleId,
  );
  if (!canModerateCircle(role)) {
    socialError(
      "FORBIDDEN",
      "Only a current circle owner or moderator may remove reported posts",
    );
  }
  const rows = await tx
    .select({
      id: posts.id,
      authorId: posts.authorId,
      circleId: posts.circleId,
    })
    .from(posts)
    .where(and(eq(posts.id, postId), eq(posts.circleId, circleId)))
    .limit(1);
  const post = rows[0];
  if (!post || post.circleId !== circleId) return false;
  await deletePostWithAuthority(tx, userId, post, role);
  return true;
}

export async function reportPost(
  userId: number,
  postId: number,
  reason: string,
): Promise<{ success: true }> {
  const db = await requireDb();
  await db.transaction(async (tx) => {
    const { post } = await assertPostAccessForProtectedMutation(
      tx,
      userId,
      postId,
    );
    if (post.circleId === null) {
      socialError(
        "FORBIDDEN",
        "Only circle posts can be reported through circle moderation",
      );
    }
    await tx
      .insert(reports)
      .values({ postId, reporterId: userId, reason: reason.trim() })
      .onConflictDoUpdate({
        target: [reports.postId, reports.reporterId],
        set: { reason: reason.trim(), updatedAt: new Date() },
      });
    await recordModerationReport(tx, {
      circleId: post.circleId,
      postId: post.id,
      subjectUserId: post.authorId,
    });
  });
  return { success: true };
}

async function ensureConversationParticipant(
  db: Database | SocialTransaction,
  conversationId: number,
  userId: number,
) {
  await db
    .insert(conversationParticipants)
    .values({ conversationId, userId })
    .onConflictDoNothing({
      target: [
        conversationParticipants.conversationId,
        conversationParticipants.userId,
      ],
    });
}

async function conversationRowOrThrow(
  db: Database | SocialTransaction,
  conversationId: number,
) {
  const rows = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  if (!rows[0]) socialError("NOT_FOUND", "Conversation not found");
  return rows[0];
}

/**
 * sendMessage and markConversationRead both take this row lock before inspecting or changing
 * message/receipt state. This makes a delivered ID watermark safe when a send races an ack.
 */
async function lockConversationForMessageMutation(
  tx: ConversationMutationTransaction,
  conversationId: number,
): Promise<void> {
  const rows = await tx
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1)
    .for("update");
  if (!rows[0]) socialError("NOT_FOUND", "Conversation not found");
}

/** Enforces direct participation or live approved circle membership on every message request. */
async function assertConversationAccess(
  db: Database | SocialTransaction,
  userId: number,
  conversationId: number,
  options: {
    ensureCircleParticipant?: boolean;
    lockCircleForProtectedMutation?: boolean;
  } = {},
) {
  const conversation = await conversationRowOrThrow(db, conversationId);
  if (conversation.kind === "direct") {
    const participant = await db
      .select({ id: conversationParticipants.id })
      .from(conversationParticipants)
      .where(
        and(
          eq(conversationParticipants.conversationId, conversationId),
          eq(conversationParticipants.userId, userId),
        ),
      )
      .limit(1);
    if (!participant.length)
      socialError(
        "FORBIDDEN",
        "You are not a participant in this conversation",
      );
    return conversation;
  }

  if (!conversation.circleId)
    socialError(
      "INTERNAL_SERVER_ERROR",
      "Circle conversation is missing its circle",
    );
  const role = options.lockCircleForProtectedMutation
    ? (
        await lockCircleAccessForProtectedMutation(
          db as SocialTransaction,
          userId,
          conversation.circleId,
        )
      ).role
    : await membershipRoleWithDb(db, userId, conversation.circleId);
  if (!isApprovedCircleRole(role)) {
    socialError(
      "FORBIDDEN",
      "You must be an approved circle member to access this conversation",
    );
  }
  if (options.ensureCircleParticipant) {
    await ensureConversationParticipant(db, conversation.id, userId);
  }
  return conversation;
}

async function conversationOutputWithDb(
  db: Database | SocialTransaction,
  conversationId: number,
  userId: number,
): Promise<Conversation> {
  const conversation = await conversationRowOrThrow(db, conversationId);
  const [lastRows, participantRows] = await Promise.all([
    db
      .select({ text: messages.text, media: messages.media })
      .from(messages)
      .where(eq(messages.conversationId, conversation.id))
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(1),
    db
      .select({
        userId: conversationParticipants.userId,
        lastReadMessageId: conversationParticipants.lastReadMessageId,
      })
      .from(conversationParticipants)
      .where(eq(conversationParticipants.conversationId, conversation.id)),
  ]);
  const currentParticipant = participantRows.find(
    (participant) => participant.userId === userId,
  );
  const unreadWhere = [
    eq(messages.conversationId, conversation.id),
    ne(messages.authorId, userId),
  ];
  unreadWhere.push(gt(messages.id, currentParticipant?.lastReadMessageId ?? 0));
  const unreadRows = await db
    .select({ total: sql<number>`count(*)` })
    .from(messages)
    .where(and(...unreadWhere));

  if (conversation.kind === "circle") {
    if (!conversation.circleId)
      socialError(
        "INTERNAL_SERVER_ERROR",
        "Circle conversation is missing its circle",
      );
    const circle = await circleRowOrThrow(db, conversation.circleId);
    return {
      id: conversation.id,
      name: circle.name,
      avatar: circle.image,
      kind: "circle",
      circleId: circle.id,
      lastMessage: messagePreview(lastRows[0]),
      updatedAt: toIso(conversation.updatedAt),
      unread: countValue(unreadRows[0]?.total),
    };
  }

  const otherParticipant = participantRows.find(
    (participant) => participant.userId !== userId,
  );
  const other = otherParticipant
    ? await displayProfileWithDb(db, otherParticipant.userId, userId)
    : null;
  return {
    id: conversation.id,
    name: other?.name ?? "Direct message",
    avatar: other?.avatar ?? DEFAULT_AVATAR,
    kind: "direct",
    circleId: null,
    lastMessage: messagePreview(lastRows[0]),
    updatedAt: toIso(conversation.updatedAt),
    unread: countValue(unreadRows[0]?.total),
  };
}

/**
 * Circle preview reads share the parent-circle lock used by membership removal. The approved-role
 * check and every preview select are one serialization point; direct threads retain their existing
 * participant predicate without acquiring an unrelated circle lock.
 */
async function authorizedConversationOutputWithDb(
  db: Database,
  conversationId: number,
  userId: number,
): Promise<Conversation> {
  return db.transaction(async (tx) => {
    await assertConversationAccess(tx, userId, conversationId, {
      lockCircleForProtectedMutation: true,
    });
    return conversationOutputWithDb(tx, conversationId, userId);
  });
}

export async function listConversations(
  userId: number,
  conversationId?: number,
): Promise<Conversation[]> {
  const db = await requireDb();
  const directConditions = [
    eq(conversationParticipants.userId, userId),
    eq(conversations.kind, "direct"),
  ];
  if (conversationId !== undefined) {
    directConditions.push(eq(conversations.id, conversationId));
  }
  const directRows = await db
    .select({ id: conversations.id })
    .from(conversationParticipants)
    .innerJoin(
      conversations,
      eq(conversationParticipants.conversationId, conversations.id),
    )
    .where(and(...directConditions));
  const circleConditions = [eq(conversations.kind, "circle")];
  if (conversationId !== undefined) {
    circleConditions.push(eq(conversations.id, conversationId));
  }
  // Do not first materialize a possibly stale membership ID list. The SQL predicate bounds the
  // candidate set; authorizedConversationOutputWithDb rechecks under the parent lock before DTOs.
  circleConditions.push(sql`exists (
    select 1 from ${memberships}
    where ${memberships.circleId} = ${conversations.circleId}
      and ${memberships.userId} = ${userId}
      and ${memberships.role} in ('owner', 'moderator', 'member')
  )`);
  const circleRows = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(...circleConditions));
  const ids = [...new Set([...directRows, ...circleRows].map((row) => row.id))];
  const mapped = await Promise.all(
    ids.map((id) => authorizedConversationOutputWithDb(db, id, userId)),
  );
  return mapped.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function openDirect(
  userId: number,
  targetUserId: number,
): Promise<{ id: number }> {
  if (userId === targetUserId)
    socialError("BAD_REQUEST", "You cannot message yourself");
  const db = await requireDb();
  const target = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, targetUserId))
    .limit(1);
  if (!target.length) socialError("NOT_FOUND", "Profile not found");
  await Promise.all([
    ensureProfileWithDb(db, userId),
    ensureProfileWithDb(db, targetUserId),
  ]);

  const directKey = [userId, targetUserId].sort((a, b) => a - b).join(":");
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.directKey, directKey))
      .limit(1);
    const id = existing[0]?.id;
    if (id) {
      await ensureConversationParticipant(tx, id, userId);
      await ensureConversationParticipant(tx, id, targetUserId);
      return { id };
    }

    const created = await tx
      .insert(conversations)
      .values({ kind: "direct", directKey })
      .onConflictDoNothing({ target: conversations.directKey })
      .returning({ id: conversations.id });
    const createdId =
      created[0]?.id ??
      (
        await tx
          .select({ id: conversations.id })
          .from(conversations)
          .where(eq(conversations.directKey, directKey))
          .limit(1)
      )[0]?.id;
    if (!createdId)
      socialError(
        "INTERNAL_SERVER_ERROR",
        "Unable to open direct conversation",
      );
    // Keep the two writes ordered inside this transaction so an exception after the first one
    // rolls back the conversation and its partial participant set together.
    await ensureConversationParticipant(tx, createdId, userId);
    await ensureConversationParticipant(tx, createdId, targetUserId);
    return { id: createdId };
  });
}

export async function openCircleChat(
  userId: number,
  circleId: number,
): Promise<{ id: number }> {
  const db = await requireDb();
  return db.transaction(async (tx) => {
    const { role } = await lockCircleAccessForProtectedMutation(
      tx,
      userId,
      circleId,
    );
    if (!isApprovedCircleRole(role))
      socialError("FORBIDDEN", "Only approved members may enter circle chat");

    const existing = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.circleId, circleId))
      .limit(1);
    const id = existing[0]?.id;
    if (id) {
      await ensureConversationParticipant(tx, id, userId);
      return { id };
    }

    const created = await tx
      .insert(conversations)
      .values({ kind: "circle", circleId })
      .onConflictDoNothing({ target: conversations.circleId })
      .returning({ id: conversations.id });
    const createdId =
      created[0]?.id ??
      (
        await tx
          .select({ id: conversations.id })
          .from(conversations)
          .where(eq(conversations.circleId, circleId))
          .limit(1)
      )[0]?.id;
    if (!createdId)
      socialError(
        "INTERNAL_SERVER_ERROR",
        "Unable to open circle conversation",
      );
    await ensureConversationParticipant(tx, createdId, userId);
    return { id: createdId };
  });
}

export type ReadReceiptParticipant = {
  userId: number;
  lastReadMessageId: number;
  /** For circle conversations, only a currently approved member is an active receipt source. */
  approved?: boolean;
};

function normalizedMessageReadWatermark(
  value: number | null | undefined,
): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : 0;
}

/** Returns a watermark that cannot move backwards when delayed acknowledgements arrive. */
export function advanceMessageReadWatermark(
  currentMessageId: number | null | undefined,
  throughMessageId: number,
): number {
  return Math.max(
    normalizedMessageReadWatermark(currentMessageId),
    normalizedMessageReadWatermark(throughMessageId),
  );
}

/** Message IDs, not creation timestamps, determine whether a delivered receipt covers a message. */
export function messageIsReadThroughWatermark(
  messageId: number,
  lastReadMessageId: number | null | undefined,
): boolean {
  return (
    Number.isSafeInteger(messageId) &&
    messageId > 0 &&
    messageId <= normalizedMessageReadWatermark(lastReadMessageId)
  );
}

/**
 * Computes the UI's `read` flag without inventing a receipt. Incoming messages use the viewer's
 * own cursor. For authored direct messages the other participant must have read it. For authored
 * circle messages, “Seen” means at least one *other* currently approved member has read it.
 */
export function messageReadForViewer(input: {
  authorId: number;
  viewerId: number;
  kind: "direct" | "circle";
  messageId: number;
  viewerLastReadMessageId: number;
  participants: ReadReceiptParticipant[];
}): boolean {
  if (input.authorId !== input.viewerId) {
    return messageIsReadThroughWatermark(
      input.messageId,
      input.viewerLastReadMessageId,
    );
  }
  if (input.kind === "direct") {
    return input.participants.some(
      (participant) =>
        participant.userId !== input.authorId &&
        messageIsReadThroughWatermark(
          input.messageId,
          participant.lastReadMessageId,
        ),
    );
  }
  return input.participants.some(
    (participant) =>
      participant.userId !== input.authorId &&
      participant.approved === true &&
      messageIsReadThroughWatermark(
        input.messageId,
        participant.lastReadMessageId,
      ),
  );
}

/** A message may consist of text, an owned media reference, or both. */
export function hasMessageContent(
  text: string,
  media?: string | null,
): boolean {
  return Boolean(text.trim() || media?.trim());
}

/** Opaque, client-generated retry nonce; URL-safe to survive native transports and logs. */
const CLIENT_MESSAGE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{15,95}$/;

export function isValidClientMessageId(value: string): boolean {
  return CLIENT_MESSAGE_ID.test(value);
}

/** Inbox previews must distinguish an attachment from an empty conversation. */
export function messagePreview(
  message: { text: string; media: string | null } | undefined,
): string {
  if (!message) return "No messages yet";
  return (
    message.text.trim() || (message.media ? "Attachment" : "No messages yet")
  );
}

export type MessagePageOptions = {
  /** Exclusive older-than message ID. Omit it to receive the newest live page. */
  cursor?: number;
  /** Bounded page size; router validation rejects values outside the public contract. */
  limit?: number;
};

export async function listMessages(
  userId: number,
  conversationId: number,
  options: MessagePageOptions = {},
): Promise<Message[]> {
  const db = await requireDb();
  return db.transaction(async (tx) => {
    const conversation = await assertConversationAccess(
      tx,
      userId,
      conversationId,
      { lockCircleForProtectedMutation: true },
    );
    const pageLimit = Math.min(
      Math.max(Math.floor(options.limit ?? MESSAGE_PAGE_DEFAULT_LIMIT), 1),
      MESSAGE_PAGE_MAX_LIMIT,
    );
    const participantRows = await tx
      .select({ lastReadMessageId: conversationParticipants.lastReadMessageId })
      .from(conversationParticipants)
      .where(
        and(
          eq(conversationParticipants.conversationId, conversationId),
          eq(conversationParticipants.userId, userId),
        ),
      )
      .limit(1);
    const allParticipants = await tx
      .select({
        userId: conversationParticipants.userId,
        lastReadMessageId: conversationParticipants.lastReadMessageId,
      })
      .from(conversationParticipants)
      .where(eq(conversationParticipants.conversationId, conversationId));
    const activeCircleMemberIds = new Set<number>();
    if (conversation.kind === "circle" && conversation.circleId) {
      const activeMembers = await tx
        .select({ userId: memberships.userId })
        .from(memberships)
        .where(
          and(
            eq(memberships.circleId, conversation.circleId),
            inArray(memberships.role, ["owner", "moderator", "member"]),
          ),
        );
      activeMembers.forEach((member) =>
        activeCircleMemberIds.add(member.userId),
      );
    }
    const viewerLastReadMessageId = participantRows[0]?.lastReadMessageId ?? 0;
    const rows = await tx
      .select()
      .from(messages)
      .where(
        options.cursor
          ? and(
              eq(messages.conversationId, conversationId),
              lt(messages.id, options.cursor),
            )
          : eq(messages.conversationId, conversationId),
      )
      .orderBy(desc(messages.id))
      .limit(pageLimit);
    // The database reads newest-first so the exclusive ID cursor is efficient. Existing callers
    // and renderers receive an ascending page, with ID resolving tied database timestamps.
    rows.reverse();
    return Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        conversationId: row.conversationId,
        author: await displayProfileWithDb(tx, row.authorId, userId),
        text: row.text,
        media: row.media,
        createdAt: toIso(row.createdAt),
        read: messageReadForViewer({
          authorId: row.authorId,
          viewerId: userId,
          kind: conversation.kind,
          messageId: row.id,
          viewerLastReadMessageId,
          participants: allParticipants.map((participant) => ({
            ...participant,
            approved:
              conversation.kind === "direct" ||
              activeCircleMemberIds.has(participant.userId),
          })),
        }),
      })),
    );
  });
}

export async function sendMessage(
  userId: number,
  conversationId: number,
  input: { text: string; media?: string; clientMessageId?: string },
): Promise<Message> {
  const text = input.text.trim();
  const media = input.media?.trim() || undefined;
  const clientMessageId = input.clientMessageId?.trim() || undefined;
  if (!hasMessageContent(text, media))
    socialError("BAD_REQUEST", "A message needs text or media");
  if (clientMessageId && !isValidClientMessageId(clientMessageId)) {
    socialError("BAD_REQUEST", "Invalid client message ID");
  }
  const db = await requireDb();
  const { row } = await db.transaction(async (tx) => {
    await lockConversationForMessageMutation(tx, conversationId);
    await assertConversationAccess(tx, userId, conversationId, {
      ensureCircleParticipant: true,
      lockCircleForProtectedMutation: true,
    });
    if (clientMessageId) {
      const existing = await tx
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, conversationId),
            eq(messages.authorId, userId),
            eq(messages.clientMessageId, clientMessageId),
          ),
        )
        .limit(1);
      if (existing[0]) {
        if (
          existing[0].text !== text ||
          existing[0].media !== (media ?? null)
        ) {
          socialError(
            "CONFLICT",
            "A client message ID cannot be reused with different content",
          );
        }
        return { row: existing[0] };
      }
    }
    // The attachment check and ownership claim live with message insertion. A failed insert
    // cannot consume an upload, and a nonce retry rejects changed payload before new media work.
    await assertMediaOwnership(tx, userId, media);
    const created = await tx
      .insert(messages)
      .values({
        conversationId,
        authorId: userId,
        text,
        media: media ?? null,
        clientMessageId: clientMessageId ?? null,
      })
      .returning();
    const message = created[0];
    if (!message)
      socialError("INTERNAL_SERVER_ERROR", "Unable to send message");
    await claimMediaOwnership(tx, userId, media);
    // Keep message allocation and list recency in the same transaction and conversation lock.
    await tx
      .update(conversations)
      .set({ updatedAt: new Date() })
      .where(eq(conversations.id, conversationId));
    return { row: message };
  });
  return {
    id: row.id,
    conversationId,
    author: await ensureProfileWithDb(db, userId),
    text: row.text,
    media: row.media,
    createdAt: toIso(row.createdAt),
    // The existing response contract has no per-recipient receipt in this mutation result.
    read: false,
  };
}

export async function markConversationRead(
  userId: number,
  conversationId: number,
  throughMessageId: number,
): Promise<{ success: true }> {
  const db = await requireDb();
  await db.transaction(async (tx) => {
    await lockConversationForMessageMutation(tx, conversationId);
    await assertConversationAccess(tx, userId, conversationId, {
      ensureCircleParticipant: true,
      lockCircleForProtectedMutation: true,
    });
    const delivered = await tx
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          eq(messages.id, throughMessageId),
        ),
      )
      .limit(1);
    if (!delivered[0]) {
      socialError(
        "BAD_REQUEST",
        "Delivered message does not belong to this conversation",
      );
    }

    const existing = await tx
      .select({
        id: conversationParticipants.id,
        lastReadMessageId: conversationParticipants.lastReadMessageId,
      })
      .from(conversationParticipants)
      .where(
        and(
          eq(conversationParticipants.conversationId, conversationId),
          eq(conversationParticipants.userId, userId),
        ),
      )
      .limit(1);
    const now = new Date();
    const nextMessageId = advanceMessageReadWatermark(
      existing[0]?.lastReadMessageId,
      throughMessageId,
    );
    if (existing[0]) {
      if (nextMessageId > existing[0].lastReadMessageId) {
        await tx
          .update(conversationParticipants)
          .set({
            lastReadMessageId: nextMessageId,
            lastReadAt: now,
            updatedAt: now,
          })
          .where(eq(conversationParticipants.id, existing[0].id));
      }
    } else {
      await tx.insert(conversationParticipants).values({
        conversationId,
        userId,
        lastReadMessageId: nextMessageId,
        lastReadAt: now,
      });
    }
  });
  return { success: true };
}

export async function recordUpload(
  userId: number,
  upload: { key: string; url: string; mimeType: string; bytes: number },
): Promise<{ url: string }> {
  const db = await requireDb();
  const url = managedSocialMediaUrlForKey(upload.key);
  if (!url || upload.url !== url) {
    socialError(
      "INTERNAL_SERVER_ERROR",
      "Upload did not produce a canonical managed media URL",
    );
  }
  await db.insert(socialUploads).values({
    userId,
    storageKey: upload.key,
    url,
    mimeType: upload.mimeType,
    bytes: upload.bytes,
  });
  return { url };
}
