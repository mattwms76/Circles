"""Iter10: verification of newly-applied authorization fixes in
server.py (SEC-001 Rooms, SEC-002 Events creation, SEC-003 like/rsvp/leaderboard)
plus regression on prior fixes and normal member flows.

Base URL = EXPO_PUBLIC_BACKEND_URL in /app/frontend/.env, all under /api.
Credentials: guide@circles.app / circles123, demo@circles.app / demo1234.

Rate limits: login 10/min, register 5/min. _register retries on 429.
Happy path tested first; destructive/edge paths after.
"""
import os
import time
import uuid
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv

load_dotenv(Path("/app/frontend/.env"))
BASE = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") + "/api"

GUIDE_EMAIL = "guide@circles.app"
GUIDE_PASS = "circles123"
DEMO_EMAIL = "demo@circles.app"
DEMO_PASS = "demo1234"


def _tag() -> str:
    return uuid.uuid4().hex[:8]


def _auth(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}"}


def _register(prefix: str) -> dict:
    email = f"TEST_{prefix}_{_tag()}@circles.app"
    pw = "pass1234"
    for _ in range(8):
        r = requests.post(f"{BASE}/auth/register", json={
            "email": email, "password": pw, "name": f"TEST {prefix}",
            "date_of_birth": "1995-05-20", "accepted_terms": True,
        }, timeout=20)
        if r.status_code == 429:
            time.sleep(13)
            continue
        assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
        j = r.json()
        return {"token": j["access_token"], "user": j["user"], "email": email}
    pytest.fail(f"register kept 429'ing for {email}")


def _login(email: str, password: str) -> str:
    for _ in range(5):
        r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": password}, timeout=20)
        if r.status_code == 429:
            time.sleep(13)
            continue
        assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
        return r.json()["access_token"]
    pytest.fail("login kept 429'ing")


# ---------------- session fixtures (do heavy setup once) -------------------
@pytest.fixture(scope="session")
def guide_tok() -> str:
    return _login(GUIDE_EMAIL, GUIDE_PASS)


@pytest.fixture(scope="session")
def user_nonmember() -> dict:
    return _register("nonmember")


@pytest.fixture(scope="session")
def user_member() -> dict:
    return _register("member")


@pytest.fixture(scope="session")
def private_circle(guide_tok) -> dict:
    """A fresh PRIVATE circle owned by guide."""
    r = requests.post(f"{BASE}/circles", json={
        "name": f"TEST priv {_tag()}",
        "description": "iter10 private",
        "category": "General",
        "is_private": True,
    }, headers=_auth(guide_tok), timeout=20)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="session")
def public_circle(guide_tok) -> dict:
    """A fresh PUBLIC circle owned by guide for regression tests."""
    r = requests.post(f"{BASE}/circles", json={
        "name": f"TEST pub {_tag()}",
        "description": "iter10 public",
        "category": "General",
        "is_private": False,
    }, headers=_auth(guide_tok), timeout=20)
    assert r.status_code == 200, r.text
    return r.json()


# ============================================================
# SEC-002 — Event creation authorization
# ============================================================
class TestSEC002EventCreate:
    def test_create_event_as_owner_200(self, guide_tok, private_circle):
        r = requests.post(f"{BASE}/circles/{private_circle['id']}/events", json={
            "title": "owner event",
            "description": "x",
            "starts_at": "2030-01-01T10:00:00Z",
        }, headers=_auth(guide_tok), timeout=20)
        assert r.status_code == 200, r.text
        assert r.json().get("title") == "owner event"

    def test_create_event_nonmember_403(self, user_nonmember, private_circle):
        r = requests.post(f"{BASE}/circles/{private_circle['id']}/events", json={
            "title": "sneaky event",
            "description": "x",
            "starts_at": "2030-01-01T10:00:00Z",
        }, headers=_auth(user_nonmember["token"]), timeout=20)
        assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text}"

    def test_create_event_after_join_200(self, user_member, private_circle):
        # join first
        r = requests.post(f"{BASE}/circles/{private_circle['id']}/join",
                          headers=_auth(user_member["token"]), timeout=20)
        assert r.status_code == 200, r.text
        r2 = requests.post(f"{BASE}/circles/{private_circle['id']}/events", json={
            "title": "member event",
            "description": "x",
            "starts_at": "2030-02-02T10:00:00Z",
        }, headers=_auth(user_member["token"]), timeout=20)
        assert r2.status_code == 200, f"member should post event, got {r2.status_code} {r2.text}"

    def test_create_event_nonexistent_circle_404(self, guide_tok):
        r = requests.post(f"{BASE}/circles/does-not-exist-xyz/events", json={
            "title": "no circle",
            "description": "x",
            "starts_at": "2030-02-02T10:00:00Z",
        }, headers=_auth(guide_tok), timeout=20)
        assert r.status_code == 404, f"expected 404, got {r.status_code} {r.text}"


