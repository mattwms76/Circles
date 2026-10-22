import {
  and,
  asc,
  desc,
  eq,
  gt,
  ilike,
  inArray,
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
import type {
  Circle,
  Comment,
  Conversation,
  Member,
  Message,
  Post,
  Profile,
} from "../shared/social";
import {
  MESSAGE_PAGE_DEFAULT_LIMIT,
  MESSAGE_PAGE_MAX_LIMIT,
} from "../shared/message-pagination";
import {
  getDb,
  type CirclesDatabase,
  type CirclesTransaction,
} from "./db";

export type CircleRole = "owner" | "moderator" | "member" | "pending";
type ApprovedCircleRole = Exclude<CircleRole, "pending">;
type Database = CirclesDatabase;
type ConversationMutationTransaction = CirclesTransaction;
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
  db: Database,
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

async function circleRowOrThrow(db: Database, circleId: number) {
  const rows = await db
    .select()
    .from(circles)
    .where(eq(circles.id, circleId))
    .limit(1);
  if (!rows[0]) socialError("NOT_FOUND", "Circle not found");
  return rows[0];
}

async function postRowOrThrow(db: Database, postId: number) {
  const rows = await db
    .select()
    .from(posts)
    .where(eq(posts.id, postId))
    .limit(1);
  if (!rows[0]) socialError("NOT_FOUND", "Post not found");
  return rows[0];
}

async function findProfileWithDb(
  db: Database,
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
  db: Database,
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
  db: Database,
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

async function assertCircleContentAccess(
  db: Database,
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
  db: Database,
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

async function postOutputWithDb(
  db: Database,
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
      displayProfileWithDb(db, post.authorId, post.authorId),
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

const FEED_PAGE_SIZE = 100;
const FEED_SCAN_BATCH_SIZE = 200;

type FeedScanCursor = {
  createdAt: Date;
  id: number;
};

type FeedScanCandidate = FeedScanCursor & {
  circleId: number | null;
};

/**
 * Reads newest-first post batches until the requested eligible page is full or no older posts
 * remain. The compound cursor keeps equal-timestamp posts in a stable order between batches.
 */
export async function collectEligibleFeedPostIds(
  readPage: (cursor: FeedScanCursor | null) => Promise<FeedScanCandidate[]>,
  isEligible: (post: FeedScanCandidate) => Promise<boolean>,
): Promise<number[]> {
  const eligiblePostIds: number[] = [];
  let cursor: FeedScanCursor | null = null;

  while (eligiblePostIds.length < FEED_PAGE_SIZE) {
    const candidates = await readPage(cursor);
    if (!candidates.length) break;

    for (const candidate of candidates) {
      if (await isEligible(candidate)) {
        eligiblePostIds.push(candidate.id);
        if (eligiblePostIds.length === FEED_PAGE_SIZE) return eligiblePostIds;
      }
    }

    if (candidates.length < FEED_SCAN_BATCH_SIZE) break;
    const oldestCandidate = candidates[candidates.length - 1];
    cursor = { createdAt: oldestCandidate.createdAt, id: oldestCandidate.id };
  }

  return eligiblePostIds;
}

export async function feed(
  viewerId: number | null,
  filter: FeedFilter,
  circleId?: number,
  authorId?: number,
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
      const cursorClauses = cursor
        ? [
            ...clauses,
            or(
              lt(posts.createdAt, cursor.createdAt),
              and(
                eq(posts.createdAt, cursor.createdAt),
                lt(posts.id, cursor.id),
              ),
            ),
          ]
        : clauses;
      return db
        .select()
        .from(posts)
        .where(cursorClauses.length ? and(...cursorClauses) : undefined)
        .orderBy(desc(posts.createdAt), desc(posts.id))
        .limit(FEED_SCAN_BATCH_SIZE);
    },
    async (post) => {
      if (!post.circleId) return true;
      const circle = await db
        .select()
        .from(circles)
        .where(eq(circles.id, post.circleId))
        .limit(1);
      if (!circle[0]) return false;
      const role = await membershipRoleWithDb(db, viewerId, post.circleId);
      return canReadCircleContent(circle[0].privacy, role);
    },
  );

  const output = await Promise.all(
    visiblePostIds.map((postId) => postOutputWithDb(db, postId, viewerId)),
  );
  return output;
}

async function assertMediaOwnership(
  db: Database,
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
    await db
      .update(profiles)
      .set({
        name: input.name.trim(),
        handle: input.handle.trim().replace(/^@+/, "").toLowerCase(),
        bio: input.bio.trim(),
        updatedAt: new Date(),
        ...(input.avatar !== undefined ? { avatar: input.avatar } : {}),
      })
      .where(eq(profiles.userId, userId));
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

  const existing = await db
    .select({ id: follows.id })
    .from(follows)
    .where(
      and(
        eq(follows.followerId, userId),
        eq(follows.followingId, targetUserId),
      ),
    )
    .limit(1);
  if (existing[0]) {
    await db.delete(follows).where(eq(follows.id, existing[0].id));
    return { following: false };
  }
  await db
    .insert(follows)
    .values({ followerId: userId, followingId: targetUserId });
  return { following: true };
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
  await ensureProfileWithDb(db, userId);
  await assertMediaOwnership(db, userId, input.image);
  const circleId = await db.transaction(async (tx) => {
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
    return id;
  });
  return circleOutputWithDb(db, circleId, userId);
}

export async function joinCircle(
  userId: number,
  circleId: number,
): Promise<{ role: string | null }> {
  const db = await requireDb();
  const circle = await circleRowOrThrow(db, circleId);
  const requestedRole: CircleRole =
    circle.privacy === "private" ? "pending" : "member";

  // Preserve an existing pending or privileged role when concurrent join requests collide.
  await db
    .insert(memberships)
    .values({ circleId, userId, role: requestedRole })
    .onConflictDoNothing({
      target: [memberships.circleId, memberships.userId],
    });

  const persistedRole = await membershipRoleWithDb(db, userId, circleId);
  if (!persistedRole) {
    socialError("INTERNAL_SERVER_ERROR", "Unable to confirm circle membership");
  }
  return { role: persistedRole };
}

export async function leaveCircle(
  userId: number,
  circleId: number,
): Promise<{ success: true }> {
  const db = await requireDb();
  const role = await membershipRoleWithDb(db, userId, circleId);
  if (!role) socialError("NOT_FOUND", "You are not a member of this circle");
  if (role === "owner")
    socialError("FORBIDDEN", "The circle owner cannot leave their circle");
  await db
    .delete(memberships)
    .where(
      and(eq(memberships.circleId, circleId), eq(memberships.userId, userId)),
    );
  return { success: true };
}

export async function listMembers(
  userId: number | null,
  circleId: number,
): Promise<Member[]> {
  const db = await requireDb();
  const circle = await circleRowOrThrow(db, circleId);
  const viewerRole = await membershipRoleWithDb(db, userId, circleId);
  if (
    circle.privacy === "private" &&
    !canReadCircleContent(circle.privacy, viewerRole)
  ) {
    socialError(
      "FORBIDDEN",
      "You must be an approved member to access this private circle",
    );
  }
  const rows = await db
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
  const output = await Promise.all(
    rows.map(async (row) => {
      const user = await displayProfileWithDb(db, row.userId, row.userId);
      return { user, role: row.role as CircleRole };
    }),
  );
  return output;
}

async function getActorAndTargetRoles(
  db: Database,
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
  const { actorRole, targetRole } = await getActorAndTargetRoles(
    db,
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
  await db
    .update(memberships)
    .set({ role, updatedAt: new Date() })
    .where(
      and(
        eq(memberships.circleId, circleId),
        eq(memberships.userId, targetUserId),
      ),
    );
  return { success: true };
}

export async function removeMember(
  actorId: number,
  circleId: number,
  targetUserId: number,
): Promise<{ success: true }> {
  const db = await requireDb();
  const { actorRole, targetRole } = await getActorAndTargetRoles(
    db,
    actorId,
    circleId,
    targetUserId,
  );
  if (!canRemoveCircleMember(actorRole, targetRole)) {
    socialError("FORBIDDEN", "You cannot remove this circle member");
  }
  await db
    .delete(memberships)
    .where(
      and(
        eq(memberships.circleId, circleId),
        eq(memberships.userId, targetUserId),
      ),
    );
  return { success: true };
}

export async function approveMember(
  actorId: number,
  circleId: number,
  targetUserId: number,
): Promise<{ success: true }> {
  const db = await requireDb();
  const { actorRole, targetRole } = await getActorAndTargetRoles(
    db,
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
  await db
    .update(memberships)
    .set({ role: "member", updatedAt: new Date() })
    .where(
      and(
        eq(memberships.circleId, circleId),
        eq(memberships.userId, targetUserId),
      ),
    );
  return { success: true };
}

export async function createPost(
  userId: number,
  input: {
    text: string;
    media?: string;
    mediaType: "text" | "photo" | "video";
    circleId?: number;
  },
): Promise<Post> {
  const db = await requireDb();
  await ensureProfileWithDb(db, userId);
  if (input.circleId) {
    const { role } = await assertCircleContentAccess(
      db,
      userId,
      input.circleId,
    );
    if (!isApprovedCircleRole(role)) {
      socialError("FORBIDDEN", "Only approved members may post to this circle");
    }
  }
  await assertMediaOwnership(db, userId, input.media);
  const created = await db
    .insert(posts)
    .values({
      authorId: userId,
      circleId: input.circleId ?? null,
      text: input.text.trim(),
      media: input.media?.trim() || null,
      mediaType: input.mediaType,
    })
    .returning({ id: posts.id });
  const postId = created[0]?.id;
  if (!postId) socialError("INTERNAL_SERVER_ERROR", "Unable to create post");
  return postOutputWithDb(db, postId, userId);
}

export async function toggleLike(
  userId: number,
  postId: number,
): Promise<{ liked: boolean }> {
  const db = await requireDb();
  await assertPostAccess(db, userId, postId);
  const existing = await db
    .select({ id: reactions.id })
    .from(reactions)
    .where(and(eq(reactions.postId, postId), eq(reactions.userId, userId)))
    .limit(1);
  if (existing[0]) {
    await db.delete(reactions).where(eq(reactions.id, existing[0].id));
    return { liked: false };
  }
  await db.insert(reactions).values({ postId, userId, type: "like" });
  return { liked: true };
}

export async function toggleSave(
  userId: number,
  postId: number,
): Promise<{ saved: boolean }> {
  const db = await requireDb();
  await assertPostAccess(db, userId, postId);
  const existing = await db
    .select({ id: bookmarks.id })
    .from(bookmarks)
    .where(and(eq(bookmarks.postId, postId), eq(bookmarks.userId, userId)))
    .limit(1);
  if (existing[0]) {
    await db.delete(bookmarks).where(eq(bookmarks.id, existing[0].id));
    return { saved: false };
  }
  await db.insert(bookmarks).values({ postId, userId });
  return { saved: true };
}

export async function listComments(
  userId: number | null,
  postId: number,
): Promise<Comment[]> {
  const db = await requireDb();
  await assertPostAccess(db, userId, postId);
  const rows = await db
    .select()
    .from(comments)
    .where(eq(comments.postId, postId))
    .orderBy(asc(comments.createdAt), asc(comments.id));
  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      author: await displayProfileWithDb(db, row.authorId, row.authorId),
      text: row.text,
      createdAt: toIso(row.createdAt),
    })),
  );
}

