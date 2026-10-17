"""Supabase data + auth layer for Circles.

- asyncpg pool against the transaction pooler (statement_cache_size=0).
- Supabase access-token (ES256 JWT) verification via the project JWKS.
- GoTrue Admin API helpers (create confirmed users, update password, delete).
"""
import os
import logging
from typing import Optional

import jwt
import httpx
import asyncpg
from jwt import PyJWKClient

logger = logging.getLogger("circles.supabase")

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
DATABASE_URL = os.environ["DATABASE_URL"]
JWT_ISSUER = f"{SUPABASE_URL}/auth/v1"
JWKS_URL = f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json"

_jwks = PyJWKClient(JWKS_URL)
_pool: Optional[asyncpg.Pool] = None


async def _set_codecs(conn: asyncpg.Connection) -> None:
    # Return/accept uuid columns as plain strings so response shapes match the
    # previous Mongo string-id contract (datetimes are serialised by FastAPI).
    await conn.set_type_codec(
        "uuid", encoder=str, decoder=str, schema="pg_catalog", format="text"
    )


async def init_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            DATABASE_URL,
            min_size=1,
            max_size=10,
            ssl="require",
            statement_cache_size=0,  # required for the transaction pooler (6543)
            command_timeout=30,
            init=_set_codecs,
        )
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


def pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("DB pool not initialised")
    return _pool


async def fetch(sql: str, *args):
    async with pool().acquire() as c:
        return await c.fetch(sql, *args)


async def fetchrow(sql: str, *args):
    async with pool().acquire() as c:
        return await c.fetchrow(sql, *args)


async def fetchval(sql: str, *args):
    async with pool().acquire() as c:
        return await c.fetchval(sql, *args)


async def execute(sql: str, *args):
    async with pool().acquire() as c:
        return await c.execute(sql, *args)


def verify_token(token: str) -> str:
    """Return the Supabase user id (sub) for a valid access token, else raise."""
    signing_key = _jwks.get_signing_key_from_jwt(token)
    claims = jwt.decode(
        token,
        signing_key.key,
        algorithms=["ES256", "RS256", "EdDSA"],
        audience="authenticated",
        issuer=JWT_ISSUER,
        options={"require": ["exp", "sub", "aud", "iss"]},
    )
    uid = claims.get("sub")
    if not isinstance(uid, str):
        raise ValueError("missing sub")
    return uid


# --------------------------- GoTrue Admin API -------------------------------
_ADMIN_BASE = f"{SUPABASE_URL}/auth/v1/admin"
_ADMIN_HEADERS = {
    "apikey": SERVICE_ROLE_KEY,
    "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
    "Content-Type": "application/json",
}


async def admin_create_user(email: str, password: str, name: str) -> dict:
    """Create an email-confirmed user. Returns the created user json."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{_ADMIN_BASE}/users",
            headers=_ADMIN_HEADERS,
            json={
                "email": email,
                "password": password,
                "email_confirm": True,
                "user_metadata": {"name": name},
            },
        )
    return resp.status_code, resp.json()


async def admin_update_password(user_id: str, password: str) -> int:
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.put(
            f"{_ADMIN_BASE}/users/{user_id}",
            headers=_ADMIN_HEADERS,
            json={"password": password},
        )
    return resp.status_code


async def admin_delete_user(user_id: str) -> int:
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.delete(f"{_ADMIN_BASE}/users/{user_id}", headers=_ADMIN_HEADERS)
    return resp.status_code