# ============================================================
# SEC-001 — Rooms authorization against private-circle rooms
# ============================================================
class TestSEC001Rooms:
    @pytest.fixture(scope="class")
    def priv_room(self, guide_tok, private_circle):
        r = requests.post(f"{BASE}/rooms", json={
            "title": f"TEST priv room {_tag()}",
            "circle_id": private_circle["id"],
        }, headers=_auth(guide_tok), timeout=20)
        assert r.status_code == 200, r.text
        return r.json()

    # ---- member/owner happy paths ----
    def test_owner_get_room_200(self, guide_tok, priv_room):
        r = requests.get(f"{BASE}/rooms/{priv_room['id']}", headers=_auth(guide_tok), timeout=20)
        assert r.status_code == 200, r.text

    def test_owner_post_message_200(self, guide_tok, priv_room):
        r = requests.post(f"{BASE}/rooms/{priv_room['id']}/messages",
                          json={"text": "owner hi"}, headers=_auth(guide_tok), timeout=20)
        assert r.status_code == 200, r.text

    def test_owner_get_messages_200(self, guide_tok, priv_room):
        r = requests.get(f"{BASE}/rooms/{priv_room['id']}/messages",
                         headers=_auth(guide_tok), timeout=20)
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)

    # ---- non-member must 403 ----
    def test_nonmember_get_room_403(self, user_nonmember, priv_room):
        r = requests.get(f"{BASE}/rooms/{priv_room['id']}",
                         headers=_auth(user_nonmember["token"]), timeout=20)
        assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text}"

    def test_nonmember_join_room_403(self, user_nonmember, priv_room):
        r = requests.post(f"{BASE}/rooms/{priv_room['id']}/join",
                          headers=_auth(user_nonmember["token"]), timeout=20)
        assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text}"

    def test_nonmember_get_messages_403(self, user_nonmember, priv_room):
        r = requests.get(f"{BASE}/rooms/{priv_room['id']}/messages",
                         headers=_auth(user_nonmember["token"]), timeout=20)
        assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text}"

    def test_nonmember_post_message_403(self, user_nonmember, priv_room):
        r = requests.post(f"{BASE}/rooms/{priv_room['id']}/messages",
                          json={"text": "sneaky"}, headers=_auth(user_nonmember["token"]), timeout=20)
        assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text}"

    # ---- create_room gating ----
    def test_create_room_nonmember_private_403(self, user_nonmember, private_circle):
        r = requests.post(f"{BASE}/rooms", json={
            "title": "sneaky room",
            "circle_id": private_circle["id"],
        }, headers=_auth(user_nonmember["token"]), timeout=20)
        assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text}"

    def test_create_room_nonexistent_circle_404(self, guide_tok):
        r = requests.post(f"{BASE}/rooms", json={
            "title": "bad room",
            "circle_id": "does-not-exist-xyz",
        }, headers=_auth(guide_tok), timeout=20)
        assert r.status_code == 404, f"expected 404, got {r.status_code} {r.text}"

    # ---- global rooms (no circle_id) remain open ----
    def test_global_room_create_and_access(self, guide_tok, user_nonmember):
        r = requests.post(f"{BASE}/rooms", json={"title": f"TEST global {_tag()}"},
                         headers=_auth(guide_tok), timeout=20)
        assert r.status_code == 200, r.text
        global_room = r.json()
        rid = global_room["id"]

        # Non-member of any circle can still access/join/post
        r1 = requests.get(f"{BASE}/rooms/{rid}", headers=_auth(user_nonmember["token"]), timeout=20)
        assert r1.status_code == 200, r1.text
        r2 = requests.post(f"{BASE}/rooms/{rid}/join",
                           headers=_auth(user_nonmember["token"]), timeout=20)
        assert r2.status_code == 200, r2.text
        r3 = requests.post(f"{BASE}/rooms/{rid}/messages", json={"text": "hi global"},
                           headers=_auth(user_nonmember["token"]), timeout=20)
        assert r3.status_code == 200, r3.text
        r4 = requests.get(f"{BASE}/rooms/{rid}/messages",
                          headers=_auth(user_nonmember["token"]), timeout=20)
        assert r4.status_code == 200, r4.text


