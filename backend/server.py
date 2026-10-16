import os
import uuid
import logging
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import Optional, List

import jwt
import bcrypt
import requests
from fastapi import FastAPI, APIRouter, HTTPException, Depends, UploadFile, File, Query
from fastapi.responses import Response
from fastapi.concurrency import run_in_threadpool
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr, Field
from dotenv import load_dotenv

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("circles")

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------
mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALGO = "HS256"
JWT_EXPIRE_DAYS = 30

# ---------------------------------------------------------------------------
# Object storage (Emergent managed)
# ---------------------------------------------------------------------------
STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY")
APP_NAME = "circles"
_storage_key: Optional[str] = None


def init_storage():
    global _storage_key
    if _storage_key:
        return _storage_key
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_KEY}, timeout=30)
    resp.raise_for_status()
    _storage_key = resp.json()["storage_key"]
    return _storage_key


def put_object(path: str, data: bytes, content_type: str) -> dict:
    global _storage_key
    key = init_storage()
    resp = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data,
        timeout=120,
    )
    if resp.status_code == 503:
        _storage_key = None
        key = init_storage()
        resp = requests.put(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key, "Content-Type": content_type},
            data=data,
            timeout=120,
        )
    resp.raise_for_status()
    return resp.json()


def get_object(path: str):
    key = init_storage()
    resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id() -> str:
    return str(uuid.uuid4())


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False


def create_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(days=JWT_EXPIRE_DAYS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)


def public_user(doc: dict) -> dict:
    if not doc:
        return {}
    return {
        "id": doc["id"],
        "name": doc.get("name", ""),
        "email": doc.get("email", ""),
        "bio": doc.get("bio", ""),
        "avatar_url": doc.get("avatar_url"),
        "interests": doc.get("interests", []),
        "onboarded": doc.get("onboarded", False),
        "coins": doc.get("coins", 0),
        "is_moderator": doc.get("is_moderator", False),
        "created_at": doc.get("created_at"),
    }


# ---------------------------------------------------------------------------
# Auth dependency
# ---------------------------------------------------------------------------
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

bearer = HTTPBearer(auto_error=False)


async def current_user(creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer)) -> dict:
    if not creds or creds.scheme.lower() != "bearer":
        raise HTTPException(401, "Not authenticated")
    try:
        payload = jwt.decode(creds.credentials, JWT_SECRET, algorithms=[JWT_ALGO])
        uid = payload.get("sub")
    except Exception:
        raise HTTPException(401, "Invalid token")
    user = await db.users.find_one({"id": uid})
    if not user:
        raise HTTPException(401, "User not found")
    return user


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)
    name: str = Field(min_length=1, max_length=60)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class ProfileUpdate(BaseModel):
    name: Optional[str] = None
    bio: Optional[str] = None
    interests: Optional[List[str]] = None
    avatar_url: Optional[str] = None
    onboarded: Optional[bool] = None


class CircleIn(BaseModel):
    name: str
    description: str = ""
    category: str = "General"
    cover_url: Optional[str] = None
    is_private: bool = False


class PostIn(BaseModel):
    circle_id: str
    text: str = ""
    image_url: Optional[str] = None


class CommentIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


class MessageIn(BaseModel):
    text: str = ""
    image_url: Optional[str] = None


class DirectIn(BaseModel):
    user_id: str


class RoomIn(BaseModel):
    title: str
    circle_id: Optional[str] = None
    scheduled_at: Optional[str] = None


class RoomMessageIn(BaseModel):
    text: str = Field(min_length=1, max_length=1000)


class EventIn(BaseModel):
    title: str
    description: str = ""
    starts_at: str


class BuyCoinsIn(BaseModel):
    amount: int


class GiftIn(BaseModel):
    recipient_id: str
    gift_type: str = "Heart"
    post_id: Optional[str] = None
    room_id: Optional[str] = None


class ReportIn(BaseModel):
    target_type: str
    target_id: str
    reason: str


# ---------------------------------------------------------------------------
# App + router
# ---------------------------------------------------------------------------
app = FastAPI(title="Circles API")


@app.get("/health", include_in_schema=False)
@app.head("/health", include_in_schema=False)
async def health():
    return {"status": "ok"}


api = APIRouter(prefix="/api")

GIFT_COSTS = {"Heart": 10, "Flower": 25, "Star": 50, "Crown": 120, "Rocket": 300}


# ------------------------------- Auth --------------------------------------
@api.post("/auth/register")
async def register(body: RegisterIn):
    email = body.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(409, "Email already registered")
    doc = {
        "id": new_id(),
        "email": email,
        "name": body.name.strip(),
        "password_hash": hash_password(body.password),
        "bio": "",
        "avatar_url": None,
        "interests": [],
        "onboarded": False,
        "coins": 100,
        "is_moderator": False,
        "created_at": now_iso(),
    }
    await db.users.insert_one(doc)
    return {"access_token": create_token(doc["id"]), "user": public_user(doc)}


@api.post("/auth/login")
async def login(body: LoginIn):
    user = await db.users.find_one({"email": body.email.lower()})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(401, "Invalid email or password")
    return {"access_token": create_token(user["id"]), "user": public_user(user)}