export async function createComment(
  userId: number,
  postId: number,
  text: string,
): Promise<Comment> {
  const db = await requireDb();
  await assertPostAccess(db, userId, postId);
  await ensureProfileWithDb(db, userId);
  const created = await db
    .insert(comments)
    .values({ authorId: userId, postId, text: text.trim() })
    .returning({
      id: comments.id,
      text: comments.text,
      createdAt: comments.createdAt,
    });
  const row = created[0];
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
  const { post, role } = await assertPostAccess(db, userId, postId);
  if (post.authorId !== userId && !canModerateCircle(role)) {
    socialError(
      "FORBIDDEN",
      "Only the author or a circle moderator can delete this post",
    );
  }
  await db.delete(posts).where(eq(posts.id, postId));
  return { success: true };
}

export async function reportPost(
  userId: number,
  postId: number,
  reason: string,
): Promise<{ success: true }> {
  const db = await requireDb();
  await assertPostAccess(db, userId, postId);
  await db
    .insert(reports)
    .values({ postId, reporterId: userId, reason: reason.trim() })
    .onConflictDoUpdate({
      target: [reports.postId, reports.reporterId],
      set: { reason: reason.trim(), updatedAt: new Date() },
    });
  return { success: true };
}

async function ensureConversationParticipant(
  db: Database,
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

async function conversationRowOrThrow(db: Database, conversationId: number) {
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
  db: Database,
  userId: number,
  conversationId: number,
  options: { ensureCircleParticipant?: boolean } = {},
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
  const role = await membershipRoleWithDb(db, userId, conversation.circleId);
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
  db: Database,
  conversationId: number,
  userId: number,
): Promise<Conversation> {
  const conversation = await conversationRowOrThrow(db, conversationId);
  const [lastRows, participantRows] = await Promise.all([
    db
      .select({ text: messages.text })
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
      lastMessage: lastRows[0]?.text ?? "No messages yet",
      updatedAt: toIso(conversation.updatedAt),
      unread: countValue(unreadRows[0]?.total),
    };
  }

  const otherParticipant = participantRows.find(
    (participant) => participant.userId !== userId,
  );
  const other = otherParticipant
    ? await displayProfileWithDb(
        db,
        otherParticipant.userId,
        otherParticipant.userId,
      )
    : null;
  return {
    id: conversation.id,
    name: other?.name ?? "Direct message",
    avatar: other?.avatar ?? DEFAULT_AVATAR,
    kind: "direct",
    circleId: null,
    lastMessage: lastRows[0]?.text ?? "No messages yet",
    updatedAt: toIso(conversation.updatedAt),
    unread: countValue(unreadRows[0]?.total),
  };
}

export async function listConversations(
  userId: number,
): Promise<Conversation[]> {
  const db = await requireDb();
  const directRows = await db
    .select({ id: conversations.id })
    .from(conversationParticipants)
    .innerJoin(
      conversations,
      eq(conversationParticipants.conversationId, conversations.id),
    )
    .where(
      and(
        eq(conversationParticipants.userId, userId),
        eq(conversations.kind, "direct"),
      ),
    );
  const circleMemberships = await db
    .select({ circleId: memberships.circleId })
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, userId),
        inArray(memberships.role, ["owner", "moderator", "member"]),
      ),
    );
  const circleRows = circleMemberships.length
    ? await db
        .select({ id: conversations.id })
        .from(conversations)
        .where(
          and(
            eq(conversations.kind, "circle"),
            inArray(
              conversations.circleId,
              circleMemberships.map((row) => row.circleId),
            ),
          ),
        )
    : [];
  const ids = [...new Set([...directRows, ...circleRows].map((row) => row.id))];
  const mapped = await Promise.all(
    ids.map((id) => conversationOutputWithDb(db, id, userId)),
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
  const existing = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.directKey, directKey))
    .limit(1);
  const id = existing[0]?.id;
  if (id) {
    await Promise.all([
      ensureConversationParticipant(db, id, userId),
      ensureConversationParticipant(db, id, targetUserId),
    ]);
    return { id };
  }

  const created = await db
    .insert(conversations)
    .values({ kind: "direct", directKey })
    .onConflictDoNothing({ target: conversations.directKey })
    .returning({ id: conversations.id });
  const createdId =
    created[0]?.id ??
    (
      await db
        .select({ id: conversations.id })
        .from(conversations)
        .where(eq(conversations.directKey, directKey))
        .limit(1)
    )[0]?.id;
  if (!createdId)
    socialError("INTERNAL_SERVER_ERROR", "Unable to open direct conversation");
  await Promise.all([
    ensureConversationParticipant(db, createdId, userId),
    ensureConversationParticipant(db, createdId, targetUserId),
  ]);
  return { id: createdId };
}

