import { and, asc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  socialUploadBudgets,
  socialUploadReservations,
} from "../drizzle/media-upload-budget-schema";
import { socialUploads } from "../drizzle/schema";
import { managedSocialMediaUrlForKey } from "../shared/media";
import type { CirclesDatabase, CirclesTransaction } from "./db";
import { inspectMediaUploadBudgetContract } from "./media-upload-budget-contract";

export const MAX_SOCIAL_UPLOAD_RESERVED_OBJECTS = 64;
export const MAX_SOCIAL_UPLOAD_RESERVED_BYTES = 512 * 1024 * 1024;
export const MEDIA_UPLOAD_RECONCILIATION_AFTER_MS = 24 * 60 * 60 * 1000;
export const MAX_MEDIA_UPLOAD_RECONCILIATION_ROWS = 200;

type MediaUploadBudgetExecutor = CirclesDatabase | CirclesTransaction;

export type SocialUploadReservation = {
  reservationId: string;
  userId: number;
  storageKey: string;
  url: string;
  objectBytes: number;
};

export class MediaUploadBudgetExhaustedError extends Error {
  constructor() {
    super("Media upload budget is exhausted");
    this.name = "MediaUploadBudgetExhaustedError";
  }
}

/** A generic error prevents private schema details from being surfaced by the upload route. */
export class MediaUploadBudgetUnavailableError extends Error {
  constructor() {
    super("Media upload lifecycle is unavailable");
    this.name = "MediaUploadBudgetUnavailableError";
  }
}

function isBudgetError(error: unknown): boolean {
  return (
    error instanceof MediaUploadBudgetExhaustedError ||
    error instanceof MediaUploadBudgetUnavailableError
  );
}

function checkedReservationInput(input: SocialUploadReservation): void {
  if (
    !Number.isSafeInteger(input.userId) ||
    input.userId < 1 ||
    !Number.isSafeInteger(input.objectBytes) ||
    input.objectBytes < 1 ||
    input.objectBytes > MAX_SOCIAL_UPLOAD_RESERVED_BYTES ||
    !input.reservationId ||
    input.reservationId.length > 64 ||
    !input.storageKey ||
    input.storageKey.length > 1024 ||
    managedSocialMediaUrlForKey(input.storageKey) !== input.url
  ) {
    throw new MediaUploadBudgetUnavailableError();
  }
}

/**
 * Atomically charges an account before a provider PUT is attempted. A failed or ambiguous PUT is
 * intentionally not refunded: this adapter has no provider-side existence/delete capability.
 */