# ============================================================
# SEC-003 — toggle_like / toggle_rsvp / circle_leaderboard gating
# ============================================================
class TestSEC003LikeRsvpLeaderboard:
    @pytest.fixture(scope="class")
    def priv_post(self, guide_tok, private_circle):
        r = requests.post(f"{BASE}/posts", json={
            "circle_id": private_circle["id"],
            "text": "iter10 private post",
        }, headers=_auth(guide_tok), timeout=20)
        assert r.status_code == 200, r.text
        return r.json()

    @pytest.fixture(scope="class")
    def priv_event(self, guide_tok, private_circle):
        r = requests.post(f"{BASE}/circles/{private_circle['id']}/events", json={
            "title": "iter10 priv event",
            "description": "x",
            "starts_at": "2030-03-03T10:00:00Z",
        }, headers=_auth(guide_tok), timeout=20)
        assert r.status_code == 200, r.text
        return r.json()

    # ---- like ----
    def test_like_nonmember_403(self, user_nonmember, priv_post):
        r = requests.post(f"{BASE}/posts/{priv_post['id']}/like",
                          headers=_auth(user_nonmember["token"]), timeout=20)
        assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text}"

    def test_like_owner_200(self, guide_tok, priv_post):
        r = requests.post(f"{BASE}/posts/{priv_post['id']}/like",
                          headers=_auth(guide_tok), timeout=20)
        assert r.status_code == 200, r.text
        assert "liked" in r.json()

    def test_like_nonexistent_post_404(self, guide_tok):
        r = requests.post(f"{BASE}/posts/does-not-exist-xyz/like",
                          headers=_auth(guide_tok), timeout=20)
        assert r.status_code == 404, f"expected 404, got {r.status_code} {r.text}"

    # ---- rsvp ----
    def test_rsvp_nonmember_403(self, user_nonmember, priv_event):
        r = requests.post(f"{BASE}/events/{priv_event['id']}/rsvp",
                          headers=_auth(user_nonmember["token"]), timeout=20)
        assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text}"

    def test_rsvp_owner_200(self, guide_tok, priv_event):
        r = requests.post(f"{BASE}/events/{priv_event['id']}/rsvp",
                          headers=_auth(guide_tok), timeout=20)
        assert r.status_code == 200, r.text

    def test_rsvp_nonexistent_event_404(self, guide_tok):
        r = requests.post(f"{BASE}/events/does-not-exist-xyz/rsvp",
                          headers=_auth(guide_tok), timeout=20)
        assert r.status_code == 404, f"expected 404, got {r.status_code} {r.text}"

    # ---- leaderboard ----
    def test_leaderboard_nonmember_403(self, user_nonmember, private_circle):
        r = requests.get(f"{BASE}/circles/{private_circle['id']}/leaderboard",
                         headers=_auth(user_nonmember["token"]), timeout=20)
        assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text}"

    def test_leaderboard_owner_200(self, guide_tok, private_circle):
        r = requests.get(f"{BASE}/circles/{private_circle['id']}/leaderboard",
                         headers=_auth(guide_tok), timeout=20)
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)

    def test_leaderboard_nonexistent_circle_404(self, guide_tok):
        r = requests.get(f"{BASE}/circles/does-not-exist-xyz/leaderboard",
                         headers=_auth(guide_tok), timeout=20)
        assert r.status_code == 404, f"expected 404, got {r.status_code} {r.text}"