@api.get("/auth/me")
async def me(user: dict = Depends(current_user)):
    return public_user(user)


@api.put("/users/me")
async def update_me(body: ProfileUpdate, user: dict = Depends(current_user)):
    updates = {k: v for k, v in body.dict().items() if v is not None}
    if updates:
        await db.users.update_one({"id": user["id"]}, {"$set": updates})
    fresh = await db.users.find_one({"id": user["id"]})
    return public_user(fresh)


@api.get("/users/{user_id}")
async def get_user(user_id: str, user: dict = Depends(current_user)):
    target = await db.users.find_one({"id": user_id})
    if not target:
        raise HTTPException(404, "User not found")
    post_count = await db.posts.count_documents({"author_id": user_id, "deleted": {"$ne": True}})
    circle_count = await db.memberships.count_documents({"user_id": user_id})
    data = public_user(target)
    data["post_count"] = post_count
    data["circle_count"] = circle_count
    return data


# ------------------------------ Circles ------------------------------------
async def enrich_circle(c: dict, uid: str) -> dict:
    member_count = await db.memberships.count_documents({"circle_id": c["id"]})
    is_member = await db.memberships.find_one({"circle_id": c["id"], "user_id": uid}) is not None
    return {
        "id": c["id"],
        "name": c["name"],
        "description": c.get("description", ""),
        "category": c.get("category", "General"),
        "cover_url": c.get("cover_url"),
        "is_private": c.get("is_private", False),
        "owner_id": c.get("owner_id"),
        "member_count": member_count,
        "is_member": is_member,
        "is_owner": c.get("owner_id") == uid,
        "created_at": c.get("created_at"),
    }


@api.get("/circles")
async def list_circles(
    search: str = Query(""),
    category: str = Query(""),
    mine: bool = Query(False),
    user: dict = Depends(current_user),
):
    q: dict = {}
    if search:
        q["name"] = {"$regex": search, "$options": "i"}
    if category and category.lower() != "all":
        q["category"] = category
    if mine:
        ms = await db.memberships.find({"user_id": user["id"]}).to_list(500)
        q["id"] = {"$in": [m["circle_id"] for m in ms]}
    circles = await db.circles.find(q).sort("created_at", -1).to_list(200)
    return [await enrich_circle(c, user["id"]) for c in circles]


@api.post("/circles")
async def create_circle(body: CircleIn, user: dict = Depends(current_user)):
    doc = {
        "id": new_id(),
        "name": body.name.strip(),
        "description": body.description,
        "category": body.category,
        "cover_url": body.cover_url,
        "is_private": body.is_private,
        "owner_id": user["id"],
        "created_at": now_iso(),
    }
    await db.circles.insert_one(doc)
    await db.memberships.insert_one(
        {"id": new_id(), "circle_id": doc["id"], "user_id": user["id"], "role": "owner", "created_at": now_iso()}
    )
    return await enrich_circle(doc, user["id"])


@api.get("/circles/{circle_id}")
async def get_circle(circle_id: str, user: dict = Depends(current_user)):
    c = await db.circles.find_one({"id": circle_id})
    if not c:
        raise HTTPException(404, "Circle not found")
    return await enrich_circle(c, user["id"])


@api.post("/circles/{circle_id}/join")
async def join_circle(circle_id: str, user: dict = Depends(current_user)):
    c = await db.circles.find_one({"id": circle_id})
    if not c:
        raise HTTPException(404, "Circle not found")
    existing = await db.memberships.find_one({"circle_id": circle_id, "user_id": user["id"]})
    if not existing:
        await db.memberships.insert_one(
            {"id": new_id(), "circle_id": circle_id, "user_id": user["id"], "role": "member", "created_at": now_iso()}
        )
    return await enrich_circle(c, user["id"])


@api.post("/circles/{circle_id}/leave")
async def leave_circle(circle_id: str, user: dict = Depends(current_user)):
    c = await db.circles.find_one({"id": circle_id})
    if not c:
        raise HTTPException(404, "Circle not found")
    if c.get("owner_id") == user["id"]:
        raise HTTPException(400, "Owners cannot leave their own circle")
    await db.memberships.delete_one({"circle_id": circle_id, "user_id": user["id"]})
    return await enrich_circle(c, user["id"])


@api.get("/circles/{circle_id}/members")
async def circle_members(circle_id: str, user: dict = Depends(current_user)):
    ms = await db.memberships.find({"circle_id": circle_id}).to_list(500)
    out = []
    for m in ms:
        u = await db.users.find_one({"id": m["user_id"]})
        if u:
            data = public_user(u)
            data["role"] = m.get("role", "member")
            out.append(data)
    return out


async def enrich_event(e: dict, uid: str) -> dict:
    rsvp_count = await db.event_rsvps.count_documents({"event_id": e["id"]})
    going = await db.event_rsvps.find_one({"event_id": e["id"], "user_id": uid}) is not None
    return {
        "id": e["id"],
        "circle_id": e["circle_id"],
        "title": e["title"],
        "description": e.get("description", ""),
        "starts_at": e.get("starts_at"),
        "host_id": e.get("host_id"),
        "host_name": e.get("host_name"),
        "rsvp_count": rsvp_count,
        "going": going,
        "created_at": e.get("created_at"),
    }


