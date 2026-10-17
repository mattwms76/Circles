"""Phase 1 — migrate Mongo users -> Supabase auth.users + public.profiles.
Preserves the existing uuid id and bcrypt password_hash so logins keep working.
Idempotent: safe to re-run."""
import asyncio, os, re
from datetime import datetime, timezone
import asyncpg
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
PG = "postgresql://postgres.nmbmkyhrybanwsmylbqd:66FLMFU3Q3Tkpfbf@aws-0-eu-west-1.pooler.supabase.com:6543/postgres"
mongo = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


def dt(v):
    if not v:
        return None
    if isinstance(v, datetime):
        return v
    try:
        return datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except ValueError:
        return None


def handle_for(email, uid):
    base = re.sub(r"[^a-z0-9_]", "", (email or "user").split("@")[0].lower()) or "user"
    return f"{base}_{uid[:6]}"


async def main():
    users = list(mongo.users.find({}))
    conn = await asyncpg.connect(PG, ssl="require", statement_cache_size=0)
    ok = 0
    for u in users:
        uid = u["id"]
        try:
            await conn.execute(
                """
                insert into auth.users
                  (instance_id, id, aud, role, email, encrypted_password,
                   email_confirmed_at, created_at, updated_at,
                   raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous)
                values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated',
                   'authenticated', $2, $3, now(),
                   coalesce($4::timestamptz, now()), now(),
                   '{"provider":"email","providers":["email"]}'::jsonb,
                   jsonb_build_object('name', $5::text), false, false)
                on conflict (id) do update set encrypted_password = excluded.encrypted_password,
                   email = excluded.email
                """,
                uid, u["email"], u["password_hash"], dt(u.get("created_at")), u.get("name", ""),
            )
            await conn.execute(
                """
                insert into public.profiles
                  (id, handle, display_name, avatar_url, bio, interests, created_at, onboarding_completed_at)
                values ($1, $2, $3, $4, $5, $6::text[], coalesce($7::timestamptz, now()), $8)
                on conflict (id) do update set display_name = excluded.display_name,
                   avatar_url = excluded.avatar_url, bio = excluded.bio, interests = excluded.interests
                """,
                uid, handle_for(u["email"], uid), u.get("name", ""), u.get("avatar_url"),
                u.get("bio", ""), list(u.get("interests", []) or []), dt(u.get("created_at")),
                (dt(u.get("created_at")) if u.get("onboarded") else None),
            )
            ok += 1
        except Exception as e:
            print("FAIL", u.get("email"), type(e).__name__, str(e)[:90])
    au = await conn.fetchval("select count(*) from auth.users")
    pr = await conn.fetchval("select count(*) from public.profiles")
    # GoTrue requires an email identity row and non-null token columns.
    await conn.execute(
        """
        insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
        select u.id::text, u.id,
               jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true, 'phone_verified', false),
               'email', now(), now(), now()
        from auth.users u
        where not exists (select 1 from auth.identities i where i.user_id=u.id and i.provider='email')
        """
    )
    await conn.execute(
        """update auth.users set
           confirmation_token=coalesce(confirmation_token,''),
           recovery_token=coalesce(recovery_token,''),
           email_change=coalesce(email_change,''),
           email_change_token_new=coalesce(email_change_token_new,''),
           email_change_token_current=coalesce(email_change_token_current,''),
           phone_change=coalesce(phone_change,''),
           phone_change_token=coalesce(phone_change_token,''),
           reauthentication_token=coalesce(reauthentication_token,'')"""
    )
    idn = await conn.fetchval("select count(*) from auth.identities")
    print(f"migrated={ok}/{len(users)}  auth.users={au}  profiles={pr}  identities={idn}")
    await conn.close()


asyncio.run(main())