# ============================================================
# REGRESSION — public circle happy paths & prior fixes
# ============================================================
class TestRegressionPublicCircle:
    @pytest.fixture(scope="class")
    def pub_member(self, user_member, public_circle):
        # user_member already joined private_circle fixture; now join public too
        r = requests.post(f"{BASE}/circles/{public_circle['id']}/join",
                          headers=_auth(user_member["token"]), timeout=20)
        assert r.status_code == 200, r.text
        return user_member

    @pytest.fixture(scope="class")
    def pub_post(self, guide_tok, public_circle):
        r = requests.post(f"{BASE}/posts", json={
            "circle_id": public_circle["id"],
            "text": "iter10 pub post",
        }, headers=_auth(guide_tok), timeout=20)
        assert r.status_code == 200, r.text
        return r.json()

    def test_pub_member_create_event_200(self, pub_member, public_circle):
        r = requests.post(f"{BASE}/circles/{public_circle['id']}/events", json={
            "title": "pub member event",
            "description": "x",
            "starts_at": "2030-04-04T10:00:00Z",
        }, headers=_auth(pub_member["token"]), timeout=20)
        assert r.status_code == 200, r.text
        self.__class__._event_id = r.json()["id"]

    def test_pub_member_rsvp_200(self, pub_member):
        r = requests.post(f"{BASE}/events/{self.__class__._event_id}/rsvp",
                          headers=_auth(pub_member["token"]), timeout=20)
        assert r.status_code == 200, r.text

    def test_pub_member_like_200(self, pub_member, pub_post):
        r = requests.post(f"{BASE}/posts/{pub_post['id']}/like",
                          headers=_auth(pub_member["token"]), timeout=20)
        assert r.status_code == 200, r.text

    def test_pub_member_leaderboard_200(self, pub_member, public_circle):
        r = requests.get(f"{BASE}/circles/{public_circle['id']}/leaderboard",
                         headers=_auth(pub_member["token"]), timeout=20)
        assert r.status_code == 200, r.text

    def test_pub_leaderboard_nonmember_200(self, user_nonmember, public_circle):
        # Public circle is readable — leaderboard open to non-members
        r = requests.get(f"{BASE}/circles/{public_circle['id']}/leaderboard",
                         headers=_auth(user_nonmember["token"]), timeout=20)
        assert r.status_code == 200, r.text


class TestRegressionGlobalRoomsList:
    def test_list_global_rooms_200(self, user_nonmember):
        r = requests.get(f"{BASE}/rooms", headers=_auth(user_nonmember["token"]), timeout=20)
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)


class TestRegressionGuideSeedRooms:
    """Guide can create+join+message a global seed-style room."""
    def test_guide_create_global_room_flow(self, guide_tok):
        r = requests.post(f"{BASE}/rooms", json={"title": f"TEST guide global {_tag()}"},
                          headers=_auth(guide_tok), timeout=20)
        assert r.status_code == 200, r.text
        rid = r.json()["id"]
        rj = requests.post(f"{BASE}/rooms/{rid}/join", headers=_auth(guide_tok), timeout=20)
        assert rj.status_code == 200, rj.text
        rm = requests.post(f"{BASE}/rooms/{rid}/messages", json={"text": "guide here"},
                           headers=_auth(guide_tok), timeout=20)
        assert rm.status_code == 200, rm.text


class TestRegressionPriorFixes:
    def test_nonmember_post_in_private_403(self, user_nonmember, private_circle):
        r = requests.post(f"{BASE}/posts", json={
            "circle_id": private_circle["id"],
            "text": "sneaky post",
        }, headers=_auth(user_nonmember["token"]), timeout=20)
        assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text}"

    def test_dm_idor_403(self, guide_tok, user_nonmember):
        """User A (guide) starts a direct conv with user_member. User_nonmember must not read."""
        # need a third user different from both participants
        third = _register("thirdX")
        # guide creates direct conv with the third user
        r = requests.post(f"{BASE}/conversations/direct",
                          json={"user_id": third["user"]["id"]},
                          headers=_auth(guide_tok), timeout=20)
        assert r.status_code == 200, r.text
        conv_id = r.json()["id"]
        # user_nonmember (not in that conv) tries to read messages
        r2 = requests.get(f"{BASE}/conversations/{conv_id}/messages",
                          headers=_auth(user_nonmember["token"]), timeout=20)
        assert r2.status_code == 403, f"expected 403, got {r2.status_code} {r2.text}"

    def test_self_gift_400(self, guide_tok):
        # fetch /auth/me id
        me = requests.get(f"{BASE}/auth/me", headers=_auth(guide_tok), timeout=20).json()
        r = requests.post(f"{BASE}/gifts", json={
            "recipient_id": me["id"],
            "gift_type": "Flower",
        }, headers=_auth(guide_tok), timeout=20)
        assert r.status_code == 400, f"expected 400 self-gift, got {r.status_code} {r.text}"

    def test_under_13_register_403(self):
        email = f"TEST_minor_{_tag()}@circles.app"
        for _ in range(6):
            r = requests.post(f"{BASE}/auth/register", json={
                "email": email, "password": "pass1234", "name": "Minor",
                "date_of_birth": "2020-01-01", "accepted_terms": True,
            }, timeout=20)
            if r.status_code == 429:
                time.sleep(13)
                continue
            assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text}"
            return
        pytest.fail("register kept 429'ing")
