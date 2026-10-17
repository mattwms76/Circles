"""One-time Supabase schema setup for Circles (Option A — adopt legacy schema).
Adds a few additive bridge tables for concepts the legacy schema lacks (room
membership + room chat), a signup trigger (profiles + wallet), seeds the gift
catalog + coin packs, marks moderators, and back-fills coin_wallets from Mongo.
Idempotent."""
import asyncio, os
import asyncpg
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
PG = os.environ["DATABASE_URL"]
mongo = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]

GIFTS = [
    ("heart", "Heart", "\u2764\ufe0f", 10, "tiny"),
    ("flower", "Flower", "\U0001f33c", 25, "small"),
    ("star", "Star", "\u2b50", 50, "medium"),
    ("crown", "Crown", "\U0001f451", 120, "large"),
    ("rocket", "Rocket", "\U0001f680", 300, "legendary"),
]
COIN_PACKS = [("starter", 100), ("plus", 550), ("pro", 1200)]


async def main():
    conn = await asyncpg.connect(PG, ssl="require", statement_cache_size=0)

    # --- Bridge tables (additive; prefixed app_ to separate from legacy) ------
    await conn.execute(
        """
        create table if not exists public.app_room_members (
            session_id uuid not null,
            user_id uuid not null,
            role text not null default 'listener',
            hand_raised boolean not null default false,
            joined_at timestamptz not null default now(),
            primary key (session_id, user_id)
        );
        create table if not exists public.app_room_messages (
            id uuid primary key default gen_random_uuid(),
            session_id uuid not null,
            author_id uuid not null,
            body text not null,
            created_at timestamptz not null default clock_timestamp()
        );
        create index if not exists app_room_messages_session_idx
            on public.app_room_messages(session_id, created_at);
        create table if not exists public.app_gifts_sent (
            id uuid primary key default gen_random_uuid(),
            sender_id uuid not null,
            recipient_id uuid not null,
            gift_type text not null,
            cost integer not null,
            circle_id uuid,
            post_id uuid,
            session_id uuid,
            created_at timestamptz not null default now()
        );
        create index if not exists app_gifts_sent_circle_idx on public.app_gifts_sent(circle_id);
        create index if not exists app_gifts_sent_post_idx on public.app_gifts_sent(post_id);
        """
    )

    # --- Signup trigger: new auth.users -> profiles + coin_wallet ------------
    await conn.execute(
        """
        create or replace function public.handle_new_user()
        returns trigger language plpgsql security definer set search_path = public as $$
        begin
          insert into public.profiles (id, handle, display_name)
          values (new.id,
                  'user_' || substr(replace(new.id::text,'-',''),1,8),
                  coalesce(nullif(new.raw_user_meta_data->>'name',''), 'New member'))
          on conflict (id) do nothing;
          insert into public.coin_wallets (user_id, balance)
          values (new.id, 100)
          on conflict (user_id) do nothing;
          return new;
        end; $$;
        drop trigger if exists on_auth_user_created on auth.users;
        create trigger on_auth_user_created
          after insert on auth.users
          for each row execute function public.handle_new_user();
        """
    )

    # --- Gift catalog ---------------------------------------------------------
    for gid, name, emoji, coin, tier in GIFTS:
        await conn.execute(
            """insert into public.gifts (id, name, emoji, coin_value, tier, is_active)
               values ($1,$2,$3,$4,$5::gift_tier,true)
               on conflict (id) do update set coin_value=excluded.coin_value,
                 name=excluded.name, emoji=excluded.emoji, tier=excluded.tier""",
            gid, name, emoji, coin, tier,
        )

    # --- Coin packs -----------------------------------------------------------
    for pid, amount in COIN_PACKS:
        await conn.execute(
            """insert into public.coin_packs (id, coin_amount, is_active)
               values ($1,$2,true) on conflict (id) do update set coin_amount=excluded.coin_amount""",
            pid, amount,
        )

    # --- Moderators + wallet balances from Mongo ------------------------------
    mod_ids, wallet_rows = [], []
    for u in mongo.users.find({}):
        if u.get("is_moderator"):
            mod_ids.append(u["id"])
        wallet_rows.append((u["id"], int(u.get("coins", 100) or 0)))
    for mid in mod_ids:
        await conn.execute(
            "insert into public.moderators (user_id) values ($1) on conflict do nothing", mid
        )
    for uid, bal in wallet_rows:
        await conn.execute(
            """insert into public.coin_wallets (user_id, balance) values ($1,$2)
               on conflict (user_id) do update set balance=excluded.balance""",
            uid, bal,
        )

    g = await conn.fetchval("select count(*) from public.gifts")
    m = await conn.fetchval("select count(*) from public.moderators")
    w = await conn.fetchval("select count(*) from public.coin_wallets")
    print(f"gifts={g} moderators={m} wallets={w} bridge_tables=ok trigger=ok")
    await conn.close()


asyncio.run(main())
