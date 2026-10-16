"""
Backend tests for Circles iteration 2 features:
- Unread message badges
- Typing indicators
- Events scheduling + RSVP
- People tab (circle members) + direct chat
- Live Rooms raise_hand + co-host promote/demote
"""
import os
import uuid
import time
import pytest
import requests

BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://circles-demo-1.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"

GUIDE = {"email": "guide@circles.app", "password": "circles123"}


def _register(session, suffix=""):
    email = f"TEST_{uuid.uuid4().hex[:8]}{suffix}@circles.app"
    r = session.post(f"{API}/auth/register", json={"email": email, "password": "pw1234", "name": f"T_{suffix or 'u'}"})
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def guide_token():
    r = requests.post(f"{API}/auth/login", json=GUIDE)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture
def guide_sess(guide_token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {guide_token}", "Content-Type": "application/json"})
    return s


@pytest.fixture
def user_a():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    reg = _register(s, "a")
    s.headers.update({"Authorization": f"Bearer {reg['access_token']}"})
    s.user = reg["user"]
    return s


@pytest.fixture
def user_b():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    reg = _register(s, "b")
    s.headers.update({"Authorization": f"Bearer {reg['access_token']}"})
    s.user = reg["user"]
    return s


# -------------------- Health / regression --------------------
class TestRegression:
    def test_health(self):
        r = requests.get(f"{BASE}/health")
        assert r.status_code == 200

    def test_feed_loads(self, guide_sess):
        r = guide_sess.get(f"{API}/feed")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_login_guide(self):
        r = requests.post(f"{API}/auth/login", json=GUIDE)
        assert r.status_code == 200
        assert "access_token" in r.json()


# -------------------- Unread --------------------
class TestUnread:
    def test_unread_total_shape(self, user_a):
        r = user_a.get(f"{API}/conversations/unread/total")
        assert r.status_code == 200
        assert "total" in r.json()
        assert isinstance(r.json()["total"], int)

    def test_conversations_have_unread_field(self, user_a):
        r = user_a.get(f"{API}/conversations")
        assert r.status_code == 200
        for c in r.json():
            assert "unread" in c
            assert isinstance(c["unread"], int)

    def test_direct_unread_flow(self, user_a, user_b):
        # A starts direct with B
        r = user_a.post(f"{API}/conversations/direct", json={"user_id": user_b.user["id"]})
        assert r.status_code == 200
        conv_id = r.json()["id"]

        # A sends 2 messages to B
        for i in range(2):
            r = user_a.post(f"{API}/conversations/{conv_id}/messages", json={"text": f"TEST hi {i}"})
            assert r.status_code == 200, r.text

        # B lists convs — should see unread >= 2 for this conversation
        r = user_b.get(f"{API}/conversations")
        assert r.status_code == 200
        conv = next((c for c in r.json() if c["id"] == conv_id), None)
        assert conv is not None, "B should see the conversation"
        assert conv["unread"] >= 2, f"expected unread>=2, got {conv['unread']}"

        # B total unread also >= 2
        r = user_b.get(f"{API}/conversations/unread/total")
        assert r.status_code == 200
        assert r.json()["total"] >= 2

        # B opens messages — marks read
        r = user_b.get(f"{API}/conversations/{conv_id}/messages")
        assert r.status_code == 200

        r = user_b.get(f"{API}/conversations")
        conv = next((c for c in r.json() if c["id"] == conv_id), None)
        assert conv["unread"] == 0, f"expected 0 after read, got {conv['unread']}"

    def test_explicit_read_endpoint(self, user_a, user_b):
        r = user_a.post(f"{API}/conversations/direct", json={"user_id": user_b.user["id"]})
        conv_id = r.json()["id"]
        user_a.post(f"{API}/conversations/{conv_id}/messages", json={"text": "TEST ping"})

        r = user_b.post(f"{API}/conversations/{conv_id}/read")
        assert r.status_code == 200
        assert r.json().get("ok") is True

        r = user_b.get(f"{API}/conversations")
        conv = next((c for c in r.json() if c["id"] == conv_id), None)
        assert conv["unread"] == 0


# -------------------- Typing --------------------
class TestTyping:
    def test_typing_flow(self, user_a, user_b):
        r = user_a.post(f"{API}/conversations/direct", json={"user_id": user_b.user["id"]})
        conv_id = r.json()["id"]

        # A sets typing
        r = user_a.post(f"{API}/conversations/{conv_id}/typing")
        assert r.status_code == 200
        assert r.json().get("ok") is True

        # B queries typing — should see A's name
        r = user_b.get(f"{API}/conversations/{conv_id}/typing")
        assert r.status_code == 200
        names = r.json()["names"]
        assert any("T_" in n for n in names), f"expected A in names, got {names}"

        # A queries typing — should NOT see self
        r = user_a.get(f"{API}/conversations/{conv_id}/typing")
        assert r.json()["names"] == []

    def test_typing_ttl(self, user_a, user_b):
        r = user_a.post(f"{API}/conversations/direct", json={"user_id": user_b.user["id"]})
        conv_id = r.json()["id"]
        user_a.post(f"{API}/conversations/{conv_id}/typing")
        # Verify typing shows up
        assert len(user_b.get(f"{API}/conversations/{conv_id}/typing").json()["names"]) == 1
        # Wait >6s for TTL
        time.sleep(7)
        assert user_b.get(f"{API}/conversations/{conv_id}/typing").json()["names"] == []


# -------------------- Events + RSVP --------------------
class TestEvents:
    def _ensure_circle(self, sess):
        r = sess.post(f"{API}/circles", json={"name": f"TEST_Circle_{uuid.uuid4().hex[:6]}", "description": "d", "category": "General"})
        assert r.status_code == 200, r.text
        return r.json()["id"]

    def test_create_event_and_rsvp(self, guide_sess):
        cid = self._ensure_circle(guide_sess)
        starts = "2030-01-01T18:00:00+00:00"
        r = guide_sess.post(f"{API}/circles/{cid}/events", json={"title": "TEST Writing Night", "description": "Bring your pages", "starts_at": starts})
        assert r.status_code == 200, r.text
        ev = r.json()
        assert ev["title"] == "TEST Writing Night"
        assert ev["rsvp_count"] == 0
        assert ev["going"] is False
        assert ev["host_name"]

        # Listing enriched events
        r = guide_sess.get(f"{API}/circles/{cid}/events")
        assert r.status_code == 200
        events = r.json()
        assert any(e["id"] == ev["id"] for e in events)

        # Toggle RSVP going
        r = guide_sess.post(f"{API}/events/{ev['id']}/rsvp")
        assert r.status_code == 200
        assert r.json()["going"] is True
        assert r.json()["rsvp_count"] == 1

        # Toggle again -> not going
        r = guide_sess.post(f"{API}/events/{ev['id']}/rsvp")
        assert r.json()["going"] is False
        assert r.json()["rsvp_count"] == 0

    def test_rsvp_nonexistent_event(self, guide_sess):
        r = guide_sess.post(f"{API}/events/{uuid.uuid4()}/rsvp")
        assert r.status_code == 404


# -------------------- People tab (members) + direct chat --------------------
class TestPeople:
    def test_circle_members_endpoint(self, guide_sess, user_a):
        r = guide_sess.get(f"{API}/circles", params={"mine": True})
        circles = r.json()
        assert len(circles) > 0
        cid = circles[0]["id"]

        # user_a joins
        user_a.post(f"{API}/circles/{cid}/join")

        r = user_a.get(f"{API}/circles/{cid}/members")
        assert r.status_code == 200
        members = r.json()
        assert len(members) >= 2
        assert all("id" in m and "name" in m and "role" in m for m in members)

        # user_a opens direct chat with guide (first non-self member)
        other = next(m for m in members if m["id"] != user_a.user["id"])
        r = user_a.post(f"{API}/conversations/direct", json={"user_id": other["id"]})
        assert r.status_code == 200
        assert r.json()["type"] == "direct"

        # idempotent
        r2 = user_a.post(f"{API}/conversations/direct", json={"user_id": other["id"]})
        assert r2.json()["id"] == r.json()["id"]


# -------------------- Live Rooms raise_hand / promote / demote --------------------
class TestRoomSeats:
    def _get_live_room(self, sess):
        r = sess.get(f"{API}/rooms")
        for room in r.json():
            if room.get("status") == "live":
                return room["id"]
        return None

    def test_raise_hand_requires_join(self, user_a):
        rid = self._get_live_room(user_a)
        assert rid, "need a live room"
        r = user_a.post(f"{API}/rooms/{rid}/raise_hand")
        assert r.status_code == 404  # not joined yet

    def test_raise_hand_toggle(self, user_a):
        rid = self._get_live_room(user_a)
        user_a.post(f"{API}/rooms/{rid}/join")
        r = user_a.post(f"{API}/rooms/{rid}/raise_hand")
        assert r.status_code == 200
        assert r.json()["hand_raised"] is True
        r = user_a.post(f"{API}/rooms/{rid}/raise_hand")
        assert r.json()["hand_raised"] is False

    def test_room_detail_shape(self, user_a):
        rid = self._get_live_room(user_a)
        user_a.post(f"{API}/rooms/{rid}/join")
        r = user_a.get(f"{API}/rooms/{rid}")
        assert r.status_code == 200
        data = r.json()
        for key in ["my_role", "my_hand_raised", "cohost_count", "participants"]:
            assert key in data, f"missing {key}"
        # participants sorted host > cohost > listener
        roles = [p["role"] for p in data["participants"]]
        rank = {"host": 0, "cohost": 1, "listener": 2}
        assert roles == sorted(roles, key=lambda x: rank.get(x, 3))
        for p in data["participants"]:
            assert "role" in p and "hand_raised" in p

    def test_promote_demote_flow(self, guide_sess, user_a, user_b):
        rid = self._get_live_room(guide_sess)
        assert rid
        user_a.post(f"{API}/rooms/{rid}/join")
        user_b.post(f"{API}/rooms/{rid}/join")

        # Non-host cannot promote
        r = user_a.post(f"{API}/rooms/{rid}/participants/{user_b.user['id']}/promote")
        assert r.status_code == 403

        # Host promotes user_a
        r = guide_sess.post(f"{API}/rooms/{rid}/participants/{user_a.user['id']}/promote")
        assert r.status_code == 200, r.text
        assert r.json()["cohost_count"] >= 1

        # user_a now has cohost role
        detail = user_a.get(f"{API}/rooms/{rid}").json()
        assert detail["my_role"] == "cohost"

        # Demote
        r = guide_sess.post(f"{API}/rooms/{rid}/participants/{user_a.user['id']}/demote")
        assert r.status_code == 200
        detail = user_a.get(f"{API}/rooms/{rid}").json()
        assert detail["my_role"] == "listener"

    def test_cohost_cap(self, guide_sess):
        # Create a fresh room owned by guide
        r = guide_sess.post(f"{API}/rooms", json={"title": "TEST_cap_room"})
        rid = r.json()["id"]
        # Register 4 users, join them, promote 3 then expect 4th to fail
        users = []
        for i in range(4):
            s = requests.Session()
            s.headers.update({"Content-Type": "application/json"})
            reg = _register(s, f"cap{i}")
            s.headers.update({"Authorization": f"Bearer {reg['access_token']}"})
            s.post(f"{API}/rooms/{rid}/join")
            users.append(reg["user"])
        for u in users[:3]:
            r = guide_sess.post(f"{API}/rooms/{rid}/participants/{u['id']}/promote")
            assert r.status_code == 200
        r = guide_sess.post(f"{API}/rooms/{rid}/participants/{users[3]['id']}/promote")
        assert r.status_code == 400
        assert "seat" in r.json()["detail"].lower() or "full" in r.json()["detail"].lower()