@api.get("/circles/{circle_id}/events")
async def circle_events(circle_id: str, user: dict = Depends(current_user)):
    events = await db.events.find({"circle_id": circle_id}).sort("starts_at", 1).to_list(100)
    return [await enrich_event(e, user["id"]) for e in events]


@api.post("/events/{event_id}/rsvp")
async def toggle_rsvp(event_id: str, user: dict = Depends(current_user)):
    e = await db.events.find_one({"id": event_id})
    if not e:
        raise HTTPException(404, "Event not found")
    existing = await db.event_rsvps.find_one({"event_id": event_id, "user_id": user["id"]})
    if existing:
        await db.event_rsvps.delete_one({"event_id": event_id, "user_id": user["id"]})
    else:
        await db.event_rsvps.insert_one(
            {"id": new_id(), "event_id": event_id, "user_id": user["id"], "created_at": now_iso()}
        )
    return await enrich_event(e, user["id"])



@api.post("/circles/{circle_id}/events")
async def create_event(circle_id: str, body: EventIn, user: dict = Depends(current_user)):
    doc = {
        "id": new_id(),
        "circle_id": circle_id,
        "title": body.title,
        "description": body.description,
        "starts_at": body.starts_at,
        "host_id": user["id"],
        "host_name": user["name"],
        "created_at": now_iso(),
    }
    await db.events.insert_one(doc)
    return await enrich_event(doc, user["id"])


# ------------------------------- Posts -------------------------------------
async def enrich_post(p: dict, uid: str) -> dict:
    author = await db.users.find_one({"id": p["author_id"]})
    circle = await db.circles.find_one({"id": p["circle_id"]})
    like_count = await db.likes.count_documents({"post_id": p["id"]})
    liked = await db.likes.find_one({"post_id": p["id"], "user_id": uid}) is not None
    comment_count = await db.comments.count_documents({"post_id": p["id"]})
    return {
        "id": p["id"],
        "text": p.get("text", ""),
        "image_url": p.get("image_url"),
        "circle_id": p["circle_id"],
        "circle_name": circle["name"] if circle else "",
        "author_id": p["author_id"],
        "author_name": author["name"] if author else "Unknown",
        "author_avatar": author.get("avatar_url") if author else None,
        "like_count": like_count,
        "liked": liked,
        "comment_count": comment_count,
        "created_at": p.get("created_at"),
    }


@api.get("/feed")
async def feed(user: dict = Depends(current_user)):
    ms = await db.memberships.find({"user_id": user["id"]}).to_list(500)
    circle_ids = [m["circle_id"] for m in ms]
    q: dict = {"deleted": {"$ne": True}}
    if circle_ids:
        q["circle_id"] = {"$in": circle_ids}
    posts = await db.posts.find(q).sort("created_at", -1).to_list(100)
    if not posts:
        pub_circles = await db.circles.find({"is_private": False}).to_list(200)
        pub_ids = [c["id"] for c in pub_circles]
        posts = await db.posts.find(
            {"deleted": {"$ne": True}, "circle_id": {"$in": pub_ids}}
        ).sort("created_at", -1).to_list(50)
    return [await enrich_post(p, user["id"]) for p in posts]


@api.get("/circles/{circle_id}/posts")
async def circle_posts(circle_id: str, user: dict = Depends(current_user)):
    posts = await db.posts.find({"circle_id": circle_id, "deleted": {"$ne": True}}).sort("created_at", -1).to_list(100)
    return [await enrich_post(p, user["id"]) for p in posts]


@api.post("/posts")
async def create_post(body: PostIn, user: dict = Depends(current_user)):
    if not body.text.strip() and not body.image_url:
        raise HTTPException(400, "Post cannot be empty")
    c = await db.circles.find_one({"id": body.circle_id})
    if not c:
        raise HTTPException(404, "Circle not found")
    doc = {
        "id": new_id(),
        "circle_id": body.circle_id,
        "author_id": user["id"],
        "text": body.text.strip(),
        "image_url": body.image_url,
        "deleted": False,
        "created_at": now_iso(),
    }
    await db.posts.insert_one(doc)
    return await enrich_post(doc, user["id"])


@api.post("/posts/{post_id}/like")
async def toggle_like(post_id: str, user: dict = Depends(current_user)):
    existing = await db.likes.find_one({"post_id": post_id, "user_id": user["id"]})
    if existing:
        await db.likes.delete_one({"post_id": post_id, "user_id": user["id"]})
        liked = False
    else:
        await db.likes.insert_one({"id": new_id(), "post_id": post_id, "user_id": user["id"], "created_at": now_iso()})
        liked = True
    like_count = await db.likes.count_documents({"post_id": post_id})
    return {"liked": liked, "like_count": like_count}


@api.delete("/posts/{post_id}")
async def delete_post(post_id: str, user: dict = Depends(current_user)):
    p = await db.posts.find_one({"id": post_id})
    if not p:
        raise HTTPException(404, "Post not found")
    if p["author_id"] != user["id"] and not user.get("is_moderator"):
        raise HTTPException(403, "Not allowed")
    await db.posts.update_one({"id": post_id}, {"$set": {"deleted": True}})
    return {"ok": True}


