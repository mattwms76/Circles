import { eq, sql } from "drizzle-orm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  circles,
  memberships,
  posts,
  profiles,
  socialSeedMarkers,
  users,
} from "../drizzle/schema";
import {
  closePostgresPool,
  getDb,
  type CirclesTransaction,
} from "../server/db";

/**
 * This seed creates only explicitly public fictional demo content. It does not create OAuth
 * sessions, claim that a demo creator is logged in, seed reactions/comments, or seed live video.
 * This file intentionally does not load dotenv files. It is a guarded
 * nonproduction fixture tool, not an application startup path.
 */
const SEED_MARKER = "circles-public-starter-v1";
const REQUIRED_APPLY_FLAGS = new Set([
  "--apply",
  "--non-production",
  "--fresh-target",
  "--acknowledge-public-demo-seed",
]);
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
  {
    openId: "circles-example-ada",
    name: "Ada Moreno",
    handle: "ada-m",
    bio: "Noticing the generous little details.",
    avatar: PORTRAITS[0],
  },
  {
    openId: "circles-example-jules",
    name: "Jules Park",
    handle: "jules-parks",
    bio: "Outside whenever possible.",
    avatar: PORTRAITS[1],
  },
  {
    openId: "circles-example-mina",
    name: "Mina Patel",
    handle: "mina-makes",
    bio: "Designing with people, not around them.",
    avatar: PORTRAITS[2],
  },
  {
    openId: "circles-example-sam",
    name: "Sam Okafor",
    handle: "sam-sees",
    bio: "Collecting light and honest moments.",
    avatar: PORTRAITS[3],
  },
  {
    openId: "circles-example-rory",
    name: "Rory Chen",
    handle: "rory-runs",
    bio: "A run is better with company.",
    avatar: PORTRAITS[4],
  },
] as const;