export async function reserveSocialUploadBudget(
  db: CirclesDatabase,
  input: Omit<SocialUploadReservation, "reservationId" | "url"> & {
    reservationId?: string;
  },
): Promise<SocialUploadReservation> {
  const reservation: SocialUploadReservation = {
    reservationId: input.reservationId ?? randomUUID(),
    userId: input.userId,
    storageKey: input.storageKey,
    url: managedSocialMediaUrlForKey(input.storageKey) ?? "",
    objectBytes: input.objectBytes,
  };
  checkedReservationInput(reservation);
  // This catalog audit runs before the first ledger write and therefore before any caller can
  // reach storagePut. An absent, partially applied, or privilege/RLS-drifted schema fails closed.
  if (!(await isMediaUploadBudgetReady(db))) {
    throw new MediaUploadBudgetUnavailableError();
  }

  try {
    return await db.transaction(async (transaction) => {
      await transaction
        .insert(socialUploadBudgets)
        .values({ userId: reservation.userId })
        .onConflictDoNothing();

      const charged = await transaction
        .update(socialUploadBudgets)
        .set({
          reservedObjects: sql`${socialUploadBudgets.reservedObjects} + 1`,
          reservedBytes: sql`${socialUploadBudgets.reservedBytes} + ${reservation.objectBytes}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(socialUploadBudgets.userId, reservation.userId),
            sql`${socialUploadBudgets.reservedObjects} < ${MAX_SOCIAL_UPLOAD_RESERVED_OBJECTS}`,
            sql`${socialUploadBudgets.reservedBytes} + ${reservation.objectBytes}::integer <= ${MAX_SOCIAL_UPLOAD_RESERVED_BYTES}::integer`,
          ),
        )
        .returning({ userId: socialUploadBudgets.userId });
      if (!charged[0]) throw new MediaUploadBudgetExhaustedError();

      await transaction.insert(socialUploadReservations).values({
        reservationId: reservation.reservationId,
        userId: reservation.userId,
        storageKey: reservation.storageKey,
        url: reservation.url,
        objectBytes: reservation.objectBytes,
        state: "put_started",
      });
      return reservation;
    });
  } catch (error) {
    if (isBudgetError(error)) throw error;
    throw new MediaUploadBudgetUnavailableError();
  }
}

/** Records an acknowledged PUT without ever decreasing the durable account charge. */
export async function confirmSocialUploadPut(
  db: CirclesDatabase,
  reservation: SocialUploadReservation,
): Promise<void> {
  checkedReservationInput(reservation);
  try {
    const updated = await db
      .update(socialUploadReservations)
      .set({ state: "uploaded", putConfirmedAt: new Date() })
      .where(
        and(
          eq(socialUploadReservations.reservationId, reservation.reservationId),
          eq(socialUploadReservations.userId, reservation.userId),
          eq(socialUploadReservations.storageKey, reservation.storageKey),
          eq(socialUploadReservations.url, reservation.url),
          eq(socialUploadReservations.state, "put_started"),
        ),
      )
      .returning({ reservationId: socialUploadReservations.reservationId });
    if (!updated[0]) throw new MediaUploadBudgetUnavailableError();
  } catch (error) {
    if (isBudgetError(error)) throw error;
    throw new MediaUploadBudgetUnavailableError();
  }
}

/**
 * Runs inside the socialUploads metadata transaction. A failed metadata write leaves the charged
 * reservation `uploaded`, making the provider object an explicit reconciliation candidate.
 */
export async function recordSocialUploadMetadata(
  transaction: MediaUploadBudgetExecutor,
  reservation: SocialUploadReservation,
): Promise<void> {
  checkedReservationInput(reservation);
  try {
    const updated = await transaction
      .update(socialUploadReservations)
      .set({ state: "recorded", metadataRecordedAt: new Date() })
      .where(
        and(
          eq(socialUploadReservations.reservationId, reservation.reservationId),
          eq(socialUploadReservations.userId, reservation.userId),
          eq(socialUploadReservations.storageKey, reservation.storageKey),
          eq(socialUploadReservations.url, reservation.url),
          eq(socialUploadReservations.state, "uploaded"),
        ),
      )
      .returning({ reservationId: socialUploadReservations.reservationId });
    if (!updated[0]) throw new MediaUploadBudgetUnavailableError();
  } catch (error) {
    if (isBudgetError(error)) throw error;
    throw new MediaUploadBudgetUnavailableError();
  }
}

export type MediaUploadReconciliationCandidate = {
  reservationId: string;
  userId: number;
  storageKey: string;
  url: string;
  objectBytes: number;
  putStartedAt: Date;
  classification:
    | "unknown_after_put_attempt"
    | "orphaned_after_put"
    | "discarded_metadata";
};

export type MediaUploadReconciliationPage = {
  candidates: MediaUploadReconciliationCandidate[];
  nextCursor: { putStartedAt: Date; reservationId: string } | null;
};

/**
 * Operator-only dry-run inventory. It changes no lifecycle state, schedules no work, and never
 * releases a quota charge; provider confirmation and any deletion decision remain separate gates.
 */
export async function listMediaUploadReconciliationCandidates(
  db: CirclesDatabase,
  options: {
    now?: Date;
    limit?: number;
    cursor?: { putStartedAt: Date; reservationId: string };
  } = {},
): Promise<MediaUploadReconciliationPage> {
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - MEDIA_UPLOAD_RECONCILIATION_AFTER_MS);
  const limit = Math.min(
    Math.max(1, options.limit ?? MAX_MEDIA_UPLOAD_RECONCILIATION_ROWS),
    MAX_MEDIA_UPLOAD_RECONCILIATION_ROWS,
  );
  const cursorClause = options.cursor
    ? or(
        gt(socialUploadReservations.putStartedAt, options.cursor.putStartedAt),
        and(
          eq(
            socialUploadReservations.putStartedAt,
            options.cursor.putStartedAt,
          ),
          gt(
            socialUploadReservations.reservationId,
            options.cursor.reservationId,
          ),
        ),
      )
    : undefined;

  try {
    const rows = await db
      .select({
        reservationId: socialUploadReservations.reservationId,
        userId: socialUploadReservations.userId,
        storageKey: socialUploadReservations.storageKey,
        url: socialUploadReservations.url,
        objectBytes: socialUploadReservations.objectBytes,
        state: socialUploadReservations.state,
        putStartedAt: socialUploadReservations.putStartedAt,
        uploadMetadataId: socialUploads.id,
      })
      .from(socialUploadReservations)
      .leftJoin(
        socialUploads,
        eq(socialUploads.storageKey, socialUploadReservations.storageKey),
      )
      .where(
        and(
          lt(socialUploadReservations.putStartedAt, cutoff),
          or(
            eq(socialUploadReservations.state, "put_started"),
            eq(socialUploadReservations.state, "uploaded"),
            and(
              eq(socialUploadReservations.state, "recorded"),
              isNull(socialUploads.id),
            ),
          ),
          cursorClause,
        ),
      )
      .orderBy(
        asc(socialUploadReservations.putStartedAt),
        asc(socialUploadReservations.reservationId),
      )
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    const continuation = rows.length > limit ? page.at(-1) : undefined;
    return {
      candidates: page.map((row) => ({
        reservationId: row.reservationId,
        userId: row.userId,
        storageKey: row.storageKey,
        url: row.url,
        objectBytes: row.objectBytes,
        putStartedAt: row.putStartedAt,
        classification:
          row.state === "put_started"
            ? "unknown_after_put_attempt"
            : row.state === "uploaded"
              ? "orphaned_after_put"
              : "discarded_metadata",
      })),
      nextCursor: continuation
        ? {
            putStartedAt: continuation.putStartedAt,
            reservationId: continuation.reservationId,
          }
        : null,
    };
  } catch {
    throw new MediaUploadBudgetUnavailableError();
  }
}

/** A safe boolean for owner-controlled readiness checks; it is intentionally not a public DTO. */
export async function isMediaUploadBudgetReady(
  db: CirclesDatabase | null,
): Promise<boolean> {
  return (await inspectMediaUploadBudgetContract(db)).ready;
}
