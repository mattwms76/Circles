"""
Backend tests for Circles iteration 3 features:
- Circle Roles (PUT /api/circles/{id}, POST /api/circles/{id}/members/{uid}/role)
- Gift On Posts (POST /api/gifts, gift_count on feed/circle posts)
- Event Reminders (GET /api/reminders, 24h horizon)
Also light regression on login, feed, create post, like, comments.
"""
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE}/api"

GUIDE = {"email": "guide@circles.app", "password": "circles123"}


def _register(suffix=""):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    email = f"TEST_{uuid.uuid4().hex[:8]}{suffix}@circles.app"
    r = s.post(f"{API}/auth/register", json={"email": email, "password": "pw1234", "name": f"T_{suffix or 'u'}"})
    assert r.status_code == 200, r.text
    data = r.json()
    s.headers.update({"Authorization": f"Bearer {data['access_token']}"})
    s.user = data["user"]
    return s


@pytest.fixture(scope="module")
def guide_sess():
    r = requests.post(f"{API}/auth/login", json=GUIDE)
    assert r.status_code == 200, r.text
    tok = r.json()["access_token"]
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
    s.user = r.json()["user"]
    return s


# -------------------- Regression --------------------
class TestRegression:
    def test_login_guide(self):
        r = requests.post(f"{API}/auth/login", json=GUIDE)
        assert r.status_code == 200
        assert "access_token" in r.json()

    def test_feed(self, guide_sess):
        r = guide_sess.get(f"{API}/feed")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_create_post_like_comment(self, guide_sess):
        # pick any circle owned by guide
        r = guide_sess.get(f"{API}/circles", params={"mine": True})
        assert r.status_code == 200
        circles = r.json()
        assert len(circles) > 0
        cid = circles[0]["id"]

        r = guide_sess.post(f"{API}/posts", json={"circle_id": cid, "text": f"TEST post {uuid.uuid4().hex[:6]}"})
        assert r.status_code == 200, r.text
        pid = r.json()["id"]

        # Like
        r = guide_sess.post(f"{API}/posts/{pid}/like")
        assert r.status_code == 200

        # Comment
        r = guide_sess.post(f"{API}/posts/{pid}/comments", json={"text": "TEST c1"})
        assert r.status_code == 200


# -------------------- Circle Roles --------------------
class TestCircleRoles:
    def _make_circle(self, sess):
        r = sess.post(f"{API}/circles", json={"name": f"TEST_Roles_{uuid.uuid4().hex[:6]}", "description": "d", "category": "General"})
        assert r.status_code == 200, r.text
        return r.json()

    def test_put_circle_owner_updates(self, guide_sess):
        c = self._make_circle(guide_sess)
        cid = c["id"]
        r = guide_sess.put(f"{API}/circles/{cid}", json={
            "welcome_message": "TEST welcome everyone",
            "name": "TEST_Renamed",
            "description": "TEST desc"
        })
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["welcome_message"] == "TEST welcome everyone"
        assert data["name"] == "TEST_Renamed"
        assert data["description"] == "TEST desc"

        # GET returns welcome_message + my_role=owner
        r = guide_sess.get(f"{API}/circles/{cid}")
        assert r.status_code == 200
        d = r.json()
        assert d["welcome_message"] == "TEST welcome everyone"
        assert d["my_role"] == "owner"

    def test_put_circle_non_owner_403(self, guide_sess):
        c = self._make_circle(guide_sess)
        cid = c["id"]
        u = _register("role_x")
        u.post(f"{API}/circles/{cid}/join")
        r = u.put(f"{API}/circles/{cid}", json={"welcome_message": "nope"})
        assert r.status_code == 403

    def test_role_toggle_moderator(self, guide_sess):
        c = self._make_circle(guide_sess)
        cid = c["id"]
        u = _register("rolemod")
        u.post(f"{API}/circles/{cid}/join")

        # Owner promotes to moderator
        r = guide_sess.post(f"{API}/circles/{cid}/members/{u.user['id']}/role", json={"role": "moderator"})
        assert r.status_code == 200, r.text
        assert r.json()["role"] == "moderator"

        # Member list should reflect new role
        r = guide_sess.get(f"{API}/circles/{cid}/members")
        assert r.status_code == 200
        target = next((m for m in r.json() if m["id"] == u.user["id"]), None)
        assert target is not None
        assert target["role"] == "moderator"

        # Toggle back to member
        r = guide_sess.post(f"{API}/circles/{cid}/members/{u.user['id']}/role", json={"role": "member"})
        assert r.status_code == 200
        assert r.json()["role"] == "member"

    def test_role_non_owner_403(self, guide_sess):
        c = self._make_circle(guide_sess)
        cid = c["id"]
        a = _register("rA")
        b = _register("rB")
        a.post(f"{API}/circles/{cid}/join")
        b.post(f"{API}/circles/{cid}/join")
        r = a.post(f"{API}/circles/{cid}/members/{b.user['id']}/role", json={"role": "moderator"})
        assert r.status_code == 403

    def test_role_owner_target_400(self, guide_sess):
        c = self._make_circle(guide_sess)
        cid = c["id"]
        r = guide_sess.post(f"{API}/circles/{cid}/members/{guide_sess.user['id']}/role", json={"role": "moderator"})
        assert r.status_code == 400

    def test_role_invalid_role_400(self, guide_sess):
        c = self._make_circle(guide_sess)
        cid = c["id"]
        u = _register("rinv")
        u.post(f"{API}/circles/{cid}/join")
        r = guide_sess.post(f"{API}/circles/{cid}/members/{u.user['id']}/role", json={"role": "admin"})
        assert r.status_code == 400

    def test_role_non_member_404(self, guide_sess):
        c = self._make_circle(guide_sess)
        cid = c["id"]
        u = _register("rnm")  # does NOT join
        r = guide_sess.post(f"{API}/circles/{cid}/members/{u.user['id']}/role", json={"role": "moderator"})
        assert r.status_code == 404


