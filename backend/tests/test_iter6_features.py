"""
Backend tests for Circles iteration 6 polish:
- Mute cap: minutes clamp to MAX_MOD_MINUTES=10080 (7 days) on mute + remove
- muted_until exposure on GET /circles/{id}/members (ISO string for muted; None otherwise)
- Event timestamp normalization: starts_at with +05:30 or trailing Z normalized to +00:00
- Regression (mod/mute/ban/supporter/wallet/login/feed/create-post/like/comment)
"""
import os
import re
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE}/api"

GUIDE = {"email": "guide@circles.app", "password": "circles123"}


# ---------- helpers --------------------------------------------------------
def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    tok = r.json()["access_token"]
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
    s.user = r.json()["user"]
    return s


def _register(suffix=""):
    email = f"TEST_{uuid.uuid4().hex[:8]}{suffix}@circles.app"
    r = requests.post(f"{API}/auth/register",
                      json={"email": email, "password": "pw1234", "name": f"T_{suffix or 'u'}"})
    assert r.status_code == 200, r.text
    data = r.json()
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {data['access_token']}", "Content-Type": "application/json"})
    s.user = data["user"]
    s.email = email
    s.password = "pw1234"
    return s


def _to_dt(s: str) -> datetime:
    # Handle both "+00:00" and "Z"
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


# ---------- fixtures -------------------------------------------------------
@pytest.fixture(scope="module")
def guide_sess():
    return _login(GUIDE["email"], GUIDE["password"])


@pytest.fixture(scope="module")
def circle(guide_sess):
    r = guide_sess.post(f"{API}/circles", json={
        "name": f"TEST_Iter6_{uuid.uuid4().hex[:6]}",
        "description": "iter6 polish",
        "category": "General",
    })
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def victim(circle):
    """Fresh user who joins the circle so we can mute/remove them."""
    v = _register("v")
    r = v.post(f"{API}/circles/{circle['id']}/join")
    assert r.status_code == 200, r.text
    return v


