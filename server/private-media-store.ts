import { eq } from "drizzle-orm";
import { mediaObjects } from "../drizzle/member-features-schema";
import { getDb } from "./db";
import { StorageOperationError } from "./storage";

const MEDIA_KEY = /^[A-Za-z0-9][A-Za-z0-9_./-]{0,511}$/;
const MAX_MEDIA_BYTES = 20_971_600;

export function isPrivateMediaKey(value: string): boolean {
  return MEDIA_KEY.test(value) && !value.includes("..");
}

export function privateMediaStoreRequested(): boolean {
  return process.env.CIRCLES_PRIVATE_MEDIA_STORE === "database";
}

export async function putPrivateMedia(
  key: string,
  data: Buffer,
): Promise<{ key: string; url: string }> {
  if (!isPrivateMediaKey(key) || data.length < 1 || data.length > MAX_MEDIA_BYTES) {
    throw new StorageOperationError("Storage upload could not be prepared");
  }
  const db = await getDb();
  if (!db) throw new StorageOperationError("Storage service is unavailable");
  await db
    .insert(mediaObjects)
    .values({ key, bytes: data })
    .onConflictDoNothing();
  return { key, url: `/manus-storage/${key}` };
}

export async function readPrivateMedia(key: string): Promise<Buffer> {
  if (!isPrivateMediaKey(key)) {
    throw new StorageOperationError("Storage download could not be prepared");
  }
  const db = await getDb();
  if (!db) throw new StorageOperationError("Storage service is unavailable");
  const rows = await db
    .select({ bytes: mediaObjects.bytes })
    .from(mediaObjects)
    .where(eq(mediaObjects.key, key))
    .limit(1);
  const bytes = rows[0]?.bytes;
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
    throw new StorageOperationError("Storage download could not be prepared");
  }
  return bytes;
}