@api.get("/posts/{post_id}/comments")
async def get_comments(post_id: str, user: dict = Depends(current_user)):
    comments = await db.comments.find({"post_id": post_id}).sort("created_at", 1).to_list(500)
    out = []
    for c in comments:
        author = await db.users.find_one({"id": c["author_id"]})
        out.append(
            {
                "id": c["id"],
                "text": c["text"],
                "author_id": c["author_id"],
                "author_name": author["name"] if author else "Unknown",
                "author_avatar": author.get("avatar_url") if author else None,
                "created_at": c["created_at"],
            }
        )
    return out


@api.post("/posts/{post_id}/comments")
async def add_comment(post_id: str, body: CommentIn, user: dict = Depends(current_user)):
    p = await db.posts.find_one({"id": post_id})
    if not p:
        raise HTTPException(404, "Post not found")
    doc = {
        "id": new_id(),
        "post_id": post_id,
        "author_id": user["id"],
        "text": body.text.strip(),
        "created_at": now_iso(),
    }
    await db.comments.insert_one(doc)
    return {
        "id": doc["id"],
        "text": doc["text"],
        "author_id": user["id"],
        "author_name": user["name"],
        "author_avatar": user.get("avatar_url"),
        "created_at": doc["created_at"],
    }


# --------------------------- Conversations ---------------------------------
async def enrich_conversation(conv: dict, uid: str) -> dict:
    last = await db.messages.find({"conversation_id": conv["id"]}).sort("created_at", -1).to_list(1)
    last_msg = last[0] if last else None
    title = conv.get("title")
    avatar = None
    if conv["type"] == "direct":
        other_id = next((m for m in conv["members"] if m != uid), None)
        other = await db.users.find_one({"id": other_id}) if other_id else None
        title = other["name"] if other else "Conversation"
        avatar = other.get("avatar_url") if other else None
    else:
        circle = await db.circles.find_one({"id": conv.get("circle_id")})
        if circle:
            title = circle["name"]
            avatar = circle.get("cover_url")
    return {
        "id": conv["id"],
        "type": conv["type"],
        "title": title,
        "avatar": avatar,
        "circle_id": conv.get("circle_id"),
        "last_message": last_msg["text"] if last_msg else "",
        "last_at": last_msg["created_at"] if last_msg else conv.get("created_at"),
        "unread": await unread_count(conv["id"], uid),
    }


async def unread_count(conv_id: str, uid: str) -> int:
    read = await db.conversation_reads.find_one({"conversation_id": conv_id, "user_id": uid})
    q: dict = {"conversation_id": conv_id, "author_id": {"$ne": uid}}
    if read and read.get("last_read_at"):
        q["created_at"] = {"$gt": read["last_read_at"]}
    return await db.messages.count_documents(q)


@api.get("/conversations")
async def list_conversations(user: dict = Depends(current_user)):
    convs = await db.conversations.find({"members": user["id"]}).to_list(200)
    seen = {c["id"] for c in convs}
    ms = await db.memberships.find({"user_id": user["id"]}).to_list(500)
    for m in ms:
        existing = await db.conversations.find_one({"type": "circle", "circle_id": m["circle_id"]})
        if not existing:
            circle = await db.circles.find_one({"id": m["circle_id"]})
            if circle:
                doc = {
                    "id": new_id(),
                    "type": "circle",
                    "circle_id": m["circle_id"],
                    "members": [],
                    "created_at": now_iso(),
                }
                await db.conversations.insert_one(doc)
                convs.append(doc)
        elif existing["id"] not in seen:
            seen.add(existing["id"])
            convs.append(existing)
    enriched = [await enrich_conversation(c, user["id"]) for c in convs]
    enriched.sort(key=lambda x: x["last_at"] or "", reverse=True)
    return enriched


@api.post("/conversations/direct")
async def start_direct(body: DirectIn, user: dict = Depends(current_user)):
    other = await db.users.find_one({"id": body.user_id})
    if not other:
        raise HTTPException(404, "User not found")
    existing = await db.conversations.find_one(
        {"type": "direct", "members": {"$all": [user["id"], body.user_id]}}
    )
    if existing:
        return await enrich_conversation(existing, user["id"])
    doc = {
        "id": new_id(),
        "type": "direct",
        "members": [user["id"], body.user_id],
        "created_at": now_iso(),
    }
    await db.conversations.insert_one(doc)
    return await enrich_conversation(doc, user["id"])


@api.get("/conversations/{conv_id}/messages")
async def get_messages(conv_id: str, user: dict = Depends(current_user)):
    msgs = await db.messages.find({"conversation_id": conv_id}).sort("created_at", 1).to_list(500)
    out = []
    for m in msgs:
        author = await db.users.find_one({"id": m["author_id"]})
        out.append(
            {
                "id": m["id"],
                "text": m.get("text", ""),
                "image_url": m.get("image_url"),
                "author_id": m["author_id"],
                "author_name": author["name"] if author else "Unknown",
                "author_avatar": author.get("avatar_url") if author else None,
                "mine": m["author_id"] == user["id"],
                "created_at": m["created_at"],
            }
        )
    # opening the conversation marks it read
    await db.conversation_reads.update_one(
        {"conversation_id": conv_id, "user_id": user["id"]},
        {"$set": {"last_read_at": now_iso()}},
        upsert=True,
    )
    return out


