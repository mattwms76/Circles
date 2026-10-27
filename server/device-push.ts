import { and, eq, inArray, ne } from "drizzle-orm";
import { devicePushTokens } from "../drizzle/member-features-schema";
import { conversationParticipants } from "../drizzle/schema";
import { getDb } from "./db";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const TOKEN_PATTERN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,160}\]$/;

export function isExpoPushToken(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}

export async function registerDevicePushToken(
  userId: number,
  token: string,
  platform: "ios" | "android",
): Promise<void> {
  if (!isExpoPushToken(token)) {
    throw new Error("Push token was not accepted");
  }
  const db = await getDb();
  if (!db) throw new Error("Push registration is unavailable");
  await db
    .insert(devicePushTokens)
    .values({ userId, token, platform, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [devicePushTokens.userId, devicePushTokens.token],
      set: { platform, updatedAt: new Date() },
    });
}

async function tokensFor(userIds: number[]): Promise<string[]> {
  const db = await getDb();
  if (!db || userIds.length === 0) return [];
  const rows = await db
    .select({ token: devicePushTokens.token })
    .from(devicePushTokens)
    .where(inArray(devicePushTokens.userId, userIds));
  return rows.map((row) => row.token);
}

export async function deliverDevicePush(
  userIds: number[],
  message: { title: string; body: string; data?: Record<string, string> },
): Promise<void> {
  try {
    const recipients = [...new Set(userIds)].filter(
      (id) => Number.isSafeInteger(id) && id > 0,
    );
    const tokens = await tokensFor(recipients);
    if (tokens.length === 0) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4_000);
    try {
      await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify(
          tokens.map((to) => ({
            to,
            title: message.title,
            body: message.body,
            data: message.data ?? {},
            sound: "default",
          })),
        ),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // A missed alert must not fail the comment, approval, or message.
  }
}

export async function notifyConversationParticipants(
  conversationId: number,
  authorId: number,
): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    const rows = await db
      .select({ userId: conversationParticipants.userId })
      .from(conversationParticipants)
      .where(
        and(
          eq(conversationParticipants.conversationId, conversationId),
          ne(conversationParticipants.userId, authorId),
        ),
      );
    await deliverDevicePush(
      rows.map((row) => row.userId),
      {
        title: "New message",
        body: "You have a new message in Circles.",
        data: { kind: "message" },
      },
    );
  } catch {
    // Delivery is best-effort after the message is already stored.
  }
}