export async function openCircleChat(
  userId: number,
  circleId: number,
): Promise<{ id: number }> {
  const db = await requireDb();
  const { role } = await assertCircleContentAccess(db, userId, circleId);
  if (!isApprovedCircleRole(role))
    socialError("FORBIDDEN", "Only approved members may enter circle chat");

  const existing = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.circleId, circleId))
    .limit(1);
  const id = existing[0]?.id;
  if (id) {
    await ensureConversationParticipant(db, id, userId);
    return { id };
  }

  const created = await db
    .insert(conversations)
    .values({ kind: "circle", circleId })
    .onConflictDoNothing({ target: conversations.circleId })
    .returning({ id: conversations.id });
  const createdId =
    created[0]?.id ??
    (
      await db
        .select({ id: conversations.id })
        .from(conversations)
        .where(eq(conversations.circleId, circleId))
        .limit(1)
    )[0]?.id;
  if (!createdId)
    socialError("INTERNAL_SERVER_ERROR", "Unable to open circle conversation");
  await ensureConversationParticipant(db, createdId, userId);
  return { id: createdId };
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
  const conversation = await assertConversationAccess(
    db,
    userId,
    conversationId,
  );
  const pageLimit = Math.min(
    Math.max(Math.floor(options.limit ?? MESSAGE_PAGE_DEFAULT_LIMIT), 1),
    MESSAGE_PAGE_MAX_LIMIT,
  );
  const participantRows = await db
    .select({ lastReadMessageId: conversationParticipants.lastReadMessageId })
    .from(conversationParticipants)
    .where(
      and(
        eq(conversationParticipants.conversationId, conversationId),
        eq(conversationParticipants.userId, userId),
      ),
    )
    .limit(1);
  const allParticipants = await db
    .select({
      userId: conversationParticipants.userId,
      lastReadMessageId: conversationParticipants.lastReadMessageId,
    })
    .from(conversationParticipants)
    .where(eq(conversationParticipants.conversationId, conversationId));
  const activeCircleMemberIds = new Set<number>();
  if (conversation.kind === "circle" && conversation.circleId) {
    const activeMembers = await db
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(
        and(
          eq(memberships.circleId, conversation.circleId),
          inArray(memberships.role, ["owner", "moderator", "member"]),
        ),
      );
    activeMembers.forEach((member) => activeCircleMemberIds.add(member.userId));
  }
  const viewerLastReadMessageId = participantRows[0]?.lastReadMessageId ?? 0;
  const rows = await db
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
      author: await displayProfileWithDb(db, row.authorId, row.authorId),
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
}

