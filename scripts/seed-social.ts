import "dotenv/config";
import { and, eq } from "drizzle-orm";
import {
  circles,
  memberships,
  posts,
  profiles,
  socialSeedMarkers,
  users,
} from "../drizzle/schema";
import { getDb } from "../server/db";

/**
 * This seed creates only explicitly public fictional demo content. It does not create OAuth
 * sessions, claim that a demo creator is logged in, seed reactions/comments, or seed live video.
 * Run after the parent applies the social migration: `pnpm tsx scripts/seed-social.ts`.
 */
const SEED_MARKER = "circles-public-starter-v1";
const MOUNTAINS =
  "https://files.manuscdn.com/search-media/310519663989254838/h8FkA94wGqT5j3lFnFB1M8/ZgGJzfWyY9fwJoZLPkvxrP.jpg";
const LAKE =
  "https://files.manuscdn.com/search-media/310519663989254838/h8FkA94wGqT5j3lFnFB1M8/zbRoFfVCeGtCAfdL7AfjC.jpg";
const COFFEE =
  "https://files.manuscdn.com/search-media/310519663989254838/h8FkA94wGqT5j3lFnFB1M8/VNHqQTYTLh8nDJ2u4aeb8i.jpeg";
const COFFEE_TWO =
  "https://files.manuscdn.com/search-media/310519663989254838/h8FkA94wGqT5j3lFnFB1M8/NUTTRxAHJdmYnRhkq42pfE.jpeg";
const PORTRAITS = [
  "https://files.manuscdn.com/search-media/310519663989254838/h8FkA94wGqT5j3lFnFB1M8/8FZ5aYhFA4zqa3ZhJHqiJj.jpg",
  "https://files.manuscdn.com/search-media/310519663989254838/h8FkA94wGqT5j3lFnFB1M8/gFnPS8tbb4u6WyHZo9Ax5c.jpg",
  "https://files.manuscdn.com/search-media/310519663989254838/h8FkA94wGqT5j3lFnFB1M8/PdFjW97bZiC7Up8biFK6Fo.jpg",
  "https://files.manuscdn.com/search-media/310519663989254838/h8FkA94wGqT5j3lFnFB1M8/bRVqsyasnfvtCASQLyRKfG.jpeg",
  "https://files.manuscdn.com/search-media/310519663989254838/h8FkA94wGqT5j3lFnFB1M8/hetf6jCCnRySviFFgCKUTf.jpg",
] as const;

const CREATORS = [
  { openId: "circles-example-ada", name: "Ada Moreno", handle: "ada-m", bio: "Noticing the generous little details.", avatar: PORTRAITS[0] },
  { openId: "circles-example-jules", name: "Jules Park", handle: "jules-parks", bio: "Outside whenever possible.", avatar: PORTRAITS[1] },
  { openId: "circles-example-mina", name: "Mina Patel", handle: "mina-makes", bio: "Designing with people, not around them.", avatar: PORTRAITS[2] },
  { openId: "circles-example-sam", name: "Sam Okafor", handle: "sam-sees", bio: "Collecting light and honest moments.", avatar: PORTRAITS[3] },
  { openId: "circles-example-rory", name: "Rory Chen", handle: "rory-runs", bio: "A run is better with company.", avatar: PORTRAITS[4] },
] as const;

const CIRCLE_DEFINITIONS = [
  {
    name: "Slow Living",
    description: "Small rituals, unhurried tables, and room to notice what matters.",
    category: "coffee",
    image: COFFEE,
    color: "#B66A4D",
    ownerOpenId: "circles-example-ada",
  },
  {
    name: "The Great Outdoors",
    description: "Trail notes, wide skies, and invitations to step outside.",
    category: "mountains",
    image: MOUNTAINS,
    color: "#58745D",
    ownerOpenId: "circles-example-jules",
  },
  {
    name: "Design People",
    description: "Thoughtful process, useful critique, and kind creative company.",
    category: "design",
    image: PORTRAITS[2],
    color: "#6B6A9E",
    ownerOpenId: "circles-example-mina",
  },
  {
    name: "Through the Lens",
    description: "Photographs with a point of view and the stories just outside the frame.",
    category: "photo",
    image: PORTRAITS[3],
    color: "#536F86",
    ownerOpenId: "circles-example-sam",
  },
  {
    name: "Weekend Runners",
    description: "Easy miles, local routes, and a friendly reason to lace up.",
    category: "running",
    image: LAKE,
    color: "#D27357",
    ownerOpenId: "circles-example-rory",
  },
] as const;

