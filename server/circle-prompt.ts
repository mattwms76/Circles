import { and, desc, eq } from "drizzle-orm";
import { circlePrompts, promptPosts } from "../drizzle/member-features-schema";
import { posts } from "../drizzle/schema";
import type { CirclesDatabase, CirclesTransaction } from "./db";

export const CIRCLE_PROMPT_MAX = 180;

export function normalizeCirclePrompt(value: string): string {
  const body = value.trim().replace(/\s+/g, " ");
  if (Array.from(body).length > CIRCLE_PROMPT_MAX) {
    throw new Error("Circle prompt is too long");
  }
  return body;
}

export async function readCirclePrompt(db: CirclesDatabase, circleId: number) {
  const current = await db
    .select({
      body: circlePrompts.body,
      updatedAt: circlePrompts.updatedAt,
    })
    .from(circlePrompts)
    .where(eq(circlePrompts.circleId, circleId))
    .limit(1);
  const prompt = current[0];
  if (!prompt) {
    return { circleId, body: "", updatedAt: null, posts: [] };
  }
  const responses = await db
    .select({
      id: posts.id,
      text: posts.text,
      createdAt: posts.createdAt,
    })
    .from(promptPosts)
    .innerJoin(posts, eq(posts.id, promptPosts.postId))
    .where(
      and(
        eq(promptPosts.circleId, circleId),
        eq(promptPosts.promptBody, prompt.body),
      ),
    )
    .orderBy(desc(posts.id))
    .limit(8);
  return {
    circleId,
    body: prompt.body,
    updatedAt: prompt.updatedAt.toISOString(),
    posts: responses.map((post) => ({
      id: post.id,
      text: post.text,
      createdAt: post.createdAt.toISOString(),
    })),
  };
}

export async function writeCirclePrompt(
  tx: CirclesTransaction,
  circleId: number,
  userId: number,
  body: string,
): Promise<void> {
  if (!body) {
    await tx.delete(circlePrompts).where(eq(circlePrompts.circleId, circleId));
    return;
  }
  await tx
    .insert(circlePrompts)
    .values({ circleId, body, updatedBy: userId, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: circlePrompts.circleId,
      set: { body, updatedBy: userId, updatedAt: new Date() },
    });
}

export async function attachCirclePromptResponse(
  tx: CirclesTransaction,
  circleId: number,
  postId: number,
): Promise<void> {
  const current = await tx
    .select({ body: circlePrompts.body })
    .from(circlePrompts)
    .where(eq(circlePrompts.circleId, circleId))
    .limit(1);
  const body = current[0]?.body;
  if (!body) return;
  await tx
    .insert(promptPosts)
    .values({ postId, circleId, promptBody: body })
    .onConflictDoNothing();
}