@api.post("/conversations/{conv_id}/read")
async def mark_read(conv_id: str, user: dict = Depends(current_user)):
    await db.conversation_reads.update_one(
        {"conversation_id": conv_id, "user_id": user["id"]},
        {"$set": {"last_read_at": now_iso()}},
        upsert=True,
    )
    return {"ok": True}


@api.get("/conversations/unread/total")
async def total_unread(user: dict = Depends(current_user)):
    convs = await db.conversations.find({"members": user["id"]}).to_list(200)
    ms = await db.memberships.find({"user_id": user["id"]}).to_list(500)
    circle_convs = await db.conversations.find(
        {"type": "circle", "circle_id": {"$in": [m["circle_id"] for m in ms]}}
    ).to_list(500)
    seen = set()
    total = 0
    for c in [*convs, *circle_convs]:
        if c["id"] in seen:
            continue
        seen.add(c["id"])
        total += await unread_count(c["id"], user["id"])
    return {"total": total}


@api.post("/conversations/{conv_id}/typing")
async def set_typing(conv_id: str, user: dict = Depends(current_user)):
    until = (datetime.now(timezone.utc) + timedelta(seconds=6)).isoformat()
    await db.typing.update_one(
        {"conversation_id": conv_id, "user_id": user["id"]},
        {"$set": {"until": until, "name": user["name"]}},
        upsert=True,
    )
    return {"ok": True}


@api.get("/conversations/{conv_id}/typing")
async def get_typing(conv_id: str, user: dict = Depends(current_user)):
    now = datetime.now(timezone.utc).isoformat()
    rows = await db.typing.find(
        {"conversation_id": conv_id, "user_id": {"$ne": user["id"]}, "until": {"$gt": now}}
    ).to_list(50)
    return {"names": [r.get("name", "Someone") for r in rows]}


@api.post("/conversations/{conv_id}/messages")
async def send_message(conv_id: str, body: MessageIn, user: dict = Depends(current_user)):
    conv = await db.conversations.find_one({"id": conv_id})
    if not conv:
        raise HTTPException(404, "Conversation not found")
    if not body.text.strip() and not body.image_url:
        raise HTTPException(400, "Message cannot be empty")
    doc = {
        "id": new_id(),
        "conversation_id": conv_id,
        "author_id": user["id"],
        "text": body.text.strip(),
        "image_url": body.image_url,
        "created_at": now_iso(),
    }
    await db.messages.insert_one(doc)
    return {
        "id": doc["id"],
        "text": doc["text"],
        "image_url": doc["image_url"],
        "author_id": user["id"],
        "author_name": user["name"],
        "author_avatar": user.get("avatar_url"),
        "mine": True,
        "created_at": doc["created_at"],
    }


# ------------------------------ Live Rooms ---------------------------------
async def enrich_room(r: dict, uid: str) -> dict:
    host = await db.users.find_one({"id": r["host_id"]})
    participant_count = await db.room_participants.count_documents({"room_id": r["id"]})
    mine = await db.room_participants.find_one({"room_id": r["id"], "user_id": uid})
    cohost_count = await db.room_participants.count_documents({"room_id": r["id"], "role": "cohost"})
    return {
        "id": r["id"],
        "title": r["title"],
        "status": r.get("status", "scheduled"),
        "host_id": r["host_id"],
        "host_name": host["name"] if host else "Host",
        "host_avatar": host.get("avatar_url") if host else None,
        "circle_id": r.get("circle_id"),
        "scheduled_at": r.get("scheduled_at"),
        "participant_count": participant_count,
        "joined": mine is not None,
        "is_host": r["host_id"] == uid,
        "my_role": mine.get("role", "listener") if mine else None,
        "my_hand_raised": bool(mine.get("hand_raised")) if mine else False,
        "cohost_count": cohost_count,
        "created_at": r.get("created_at"),
    }


@api.get("/rooms")
async def list_rooms(user: dict = Depends(current_user)):
    rooms = await db.rooms.find({"status": {"$ne": "ended"}}).sort("created_at", -1).to_list(100)
    return [await enrich_room(r, user["id"]) for r in rooms]


@api.post("/rooms")
async def create_room(body: RoomIn, user: dict = Depends(current_user)):
    status = "live" if not body.scheduled_at else "scheduled"
    doc = {
        "id": new_id(),
        "title": body.title.strip(),
        "host_id": user["id"],
        "circle_id": body.circle_id,
        "scheduled_at": body.scheduled_at,
        "status": status,
        "created_at": now_iso(),
    }
    await db.rooms.insert_one(doc)
    if status == "live":
        await db.room_participants.insert_one(
            {"id": new_id(), "room_id": doc["id"], "user_id": user["id"], "role": "host", "created_at": now_iso()}
        )
    return await enrich_room(doc, user["id"])