# -------------------- Gifts --------------------
class TestGifts:
    def test_send_gift_on_post_and_gift_count(self, guide_sess):
        # guide creates a post
        r = guide_sess.get(f"{API}/circles", params={"mine": True})
        cid = r.json()[0]["id"]
        r = guide_sess.post(f"{API}/posts", json={"circle_id": cid, "text": "TEST gift target"})
        pid = r.json()["id"]

        sender = _register("gift_s")
        # sender has 100 coins; Heart=10
        r = sender.post(f"{API}/gifts", json={
            "recipient_id": guide_sess.user["id"],
            "gift_type": "Heart",
            "post_id": pid
        })
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["gift_type"] == "Heart"
        assert body["balance"] == 90

        # recipient coins increased - check wallet
        wr = guide_sess.get(f"{API}/wallet")
        assert wr.status_code == 200
        # Just verify shape
        assert "balance" in wr.json()

        # feed should include gift_count on the post
        fr = sender.get(f"{API}/feed")
        assert fr.status_code == 200
        post = next((p for p in fr.json() if p["id"] == pid), None)
        assert post is not None, "sender should see post via membership? If not, check via circle posts endpoint"
        if post:
            assert "gift_count" in post
            assert post["gift_count"] >= 1

        # circle posts endpoint
        cp = guide_sess.get(f"{API}/circles/{cid}/posts")
        assert cp.status_code == 200
        p2 = next((p for p in cp.json() if p["id"] == pid), None)
        assert p2 is not None
        assert "gift_count" in p2
        assert p2["gift_count"] >= 1

    def test_send_gift_insufficient_coins_400(self, guide_sess):
        poor = _register("poor")
        # Rocket costs 300, user has 100
        r = poor.post(f"{API}/gifts", json={
            "recipient_id": guide_sess.user["id"],
            "gift_type": "Rocket"
        })
        assert r.status_code == 400

    def test_send_gift_unknown_type_400(self, guide_sess):
        u = _register("gift_bad")
        r = u.post(f"{API}/gifts", json={
            "recipient_id": guide_sess.user["id"],
            "gift_type": "WeirdThing"
        })
        assert r.status_code == 400

    def test_send_gift_in_room(self, guide_sess):
        # Find a live room
        r = guide_sess.get(f"{API}/rooms")
        rid = None
        for room in r.json():
            if room.get("status") == "live":
                rid = room["id"]
                host_id = room["host_id"]
                break
        if not rid:
            pytest.skip("No live room available")

        sender = _register("gift_room")
        sender.post(f"{API}/rooms/{rid}/join")
        r = sender.post(f"{API}/gifts", json={
            "recipient_id": host_id,
            "gift_type": "Heart",
            "room_id": rid
        })
        assert r.status_code == 200, r.text


# -------------------- Reminders --------------------
class TestReminders:
    def test_reminders_shape_empty(self):
        u = _register("rem_u")
        r = u.get(f"{API}/reminders")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_reminder_within_24h(self, guide_sess):
        # Create a circle
        r = guide_sess.post(f"{API}/circles", json={"name": f"TEST_Rem_{uuid.uuid4().hex[:6]}", "description": "d", "category": "General"})
        cid = r.json()["id"]

        # Create an event starting in 2 hours
        soon = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
        r = guide_sess.post(f"{API}/circles/{cid}/events", json={
            "title": f"TEST Soon {uuid.uuid4().hex[:4]}",
            "description": "soon",
            "starts_at": soon
        })
        assert r.status_code == 200, r.text
        eid = r.json()["id"]

        # Register a user, join circle, RSVP
        u = _register("rem_rsvp")
        u.post(f"{API}/circles/{cid}/join")
        r = u.post(f"{API}/events/{eid}/rsvp")
        assert r.status_code == 200
        assert r.json()["going"] is True

        # /reminders should contain this event with circle_name
        r = u.get(f"{API}/reminders")
        assert r.status_code == 200
        rems = r.json()
        hit = next((x for x in rems if x["id"] == eid), None)
        assert hit is not None, f"expected reminder for {eid}, got {rems}"
        assert hit["circle_id"] == cid
        assert hit["circle_name"]
        assert "title" in hit and "starts_at" in hit

    def test_reminder_outside_24h_excluded(self, guide_sess):
        r = guide_sess.post(f"{API}/circles", json={"name": f"TEST_RemFar_{uuid.uuid4().hex[:6]}", "description": "d", "category": "General"})
        cid = r.json()["id"]

        far = (datetime.now(timezone.utc) + timedelta(days=5)).isoformat()
        r = guide_sess.post(f"{API}/circles/{cid}/events", json={
            "title": f"TEST Far {uuid.uuid4().hex[:4]}",
            "description": "far",
            "starts_at": far
        })
        eid = r.json()["id"]

        u = _register("rem_far")
        u.post(f"{API}/circles/{cid}/join")
        u.post(f"{API}/events/{eid}/rsvp")

        r = u.get(f"{API}/reminders")
        assert r.status_code == 200
        assert not any(x["id"] == eid for x in r.json())