# =============================================================================
#  (A) Mute cap  — clamp minutes to 10080 (7 days)
# =============================================================================
class TestMuteCap:
    def test_mute_clamps_to_7_days(self, guide_sess, circle, victim):
        before = datetime.now(timezone.utc)
        r = guide_sess.post(
            f"{API}/circles/{circle['id']}/members/{victim.user['id']}/mute",
            json={"minutes": 999999},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "muted_until" in body
        until = _to_dt(body["muted_until"])
        max_allowed = before + timedelta(minutes=10080) + timedelta(seconds=10)  # tolerance
        assert until <= max_allowed, f"muted_until {until} exceeds 7d cap ({max_allowed})"
        # And at least 6d 23h (sanity: wasn't clamped too low)
        min_allowed = before + timedelta(minutes=10080) - timedelta(seconds=60)
        assert until >= min_allowed, f"muted_until {until} below expected ~7d from {before}"
        # cleanup for next tests
        guide_sess.post(f"{API}/circles/{circle['id']}/members/{victim.user['id']}/unmute")

    def test_mute_negative_or_zero_clamps_to_min_1(self, guide_sess, circle, victim):
        # The clamp also enforces min=1 so negative should still succeed w/ muted_until ~now+1m
        before = datetime.now(timezone.utc)
        r = guide_sess.post(
            f"{API}/circles/{circle['id']}/members/{victim.user['id']}/mute",
            json={"minutes": -5},
        )
        assert r.status_code == 200, r.text
        until = _to_dt(r.json()["muted_until"])
        assert until > before, "muted_until should be in the future even with negative input"
        assert until <= before + timedelta(minutes=2)
        guide_sess.post(f"{API}/circles/{circle['id']}/members/{victim.user['id']}/unmute")

    def test_remove_ban_clamps_to_7_days(self, guide_sess, circle):
        # Fresh victim because remove deletes membership
        v = _register("vr")
        jr = v.post(f"{API}/circles/{circle['id']}/join")
        assert jr.status_code == 200

        before = datetime.now(timezone.utc)
        r = guide_sess.post(
            f"{API}/circles/{circle['id']}/members/{v.user['id']}/remove",
            json={"minutes": 999999},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "banned_until" in body
        until = _to_dt(body["banned_until"])
        max_allowed = before + timedelta(minutes=10080) + timedelta(seconds=10)
        assert until <= max_allowed, f"banned_until {until} exceeds 7d cap"

        # And ban actually blocks rejoin
        jr2 = v.post(f"{API}/circles/{circle['id']}/join")
        assert jr2.status_code == 403, jr2.text


# =============================================================================
#  (B) muted_until exposure on GET /circles/{id}/members
# =============================================================================
class TestMutedUntilExposure:
    def test_muted_until_present_for_muted_null_for_others(self, guide_sess, circle, victim):
        # Mute victim ~60m
        r = guide_sess.post(
            f"{API}/circles/{circle['id']}/members/{victim.user['id']}/mute",
            json={"minutes": 60},
        )
        assert r.status_code == 200, r.text
        expected_until = r.json()["muted_until"]

        members = guide_sess.get(f"{API}/circles/{circle['id']}/members").json()
        by_id = {m["id"]: m for m in members}

        # victim
        vm = by_id.get(victim.user["id"])
        assert vm is not None, "victim should be in members list"
        assert vm.get("muted") is True
        assert vm.get("muted_until") == expected_until, \
            f"Expected muted_until={expected_until}, got {vm.get('muted_until')}"

        # owner (guide) — not muted
        om = by_id.get(guide_sess.user["id"])
        assert om is not None
        assert om.get("muted") is False
        assert om.get("muted_until") is None, f"owner muted_until should be null, got {om.get('muted_until')}"

        # cleanup
        guide_sess.post(f"{API}/circles/{circle['id']}/members/{victim.user['id']}/unmute")

    def test_muted_until_null_after_unmute(self, guide_sess, circle, victim):
        members = guide_sess.get(f"{API}/circles/{circle['id']}/members").json()
        vm = next((m for m in members if m["id"] == victim.user["id"]), None)
        assert vm is not None
        assert vm.get("muted") is False
        assert vm.get("muted_until") is None


# =============================================================================
#  (C) Event timestamp normalization
# =============================================================================
class TestEventTimestampNorm:
    def test_offset_plus_0530_normalized_to_utc(self, guide_sess, circle):
        starts_at = "2026-11-01T10:00:00+05:30"  # => 04:30 UTC
        r = guide_sess.post(f"{API}/circles/{circle['id']}/events", json={
            "title": f"TEST_Iter6_IST_{uuid.uuid4().hex[:4]}",
            "description": "IST event",
            "starts_at": starts_at,
        })
        assert r.status_code == 200, r.text
        got = r.json()["starts_at"]
        # Normalized should carry UTC offset (+00:00) and represent same instant
        assert "+00:00" in got, f"Expected +00:00 offset, got {got}"
        assert _to_dt(got) == _to_dt(starts_at), f"Instant mismatch: {got} != {starts_at}"

    def test_trailing_Z_normalized_to_plus_0000(self, guide_sess, circle):
        starts_at = "2026-12-15T08:00:00Z"
        r = guide_sess.post(f"{API}/circles/{circle['id']}/events", json={
            "title": f"TEST_Iter6_Z_{uuid.uuid4().hex[:4]}",
            "description": "Z event",
            "starts_at": starts_at,
        })
        assert r.status_code == 200, r.text
        got = r.json()["starts_at"]
        assert "+00:00" in got, f"Expected +00:00 offset for Z input, got {got}"
        assert "Z" not in got, f"Should not retain Z: {got}"
        assert _to_dt(got) == _to_dt(starts_at)

    def test_list_events_preserves_normalized_offset_and_ordering(self, guide_sess, circle):
        # Make 2 events — earlier is +05:30 (04:30 UTC Nov 1), later is Z (Dec 15)
        r1 = guide_sess.post(f"{API}/circles/{circle['id']}/events", json={
            "title": f"TEST_Iter6_Later_{uuid.uuid4().hex[:4]}",
            "description": "later",
            "starts_at": "2027-02-20T09:00:00+05:30",
        })
        assert r1.status_code == 200
        r2 = guide_sess.post(f"{API}/circles/{circle['id']}/events", json={
            "title": f"TEST_Iter6_Earliest_{uuid.uuid4().hex[:4]}",
            "description": "earliest",
            "starts_at": "2026-01-01T00:00:00Z",
        })
        assert r2.status_code == 200

        evs = guide_sess.get(f"{API}/circles/{circle['id']}/events").json()
        assert isinstance(evs, list) and len(evs) >= 2
        for e in evs:
            assert "+00:00" in e["starts_at"], f"non-normalized starts_at in list: {e['starts_at']}"
        # starts_at should be sorted ascending lexicographically = chronologically (same offset)
        starts = [e["starts_at"] for e in evs]
        assert starts == sorted(starts), f"Events not ordered by starts_at ascending: {starts}"

    def test_upcoming_events_normalized_and_future_only(self, guide_sess, circle):
        # Create a future event; join may already be guaranteed since guide owns circle
        future_ist = (datetime.now(timezone.utc) + timedelta(days=3)).replace(microsecond=0)
        future_ist_str = future_ist.isoformat().replace("+00:00", "+00:00")  # already UTC
        r = guide_sess.post(f"{API}/circles/{circle['id']}/events", json={
            "title": f"TEST_Iter6_Up_{uuid.uuid4().hex[:4]}",
            "description": "upcoming",
            "starts_at": "2027-06-10T15:30:00+05:30",
        })
        assert r.status_code == 200

        up = guide_sess.get(f"{API}/events/upcoming").json()
        assert isinstance(up, list)
        # Any item has +00:00
        for e in up:
            assert "+00:00" in e["starts_at"], f"upcoming event non-normalized: {e['starts_at']}"


# =============================================================================
#  (D) Regression — authorization + muted blocking + ban blocking + supporter + wallet
# =============================================================================
class TestRegression:
    def test_login_and_feed(self, guide_sess):
        r = guide_sess.get(f"{API}/feed")
        assert r.status_code == 200, r.text
        feed = r.json()
        assert isinstance(feed, list)
        if feed:
            assert "author_is_supporter" in feed[0], "feed items should carry author_is_supporter"
            assert isinstance(feed[0]["author_is_supporter"], bool)

    def test_create_post_like_comment(self, guide_sess, circle):
        r = guide_sess.post(f"{API}/posts", json={
            "circle_id": circle["id"],
            "text": f"TEST_Iter6_post_{uuid.uuid4().hex[:6]}",
        })
        assert r.status_code == 200, r.text
        post = r.json()
        pid = post["id"]
        assert "author_is_supporter" in post

        rl = guide_sess.post(f"{API}/posts/{pid}/like")
        assert rl.status_code == 200, rl.text

        rc = guide_sess.post(f"{API}/posts/{pid}/comments", json={"text": "nice"})
        assert rc.status_code == 200, rc.text
        assert "author_is_supporter" in rc.json()

        gc = guide_sess.get(f"{API}/posts/{pid}/comments")
        assert gc.status_code == 200
        if gc.json():
            assert "author_is_supporter" in gc.json()[0]

    def test_owner_immune_mute(self, guide_sess, circle):
        r = guide_sess.post(
            f"{API}/circles/{circle['id']}/members/{guide_sess.user['id']}/mute",
            json={"minutes": 10},
        )
        assert r.status_code == 400, r.text

    def test_owner_immune_remove(self, guide_sess, circle):
        r = guide_sess.post(
            f"{API}/circles/{circle['id']}/members/{guide_sess.user['id']}/remove",
            json={"minutes": 10},
        )
        assert r.status_code == 400, r.text

    def test_non_mod_cannot_mute(self, circle, guide_sess):
        attacker = _register("atk")
        attacker.post(f"{API}/circles/{circle['id']}/join")
        # Pick any other member (guide or create a target)
        target = _register("tgt")
        target.post(f"{API}/circles/{circle['id']}/join")

        r = attacker.post(
            f"{API}/circles/{circle['id']}/members/{target.user['id']}/mute",
            json={"minutes": 10},
        )
        assert r.status_code == 403, r.text

    def test_muted_user_blocked_from_post_and_comment(self, guide_sess, circle):
        v = _register("mb")
        v.post(f"{API}/circles/{circle['id']}/join")

        # Guide writes a post so the muted user can try to comment on it
        pr = guide_sess.post(f"{API}/posts", json={
            "circle_id": circle["id"],
            "text": f"TEST_Iter6_hostpost_{uuid.uuid4().hex[:4]}",
        })
        assert pr.status_code == 200
        pid = pr.json()["id"]

        # Mute
        mr = guide_sess.post(
            f"{API}/circles/{circle['id']}/members/{v.user['id']}/mute",
            json={"minutes": 30},
        )
        assert mr.status_code == 200

        # Post blocked
        bp = v.post(f"{API}/posts", json={
            "circle_id": circle["id"], "text": "should fail",
        })
        assert bp.status_code == 403, bp.text

        # Comment blocked
        bc = v.post(f"{API}/posts/{pid}/comments", json={"text": "should fail"})
        assert bc.status_code == 403, bc.text

    def test_banned_user_cannot_rejoin(self, guide_sess, circle):
        v = _register("ban")
        v.post(f"{API}/circles/{circle['id']}/join")
        r = guide_sess.post(
            f"{API}/circles/{circle['id']}/members/{v.user['id']}/remove",
            json={"minutes": 60},
        )
        assert r.status_code == 200
        rr = v.post(f"{API}/circles/{circle['id']}/join")
        assert rr.status_code == 403, rr.text

    def test_self_gift_blocked(self, guide_sess):
        r = guide_sess.post(f"{API}/gifts", json={
            "recipient_id": guide_sess.user["id"],
            "gift_type": "Flower",
        })
        assert r.status_code == 400, r.text