@api.get("/rooms/{room_id}")
async def get_room(room_id: str, user: dict = Depends(current_user)):
    r = await db.rooms.find_one({"id": room_id})
    if not r:
        raise HTTPException(404, "Room not found")
    data = await enrich_room(r, user["id"])
    parts = await db.room_participants.find({"room_id": room_id}).to_list(200)
    rank = {"host": 0, "cohost": 1, "listener": 2}
    participants = []
    for p in parts:
        u = await db.users.find_one({"id": p["user_id"]})
        if u:
            pu = public_user(u)
            pu["role"] = p.get("role", "listener")
            pu["hand_raised"] = bool(p.get("hand_raised"))
            participants.append(pu)
    participants.sort(key=lambda x: rank.get(x["role"], 3))
    data["participants"] = participants
    return data


@api.post("/rooms/{room_id}/join")
async def join_room(room_id: str, user: dict = Depends(current_user)):
    r = await db.rooms.find_one({"id": room_id})
    if not r:
        raise HTTPException(404, "Room not found")
    if r.get("status") == "scheduled" and r["host_id"] == user["id"]:
        await db.rooms.update_one({"id": room_id}, {"$set": {"status": "live"}})
    existing = await db.room_participants.find_one({"room_id": room_id, "user_id": user["id"]})
    if not existing:
        role = "host" if r["host_id"] == user["id"] else "listener"
        await db.room_participants.insert_one(
            {"id": new_id(), "room_id": room_id, "user_id": user["id"], "role": role, "created_at": now_iso()}
        )
    fresh = await db.rooms.find_one({"id": room_id})
    return await enrich_room(fresh, user["id"])


@api.post("/rooms/{room_id}/leave")
async def leave_room(room_id: str, user: dict = Depends(current_user)):
    r = await db.rooms.find_one({"id": room_id})
    if not r:
        raise HTTPException(404, "Room not found")
    await db.room_participants.delete_one({"room_id": room_id, "user_id": user["id"]})
    if r["host_id"] == user["id"]:
        await db.rooms.update_one({"id": room_id}, {"$set": {"status": "ended"}})
    return {"ok": True}


MAX_COHOSTS = 3


@api.post("/rooms/{room_id}/raise_hand")
async def raise_hand(room_id: str, user: dict = Depends(current_user)):
    p = await db.room_participants.find_one({"room_id": room_id, "user_id": user["id"]})
    if not p:
        raise HTTPException(404, "Join the room first")
    new_state = not bool(p.get("hand_raised"))
    await db.room_participants.update_one(
        {"room_id": room_id, "user_id": user["id"]}, {"$set": {"hand_raised": new_state}}
    )
    return {"hand_raised": new_state}


@api.post("/rooms/{room_id}/participants/{target_id}/promote")
async def promote_participant(room_id: str, target_id: str, user: dict = Depends(current_user)):
    r = await db.rooms.find_one({"id": room_id})
    if not r:
        raise HTTPException(404, "Room not found")
    if r["host_id"] != user["id"]:
        raise HTTPException(403, "Only the host can invite co-hosts")
    cohosts = await db.room_participants.count_documents({"room_id": room_id, "role": "cohost"})
    if cohosts >= MAX_COHOSTS:
        raise HTTPException(400, "All co-host seats are full")
    await db.room_participants.update_one(
        {"room_id": room_id, "user_id": target_id},
        {"$set": {"role": "cohost", "hand_raised": False}},
    )
    fresh = await db.rooms.find_one({"id": room_id})
    return await enrich_room(fresh, user["id"])


@api.post("/rooms/{room_id}/participants/{target_id}/demote")
async def demote_participant(room_id: str, target_id: str, user: dict = Depends(current_user)):
    r = await db.rooms.find_one({"id": room_id})
    if not r:
        raise HTTPException(404, "Room not found")
    if r["host_id"] != user["id"] and user["id"] != target_id:
        raise HTTPException(403, "Not allowed")
    await db.room_participants.update_one(
        {"room_id": room_id, "user_id": target_id}, {"$set": {"role": "listener"}}
    )
    fresh = await db.rooms.find_one({"id": room_id})
    return await enrich_room(fresh, user["id"])


@api.get("/rooms/{room_id}/messages")
async def room_messages(room_id: str, user: dict = Depends(current_user)):
    msgs = await db.room_messages.find({"room_id": room_id}).sort("created_at", 1).to_list(500)
    out = []
    for m in msgs:
        author = await db.users.find_one({"id": m["author_id"]})
        out.append(
            {
                "id": m["id"],
                "text": m["text"],
                "author_id": m["author_id"],
                "author_name": author["name"] if author else "Unknown",
                "author_avatar": author.get("avatar_url") if author else None,
                "mine": m["author_id"] == user["id"],
                "created_at": m["created_at"],
            }
        )
    return out


@api.post("/rooms/{room_id}/messages")
async def send_room_message(room_id: str, body: RoomMessageIn, user: dict = Depends(current_user)):
    doc = {
        "id": new_id(),
        "room_id": room_id,
        "author_id": user["id"],
        "text": body.text.strip(),
        "created_at": now_iso(),
    }
    await db.room_messages.insert_one(doc)
    return {
        "id": doc["id"],
        "text": doc["text"],
        "author_id": user["id"],
        "author_name": user["name"],
        "author_avatar": user.get("avatar_url"),
        "mine": True,
        "created_at": doc["created_at"],
    }