const PUBLIC_PHOTO_POSTS = [
  {
    circleName: "The Great Outdoors",
    authorOpenId: "circles-example-jules",
    media: MOUNTAINS,
    createdAt: new Date("2025-04-19T09:30:00.000Z"),
    text: "The trail began in a hush and ended above the weather. I love how a long climb gives every ordinary breath a little more meaning. What view has stayed with you lately?",
  },
  {
    circleName: "Slow Living",
    authorOpenId: "circles-example-ada",
    media: COFFEE_TWO,
    createdAt: new Date("2025-04-18T08:15:00.000Z"),
    text: "A slow pour, an open window, and nowhere urgent to be for ten whole minutes. Today’s tiny luxury is letting the morning arrive before I do.",
  },
  {
    circleName: "Through the Lens",
    authorOpenId: "circles-example-sam",
    media: PORTRAITS[4],
    createdAt: new Date("2025-04-17T17:45:00.000Z"),
    text: "Portraits work best when the person in front of the camera forgets they are performing. This in-between laugh was the frame I had been waiting for.",
  },
] as const;

async function main() {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_URL is required to seed Circles social content");

  const alreadySeeded = await db
    .select({ key: socialSeedMarkers.key })
    .from(socialSeedMarkers)
    .where(eq(socialSeedMarkers.key, SEED_MARKER))
    .limit(1);
  if (alreadySeeded.length) {
    console.log(`Social starter seed already completed (${SEED_MARKER}).`);
    return;
  }

  const creatorIds = new Map<string, number>();
  for (const creator of CREATORS) {
    let user = await db.select().from(users).where(eq(users.openId, creator.openId)).limit(1);
    if (!user[0]) {
      await db.insert(users).values({
        openId: creator.openId,
        name: creator.name,
        loginMethod: "example",
        role: "user",
        lastSignedIn: new Date("2025-04-01T00:00:00.000Z"),
      });
      user = await db.select().from(users).where(eq(users.openId, creator.openId)).limit(1);
    }
    if (!user[0]) throw new Error(`Unable to create demo creator ${creator.openId}`);
    creatorIds.set(creator.openId, user[0].id);

    const profile = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.userId, user[0].id))
      .limit(1);
    if (!profile.length) {
      await db.insert(profiles).values({
        userId: user[0].id,
        name: creator.name,
        handle: creator.handle,
        bio: creator.bio,
        avatar: creator.avatar,
      });
    }
  }

  const circleIds = new Map<string, number>();
  for (const definition of CIRCLE_DEFINITIONS) {
    const ownerId = creatorIds.get(definition.ownerOpenId);
    if (!ownerId) throw new Error(`Missing demo owner ${definition.ownerOpenId}`);
    let circle = await db.select().from(circles).where(eq(circles.name, definition.name)).limit(1);
    if (!circle[0]) {
      await db.insert(circles).values({
        ownerId,
        name: definition.name,
        description: definition.description,
        category: definition.category,
        privacy: "public",
        image: definition.image,
        color: definition.color,
      });
      circle = await db.select().from(circles).where(eq(circles.name, definition.name)).limit(1);
    }
    if (!circle[0]) throw new Error(`Unable to create demo circle ${definition.name}`);
    circleIds.set(definition.name, circle[0].id);

    const ownerMembership = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.circleId, circle[0].id), eq(memberships.userId, ownerId)))
      .limit(1);
    if (!ownerMembership.length) {
      await db.insert(memberships).values({ circleId: circle[0].id, userId: ownerId, role: "owner" });
    }
  }

  for (const post of PUBLIC_PHOTO_POSTS) {
    const circleId = circleIds.get(post.circleName);
    const authorId = creatorIds.get(post.authorOpenId);
    if (!circleId || !authorId) throw new Error(`Missing post relationship for ${post.circleName}`);
    const existing = await db
      .select({ id: posts.id })
      .from(posts)
      .where(and(eq(posts.circleId, circleId), eq(posts.authorId, authorId), eq(posts.text, post.text)))
      .limit(1);
    if (!existing.length) {
      await db.insert(posts).values({
        circleId,
        authorId,
        text: post.text,
        media: post.media,
        mediaType: "photo",
        createdAt: post.createdAt,
      });
    }
  }

  await db.insert(socialSeedMarkers).values({ key: SEED_MARKER });
  console.log("Seeded 5 public fictional Circles communities and 3 public photo posts (no sessions or live media).");
}

main().catch((error) => {
  console.error("Circles social seed failed:", error);
  process.exitCode = 1;
}).finally(async () => {
  const db = await getDb();
  if (db) await db.$client.end();
});
