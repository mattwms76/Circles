"""Comprehensive Circles backend API tests."""
import os
import io
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")
if not BASE_URL:
    # fallback to frontend env file
    from pathlib import Path
    env = Path("/app/frontend/.env").read_text()
    for line in env.splitlines():
        if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip()
            break
BASE_URL = BASE_URL.rstrip("/")
API = BASE_URL + "/api"

GUIDE = {"email": "guide@circles.app", "password": "circles123"}
DEMO = {"email": "demo@circles.app", "password": "demo1234"}


# ---------------- shared tokens ----------------
@pytest.fixture(scope="session")
def guide_token():
    r = requests.post(f"{API}/auth/login", json=GUIDE, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def demo_token():
    r = requests.post(f"{API}/auth/login", json=DEMO, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def new_user():
    """Register a brand new user for tests that mutate state."""
    email = f"TEST_{uuid.uuid4().hex[:10]}@circles.app"
    r = requests.post(f"{API}/auth/register", json={"email": email, "password": "testpass1", "name": "Test User"}, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    return {"token": data["access_token"], "user": data["user"], "email": email}


def auth(token):
    return {"Authorization": f"Bearer {token}"}


# ---------------- Auth ----------------
class TestAuth:
    def test_login_guide(self, guide_token):
        assert guide_token

    def test_login_wrong_password(self):
        r = requests.post(f"{API}/auth/login", json={"email": GUIDE["email"], "password": "wrong"}, timeout=30)
        assert r.status_code == 401

    def test_register_duplicate(self):
        r = requests.post(f"{API}/auth/register", json={"email": GUIDE["email"], "password": "x" * 8, "name": "x"}, timeout=30)
        assert r.status_code == 409

    def test_me_unauthenticated(self):
        r = requests.get(f"{API}/auth/me", timeout=30)
        assert r.status_code in (401, 403)

    def test_me_authenticated(self, guide_token):
        r = requests.get(f"{API}/auth/me", headers=auth(guide_token), timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["email"] == GUIDE["email"]
        assert d["is_moderator"] is True
        assert d["onboarded"] is True

    def test_register_new_user(self, new_user):
        assert new_user["user"]["onboarded"] is False
        assert new_user["user"]["coins"] == 100


# ---------------- Onboarding (users/me) ----------------
class TestOnboarding:
    def test_update_interests_and_onboarded(self, new_user):
        r = requests.put(
            f"{API}/users/me",
            headers=auth(new_user["token"]),
            json={"interests": ["Writing", "Wellness"], "onboarded": True, "bio": "hello"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["onboarded"] is True
        assert "Writing" in d["interests"]
        # Verify persistence
        me = requests.get(f"{API}/auth/me", headers=auth(new_user["token"]), timeout=30).json()
        assert me["onboarded"] is True
        assert me["bio"] == "hello"


# ---------------- Circles ----------------
class TestCircles:
    def test_list_circles_seeded(self, guide_token):
        r = requests.get(f"{API}/circles", headers=auth(guide_token), timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert len(data) >= 6
        names = [c["name"] for c in data]
        assert "Morning Pages" in names

    def test_search_filter(self, guide_token):
        r = requests.get(f"{API}/circles?search=Morning", headers=auth(guide_token), timeout=30)
        assert r.status_code == 200
        for c in r.json():
            assert "morning" in c["name"].lower()

    def test_category_filter(self, guide_token):
        r = requests.get(f"{API}/circles?category=Writing", headers=auth(guide_token), timeout=30)
        assert r.status_code == 200
        for c in r.json():
            assert c["category"] == "Writing"

    def test_mine_filter(self, guide_token):
        r = requests.get(f"{API}/circles?mine=true", headers=auth(guide_token), timeout=30)
        assert r.status_code == 200
        # guide owns all seed circles
        assert len(r.json()) >= 6

    def test_create_join_leave_flow(self, new_user, guide_token):
        # Create
        r = requests.post(
            f"{API}/circles",
            headers=auth(new_user["token"]),
            json={"name": f"TEST_Circle_{uuid.uuid4().hex[:6]}", "description": "d", "category": "Writing"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        c = r.json()
        assert c["is_owner"] is True
        assert c["is_member"] is True
        cid = c["id"]

        # Guide joins
        r = requests.post(f"{API}/circles/{cid}/join", headers=auth(guide_token), timeout=30)
        assert r.status_code == 200
        assert r.json()["is_member"] is True

        # Members
        r = requests.get(f"{API}/circles/{cid}/members", headers=auth(guide_token), timeout=30)
        assert r.status_code == 200
        assert len(r.json()) == 2

        # Owner cannot leave own circle
        r = requests.post(f"{API}/circles/{cid}/leave", headers=auth(new_user["token"]), timeout=30)
        assert r.status_code == 400

        # Guide leaves
        r = requests.post(f"{API}/circles/{cid}/leave", headers=auth(guide_token), timeout=30)
        assert r.status_code == 200

        # Events: create + list
        r = requests.post(
            f"{API}/circles/{cid}/events",
            headers=auth(new_user["token"]),
            json={"title": "TEST Event", "description": "d", "starts_at": "2026-02-01T10:00:00Z"},
            timeout=30,
        )
        assert r.status_code == 200
        r = requests.get(f"{API}/circles/{cid}/events", headers=auth(new_user["token"]), timeout=30)
        assert r.status_code == 200 and len(r.json()) >= 1


# ---------------- Feed & Posts ----------------
class TestFeedPosts:
    def test_feed_returns_public_fallback(self, demo_token):
        """Demo user has joined nothing; should still see public posts."""
        r = requests.get(f"{API}/feed", headers=auth(demo_token), timeout=30)
        assert r.status_code == 200
        assert len(r.json()) >= 1

    def test_create_post_like_comment_delete(self, new_user, guide_token):
        # Need a circle; use first seed
        circles = requests.get(f"{API}/circles", headers=auth(new_user["token"]), timeout=30).json()
        cid = circles[0]["id"]

        # Create post
        r = requests.post(
            f"{API}/posts",
            headers=auth(new_user["token"]),
            json={"circle_id": cid, "text": "TEST post hello"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        p = r.json()
        pid = p["id"]
        assert p["like_count"] == 0 and p["liked"] is False

        # Empty post rejected
        r = requests.post(
            f"{API}/posts",
            headers=auth(new_user["token"]),
            json={"circle_id": cid, "text": ""},
            timeout=30,
        )
        assert r.status_code == 400

        # Like twice (toggle)
        r = requests.post(f"{API}/posts/{pid}/like", headers=auth(guide_token), timeout=30)
        assert r.status_code == 200 and r.json()["liked"] is True and r.json()["like_count"] == 1
        r = requests.post(f"{API}/posts/{pid}/like", headers=auth(guide_token), timeout=30)
        assert r.json()["liked"] is False and r.json()["like_count"] == 0

        # Comment
        r = requests.post(
            f"{API}/posts/{pid}/comments",
            headers=auth(guide_token),
            json={"text": "TEST comment"},
            timeout=30,
        )
        assert r.status_code == 200
        r = requests.get(f"{API}/posts/{pid}/comments", headers=auth(new_user["token"]), timeout=30)
        assert r.status_code == 200 and len(r.json()) == 1

        # Circle posts
        r = requests.get(f"{API}/circles/{cid}/posts", headers=auth(new_user["token"]), timeout=30)
        assert r.status_code == 200
        assert any(x["id"] == pid for x in r.json())

        # Delete by author
        r = requests.delete(f"{API}/posts/{pid}", headers=auth(new_user["token"]), timeout=30)
        assert r.status_code == 200

    def test_delete_post_forbidden(self, new_user, demo_token, guide_token):
        """Non-author non-moderator cannot delete."""
        circles = requests.get(f"{API}/circles", headers=auth(new_user["token"]), timeout=30).json()
        cid = circles[0]["id"]
        p = requests.post(
            f"{API}/posts", headers=auth(new_user["token"]),
            json={"circle_id": cid, "text": "forbidden-delete-test"}, timeout=30,
        ).json()
        r = requests.delete(f"{API}/posts/{p['id']}", headers=auth(demo_token), timeout=30)
        assert r.status_code == 403
        # Moderator (guide) can delete
        r = requests.delete(f"{API}/posts/{p['id']}", headers=auth(guide_token), timeout=30)
        assert r.status_code == 200


# ---------------- Messaging ----------------
class TestMessaging:
    def test_conversations_auto_create_circle_chats(self, new_user):
        # Join a circle
        circles = requests.get(f"{API}/circles", headers=auth(new_user["token"]), timeout=30).json()
        cid = circles[0]["id"]
        requests.post(f"{API}/circles/{cid}/join", headers=auth(new_user["token"]), timeout=30)
        r = requests.get(f"{API}/conversations", headers=auth(new_user["token"]), timeout=30)
        assert r.status_code == 200
        convs = r.json()
        assert any(c["type"] == "circle" and c["circle_id"] == cid for c in convs)

    def test_direct_conversation_and_message(self, new_user, guide_token):
        guide_me = requests.get(f"{API}/auth/me", headers=auth(guide_token), timeout=30).json()
        r = requests.post(
            f"{API}/conversations/direct",
            headers=auth(new_user["token"]),
            json={"user_id": guide_me["id"]},
            timeout=30,
        )
        assert r.status_code == 200
        conv_id = r.json()["id"]

        # Idempotent
        r2 = requests.post(
            f"{API}/conversations/direct",
            headers=auth(new_user["token"]),
            json={"user_id": guide_me["id"]},
            timeout=30,
        )
        assert r2.json()["id"] == conv_id

        # Send
        r = requests.post(
            f"{API}/conversations/{conv_id}/messages",
            headers=auth(new_user["token"]),
            json={"text": "TEST hi there"},
            timeout=30,
        )
        assert r.status_code == 200 and r.json()["mine"] is True

        # Empty rejected
        r = requests.post(
            f"{API}/conversations/{conv_id}/messages",
            headers=auth(new_user["token"]), json={"text": ""}, timeout=30,
        )
        assert r.status_code == 400

        # Read
        r = requests.get(f"{API}/conversations/{conv_id}/messages", headers=auth(guide_token), timeout=30)
        assert r.status_code == 200 and len(r.json()) == 1


# ---------------- Live Rooms ----------------
class TestRooms:
    def test_list_rooms_seeded(self, guide_token):
        r = requests.get(f"{API}/rooms", headers=auth(guide_token), timeout=30)
        assert r.status_code == 200
        assert len(r.json()) >= 1

    def test_room_lifecycle(self, new_user, guide_token):
        r = requests.post(
            f"{API}/rooms",
            headers=auth(new_user["token"]),
            json={"title": "TEST room"},
            timeout=30,
        )
        assert r.status_code == 200
        room = r.json()
        assert room["status"] == "live"
        rid = room["id"]

        # Guide joins
        r = requests.post(f"{API}/rooms/{rid}/join", headers=auth(guide_token), timeout=30)
        assert r.status_code == 200 and r.json()["joined"] is True

        # Get room with participants
        r = requests.get(f"{API}/rooms/{rid}", headers=auth(guide_token), timeout=30)
        assert r.status_code == 200
        assert len(r.json()["participants"]) >= 2

        # Message
        r = requests.post(
            f"{API}/rooms/{rid}/messages", headers=auth(guide_token),
            json={"text": "TEST hello room"}, timeout=30,
        )
        assert r.status_code == 200
        r = requests.get(f"{API}/rooms/{rid}/messages", headers=auth(new_user["token"]), timeout=30)
        assert r.status_code == 200 and len(r.json()) >= 1

        # Leave; host leaving ends room
        r = requests.post(f"{API}/rooms/{rid}/leave", headers=auth(new_user["token"]), timeout=30)
        assert r.status_code == 200


# ---------------- Wallet & Gifts ----------------
class TestWalletGifts:
    def test_wallet_basic(self, new_user):
        r = requests.get(f"{API}/wallet", headers=auth(new_user["token"]), timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["balance"] == 100
        assert "Heart" in d["gift_costs"]

    def test_buy_coins_persists(self, new_user):
        r = requests.post(f"{API}/wallet/buy", headers=auth(new_user["token"]), json={"amount": 50}, timeout=30)
        assert r.status_code == 200
        assert r.json()["balance"] >= 150
        # Verify via GET
        bal = requests.get(f"{API}/wallet", headers=auth(new_user["token"]), timeout=30).json()["balance"]
        assert bal >= 150

    def test_buy_invalid_amount(self, new_user):
        r = requests.post(f"{API}/wallet/buy", headers=auth(new_user["token"]), json={"amount": -5}, timeout=30)
        assert r.status_code == 400

    def test_gift_flow_and_insufficient(self, new_user, guide_token):
        guide = requests.get(f"{API}/auth/me", headers=auth(guide_token), timeout=30).json()
        # Send a Heart (10 coins)
        r = requests.post(
            f"{API}/gifts", headers=auth(new_user["token"]),
            json={"recipient_id": guide["id"], "gift_type": "Heart"}, timeout=30,
        )
        assert r.status_code == 200
        assert r.json()["gift_type"] == "Heart"

        # Insufficient (Rocket costs 300, but new user has <=150-10 ~140)
        # First drain balance by checking
        bal = requests.get(f"{API}/wallet", headers=auth(new_user["token"]), timeout=30).json()["balance"]
        if bal < 300:
            r = requests.post(
                f"{API}/gifts", headers=auth(new_user["token"]),
                json={"recipient_id": guide["id"], "gift_type": "Rocket"}, timeout=30,
            )
            assert r.status_code == 400

        # Unknown gift
        r = requests.post(
            f"{API}/gifts", headers=auth(new_user["token"]),
            json={"recipient_id": guide["id"], "gift_type": "Nope"}, timeout=30,
        )
        assert r.status_code == 400


# ---------------- Moderation ----------------
class TestModeration:
    def test_report_and_mod_list(self, new_user, demo_token, guide_token):
        r = requests.post(
            f"{API}/reports", headers=auth(new_user["token"]),
            json={"target_type": "post", "target_id": "fake-id", "reason": "TEST spam"}, timeout=30,
        )
        assert r.status_code == 200

        # Non-mod forbidden
        r = requests.get(f"{API}/moderation/reports", headers=auth(demo_token), timeout=30)
        assert r.status_code == 403

        # Guide (mod) ok
        r = requests.get(f"{API}/moderation/reports", headers=auth(guide_token), timeout=30)
        assert r.status_code == 200
        assert any(x["reason"] == "TEST spam" for x in r.json())


# ---------------- Upload / file serve ----------------
class TestUpload:
    def test_upload_and_fetch(self, guide_token):
        # tiny PNG
        png = (
            b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
            b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\xcf"
            b"\xc0\xf0\x1f\x00\x05\x00\x01\xfeAW\xbe\xd1\x00\x00\x00\x00IEND\xaeB`\x82"
        )
        files = {"file": ("test.png", io.BytesIO(png), "image/png")}
        r = requests.post(f"{API}/upload", headers=auth(guide_token), files=files, timeout=60)
        if r.status_code == 502:
            pytest.skip("object storage not reachable in this environment")
        assert r.status_code == 200, r.text
        url = r.json()["url"]
        assert url.startswith("/api/files/")
        # Serve (public)
        r2 = requests.get(BASE_URL + url, timeout=60)
        assert r2.status_code == 200
        assert r2.headers.get("content-type", "").startswith("image/")