# ------------------------------- Wallet ------------------------------------
@api.get("/wallet")
async def wallet(user: dict = Depends(current_user)):
    txns = await db.transactions.find({"user_id": user["id"]}).sort("created_at", -1).to_list(100)
    fresh = await db.users.find_one({"id": user["id"]})
    return {
        "balance": fresh.get("coins", 0),
        "gift_costs": GIFT_COSTS,
        "transactions": [{k: v for k, v in t.items() if k != "_id"} for t in txns],
    }


@api.post("/wallet/buy")
async def buy_coins(body: BuyCoinsIn, user: dict = Depends(current_user)):
    if body.amount <= 0:
        raise HTTPException(400, "Invalid amount")
    await db.users.update_one({"id": user["id"]}, {"$inc": {"coins": body.amount}})
    txn = {
        "id": new_id(),
        "user_id": user["id"],
        "type": "purchase",
        "amount": body.amount,
        "label": f"Purchased {body.amount} coins",
        "created_at": now_iso(),
    }
    await db.transactions.insert_one(txn)
    fresh = await db.users.find_one({"id": user["id"]})
    return {"balance": fresh.get("coins", 0), "transaction": {k: v for k, v in txn.items() if k != "_id"}}


@api.post("/gifts")
async def send_gift(body: GiftIn, user: dict = Depends(current_user)):
    cost = GIFT_COSTS.get(body.gift_type)
    if cost is None:
        raise HTTPException(400, "Unknown gift")
    fresh = await db.users.find_one({"id": user["id"]})
    if fresh.get("coins", 0) < cost:
        raise HTTPException(400, "Not enough coins")
    recipient = await db.users.find_one({"id": body.recipient_id})
    if not recipient:
        raise HTTPException(404, "Recipient not found")
    await db.users.update_one({"id": user["id"]}, {"$inc": {"coins": -cost}})
    await db.users.update_one({"id": body.recipient_id}, {"$inc": {"coins": cost}})
    txn = {
        "id": new_id(),
        "user_id": user["id"],
        "type": "gift_sent",
        "amount": -cost,
        "label": f"Sent {body.gift_type} to {recipient['name']}",
        "created_at": now_iso(),
    }
    await db.transactions.insert_one(txn)
    await db.transactions.insert_one(
        {
            "id": new_id(),
            "user_id": body.recipient_id,
            "type": "gift_received",
            "amount": cost,
            "label": f"Received {body.gift_type} from {user['name']}",
            "created_at": now_iso(),
        }
    )
    updated = await db.users.find_one({"id": user["id"]})
    return {"balance": updated.get("coins", 0), "gift_type": body.gift_type}


# ----------------------------- Moderation ----------------------------------
@api.post("/reports")
async def create_report(body: ReportIn, user: dict = Depends(current_user)):
    doc = {
        "id": new_id(),
        "reporter_id": user["id"],
        "target_type": body.target_type,
        "target_id": body.target_id,
        "reason": body.reason,
        "status": "open",
        "created_at": now_iso(),
    }
    await db.reports.insert_one(doc)
    return {"ok": True}


@api.get("/moderation/reports")
async def list_reports(user: dict = Depends(current_user)):
    if not user.get("is_moderator"):
        raise HTTPException(403, "Not a moderator")
    reports = await db.reports.find({"status": "open"}).sort("created_at", -1).to_list(200)
    return [{k: v for k, v in r.items() if k != "_id"} for r in reports]


# ------------------------------ Uploads ------------------------------------
@api.post("/upload")
async def upload(file: UploadFile = File(...), user: dict = Depends(current_user)):
    data = await file.read()
    ext = (file.filename or "upload.jpg").split(".")[-1].lower()
    if ext not in ("jpg", "jpeg", "png", "webp", "gif", "heic"):
        ext = "jpg"
    path = f"{APP_NAME}/uploads/{user['id']}/{new_id()}.{ext}"
    ctype = file.content_type or "image/jpeg"
    try:
        result = await run_in_threadpool(put_object, path, data, ctype)
    except Exception as e:
        logger.error(f"upload failed: {e}")
        raise HTTPException(502, "Upload failed")
    stored = result.get("path", path)
    await db.uploads.insert_one(
        {"id": new_id(), "path": stored, "owner_id": user["id"], "content_type": ctype, "created_at": now_iso()}
    )
    return {"url": f"/api/files/{stored}", "path": stored}


@api.get("/files/{path:path}")
async def serve_file(path: str):
    try:
        content, ctype = await run_in_threadpool(get_object, path)
    except Exception as e:
        logger.error(f"serve failed: {e}")
        raise HTTPException(404, "File not found")
    return Response(content=content, media_type=ctype, headers={"Cache-Control": "public, max-age=31536000"})