export async function sendMessage(
  userId: number,
  conversationId: number,
  input: { text: string; media?: string },
): Promise<Message> {
  const text = input.text.trim();
  const media = input.media?.trim() || undefined;
  if (!hasMessageContent(text, media))
    socialError("BAD_REQUEST", "A message needs text or media");
  const db = await requireDb();
  await assertConversationAccess(db, userId, conversationId, {
    ensureCircleParticipant: true,
  });
  await assertMediaOwnership(db, userId, media);
  const row = await db.transaction(async (tx) => {
    await lockConversationForMessageMutation(tx, conversationId);
    const created = await tx
      .insert(messages)
      .values({
        conversationId,
        authorId: userId,
        text,
        media: media ?? null,
      })
      .returning();
    const message = created[0];
    if (!message)
      socialError("INTERNAL_SERVER_ERROR", "Unable to send message");
    // Keep message allocation and list recency in the same transaction and conversation lock.
    await tx
      .update(conversations)
      .set({ updatedAt: new Date() })
      .where(eq(conversations.id, conversationId));
    return message;
  });
  return {
    id: row.id,
    conversationId,
    author: await ensureProfileWithDb(db, userId),
    text: row.text,
    media: row.media,
    createdAt: toIso(row.createdAt),
    // No recipient has had an opportunity to advance a read cursor at send time.
    read: false,
  };
}

export async function markConversationRead(
  userId: number,
  conversationId: number,
  throughMessageId: number,
): Promise<{ success: true }> {
  const db = await requireDb();
  await assertConversationAccess(db, userId, conversationId, {
    ensureCircleParticipant: true,
  });
  await db.transaction(async (tx) => {
    await lockConversationForMessageMutation(tx, conversationId);
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