const CIRCLE_DEFINITIONS = [
  {
    name: "Slow Living",
    description:
      "Small rituals, unhurried tables, and room to notice what matters.",
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
    description:
      "Thoughtful process, useful critique, and kind creative company.",
    category: "design",
    image: PORTRAITS[2],
    color: "#6B6A9E",
    ownerOpenId: "circles-example-mina",
  },
  {
    name: "Through the Lens",
    description:
      "Photographs with a point of view and the stories just outside the frame.",
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

export type SeedMode = "dry-run" | "apply";

export function parseSeedArguments(argv: string[]): { mode: SeedMode } {
  const supplied = new Set(argv);
  if (supplied.has("--help") || supplied.has("-h")) {
    throw new Error(
      "usage: pnpm tsx scripts/seed-social.ts --dry-run | --apply --non-production --fresh-target --acknowledge-public-demo-seed",
    );
  }
  const allowed = new Set([...REQUIRED_APPLY_FLAGS, "--dry-run"]);
  if (argv.some((argument) => !allowed.has(argument))) {
    throw new Error("seed_arguments_invalid");
  }
  if (supplied.has("--dry-run") || supplied.size === 0) {
    if (supplied.size > 1) throw new Error("seed_mode_ambiguous");
    return { mode: "dry-run" };
  }
  if (
    supplied.size !== REQUIRED_APPLY_FLAGS.size ||
    [...REQUIRED_APPLY_FLAGS].some((flag) => !supplied.has(flag))
  ) {
    throw new Error("seed_apply_acknowledgement_required");
  }
  return { mode: "apply" };
}

function assertExplicitNonProductionEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
) {
  if (
    !["development", "test"].includes(environment.NODE_ENV ?? "") ||
    environment.CIRCLES_SEED_TARGET !== "non-production"
  ) {
    throw new Error("seed_nonproduction_environment_required");
  }
}

async function assertFreshTarget(tx: CirclesTransaction) {
  // This catalog-free predicate exposes no application rows. A target is fresh
  // only when every relation this seed would populate is empty; the import
  // marker table may still contain the independent private-schema import marker.
  const result = await tx.execute(sql`
    SELECT NOT EXISTS (SELECT 1 FROM circles_app.users)
      AND NOT EXISTS (SELECT 1 FROM circles_app.profiles)
      AND NOT EXISTS (SELECT 1 FROM circles_app.circles)
      AND NOT EXISTS (SELECT 1 FROM circles_app.memberships)
      AND NOT EXISTS (SELECT 1 FROM circles_app.posts)
      AND NOT EXISTS (SELECT 1 FROM circles_app."socialSeedMarkers")
      AS is_fresh
  `);
  const row = result.rows[0] as { is_fresh?: boolean } | undefined;
  if (row?.is_fresh !== true) throw new Error("seed_target_not_fresh");
}

async function applySeed(tx: CirclesTransaction) {
  // The transaction-scoped lock serializes marker observation and all fixture
  // writes. It automatically releases on commit or rollback.
  await tx.execute(
    sql`SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(${SEED_MARKER}, 0))`,
  );
  const alreadySeeded = await tx
    .select({ key: socialSeedMarkers.key })
    .from(socialSeedMarkers)
    .where(eq(socialSeedMarkers.key, SEED_MARKER))
    .limit(1);
  if (alreadySeeded.length) {
    return "already_seeded" as const;
  }
  await assertFreshTarget(tx);

  const creatorIds = new Map<string, number>();
  for (const creator of CREATORS) {
    const [user] = await tx
      .insert(users)
      .values({
        openId: creator.openId,
        name: creator.name,
        loginMethod: "example",
        role: "user",
        lastSignedIn: new Date("2025-04-01T00:00:00.000Z"),
      })
      .returning({ id: users.id });
    if (!user) throw new Error("seed_creator_insert_failed");
    creatorIds.set(creator.openId, user.id);

    await tx.insert(profiles).values({
      userId: user.id,
      name: creator.name,
      handle: creator.handle,
      bio: creator.bio,
      avatar: creator.avatar,
    });
  }

  const circleIds = new Map<string, number>();
  for (const definition of CIRCLE_DEFINITIONS) {
    const ownerId = creatorIds.get(definition.ownerOpenId);
    if (!ownerId)
      throw new Error(`Missing demo owner ${definition.ownerOpenId}`);
    const [circle] = await tx
      .insert(circles)
      .values({
        ownerId,
        name: definition.name,
        description: definition.description,
        category: definition.category,
        privacy: "public",
        image: definition.image,
        color: definition.color,
      })
      .returning({ id: circles.id });
    if (!circle) throw new Error("seed_circle_insert_failed");
    circleIds.set(definition.name, circle.id);

    await tx
      .insert(memberships)
      .values({ circleId: circle.id, userId: ownerId, role: "owner" });
  }

  for (const post of PUBLIC_PHOTO_POSTS) {
    const circleId = circleIds.get(post.circleName);
    const authorId = creatorIds.get(post.authorOpenId);
    if (!circleId || !authorId)
      throw new Error(`Missing post relationship for ${post.circleName}`);
    await tx.insert(posts).values({
      circleId,
      authorId,
      text: post.text,
      media: post.media,
      mediaType: "photo",
      createdAt: post.createdAt,
    });
  }

  await tx.insert(socialSeedMarkers).values({ key: SEED_MARKER });
  return "seeded" as const;
}

export async function runSeed(
  argv: string[],
  environment: NodeJS.ProcessEnv = process.env,
) {
  const { mode } = parseSeedArguments(argv);
  if (mode === "dry-run") {
    return {
      mode,
      ok: true,
      message:
        "Dry run only: no database connection, reads, or writes were performed. Use all four explicit apply acknowledgements for a known fresh nonproduction target.",
    };
  }
  assertExplicitNonProductionEnvironment(environment);
  const db = await getDb();
  if (!db) throw new Error("seed_postgres_runtime_unavailable");
  const outcome = await db.transaction((tx) => applySeed(tx));
  return { mode, ok: true, outcome };
}

async function main() {
  try {
    const result = await runSeed(process.argv.slice(2));
    console.log(JSON.stringify(result));
  } finally {
    await closePostgresPool();
  }
}

if (
  process.argv[1] &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])
) {
  main().catch(() => {
    console.error(
      "Circles social seed refused or failed without applying a partial seed.",
    );
    process.exitCode = 1;
  });
}