app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Seed demo data
# ---------------------------------------------------------------------------
SEED_CIRCLES = [
    {"name": "Morning Pages", "category": "Writing", "description": "Daily journaling and creative writing prompts for the quiet hours.", "cover_url": "https://images.pexels.com/photos/4240497/pexels-photo-4240497.jpeg"},
    {"name": "Slow Mornings", "category": "Wellness", "description": "Coffee rituals, slow living, and mindful starts to the day.", "cover_url": "https://images.pexels.com/photos/1002740/pexels-photo-1002740.jpeg"},
    {"name": "Film Photographers", "category": "Photography", "description": "35mm, medium format, and the beauty of grain. Share your rolls.", "cover_url": "https://images.pexels.com/photos/1983037/pexels-photo-1983037.jpeg"},
    {"name": "Home Cooks", "category": "Food", "description": "Seasonal recipes, kitchen experiments, and comfort food.", "cover_url": "https://images.pexels.com/photos/1640777/pexels-photo-1640777.jpeg"},
    {"name": "Trail Runners", "category": "Fitness", "description": "Mountains, mud, and miles. Find your next trail.", "cover_url": "https://images.pexels.com/photos/2524739/pexels-photo-2524739.jpeg"},
    {"name": "Ceramics Studio", "category": "Craft", "description": "Wheel throwing, hand building, and glaze chemistry.", "cover_url": "https://images.pexels.com/photos/4207892/pexels-photo-4207892.jpeg"},
]

SEED_INTERESTS = ["Writing", "Wellness", "Photography", "Food", "Fitness", "Craft", "Music", "Books", "Travel", "Art", "Design", "Nature"]

SEED_POSTS = [
    "Woke up before the sun and wrote three pages longhand. There is something about the quiet before the day starts.",
    "Today's prompt: describe a room you loved as a child. Mine had yellow curtains and a window that faced the garden.",
    "Developed a roll from last weekend's hike — the light at golden hour was unreal. Portra 400 never misses.",
    "Made a big pot of white bean soup with rosemary and lemon. Simple, warm, exactly what today needed.",
    "Ran the ridge loop this morning. Ten miles, fog the whole way, saw two deer. Worth every early alarm.",
    "First pull off the wheel in weeks. Wobbly but mine. Trimming tomorrow once it's leather-hard.",
]


@app.on_event("startup")
async def startup():
    try:
        await db.users.create_index("email", unique=True)
        await db.users.create_index("id", unique=True)
        await db.circles.create_index("id")
        await db.posts.create_index("circle_id")
        await db.memberships.create_index([("circle_id", 1), ("user_id", 1)])
    except Exception as e:
        logger.warning(f"index setup: {e}")

    try:
        init_storage()
        logger.info("object storage initialised")
    except Exception as e:
        logger.warning(f"storage init deferred: {e}")

    existing = await db.users.find_one({"email": "guide@circles.app"})
    if existing:
        return
    guide = {
        "id": new_id(),
        "email": "guide@circles.app",
        "name": "Mara Ellison",
        "password_hash": hash_password("circles123"),
        "bio": "Community guide. Here to help you find your people.",
        "avatar_url": "https://images.pexels.com/photos/774909/pexels-photo-774909.jpeg",
        "interests": ["Writing", "Wellness"],
        "onboarded": True,
        "coins": 500,
        "is_moderator": True,
        "created_at": now_iso(),
    }
    await db.users.insert_one(guide)

    if not await db.users.find_one({"email": "demo@circles.app"}):
        demo = {
            "id": new_id(),
            "email": "demo@circles.app",
            "name": "Demo Explorer",
            "password_hash": hash_password("demo1234"),
            "bio": "Just exploring Circles.",
            "avatar_url": None,
            "interests": [],
            "onboarded": False,
            "coins": 100,
            "is_moderator": False,
            "created_at": now_iso(),
        }
        await db.users.insert_one(demo)

    created_ids = []
    for i, sc in enumerate(SEED_CIRCLES):
        cid = new_id()
        created_ids.append(cid)
        await db.circles.insert_one(
            {
                "id": cid,
                "name": sc["name"],
                "description": sc["description"],
                "category": sc["category"],
                "cover_url": sc["cover_url"],
                "is_private": False,
                "owner_id": guide["id"],
                "created_at": now_iso(),
            }
        )
        await db.memberships.insert_one(
            {"id": new_id(), "circle_id": cid, "user_id": guide["id"], "role": "owner", "created_at": now_iso()}
        )
        await db.posts.insert_one(
            {
                "id": new_id(),
                "circle_id": cid,
                "author_id": guide["id"],
                "text": SEED_POSTS[i % len(SEED_POSTS)],
                "image_url": sc["cover_url"],
                "deleted": False,
                "created_at": now_iso(),
            }
        )

    rid = new_id()
    await db.rooms.insert_one(
        {
            "id": rid,
            "title": "Sunday writing circle — bring your pages",
            "host_id": guide["id"],
            "circle_id": created_ids[0] if created_ids else None,
            "scheduled_at": None,
            "status": "live",
            "created_at": now_iso(),
        }
    )
    await db.room_participants.insert_one(
        {"id": new_id(), "room_id": rid, "user_id": guide["id"], "role": "host", "created_at": now_iso()}
    )
    logger.info("seed data created")


@app.on_event("shutdown")
async def shutdown():
    client.close()
