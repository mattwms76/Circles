"""Iter7: security hardening verification.

Covers:
- SEC-002 conversation IDOR fix (direct + circle convs)
- SEC-003 membership/ban/private circle gating
- SEC-004 wallet atomicity + buy bounds
- SEC-005 /api/files path traversal fix
- P3 Rate limiting on /auth/login and /auth/register
- P3 Email exposure (public_user vs private_user)
- P3 Input bounds (post/message/circle)
- Regression: feed, like, comment, discovery regex-escape, rooms, events,
  leaderboard, moderation queue, author_is_supporter, mute cap.

NOTE: rate-limit on /auth/login is 10/min from same IP. All happy-path
logins run FIRST (session fixture), 429 test runs LAST.
"""
import os
import re
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


def _register(name_prefix: str) -> dict:
    """Register a throwaway user, retrying on 429 rate limit."""
    email = f"TEST_{name_prefix}_{_tag()}@circles.app"
    pw = "pass1234"
    for attempt in range(8):
        r = requests.post(f"{BASE}/auth/register", json={
            "email": email, "password": pw, "name": f"TEST {name_prefix}"
        }, timeout=20)
        if r.status_code == 429:
            time.sleep(13)
            continue
        assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
        j = r.json()
        return {"token": j["access_token"], "user": j["user"], "email": email, "password": pw}
    pytest.fail(f"register kept 429'ing for {email}")


def _login(email: str, password: str) -> str:
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


# ------------------- Session fixtures (minimise auth hits) -----------------
@pytest.fixture(scope="session")
def guide_tok() -> str:
    return _login(GUIDE_EMAIL, GUIDE_PASS)


@pytest.fixture(scope="session")
def demo_tok() -> str:
    return _login(DEMO_EMAIL, DEMO_PASS)


@pytest.fixture(scope="session")
def user_a() -> dict:
    return _register("A")


@pytest.fixture(scope="session")
def user_b() -> dict:
    return _register("B")


@pytest.fixture(scope="session")
def user_c() -> dict:
    """Will become member then muted/removed in SEC-003."""
    return _register("C")


@pytest.fixture(scope="session")
def user_d() -> dict:
    """Member for SEC-003 remove/ban test."""
    return _register("D")


@pytest.fixture(scope="session")
def seed_circle_id(guide_tok) -> str:
    """Pick first public seed circle guide owns."""
    r = requests.get(f"{BASE}/circles", headers=_auth(guide_tok), timeout=20)
    assert r.status_code == 200
    circles = r.json()
    assert len(circles) > 0
    return circles[0]["id"]


# ===================== 1. Happy path smoke (first) =========================
class TestHappyPathFirst:
    """Run these first to burn login budget before 429 test."""

    def test_guide_login_ok(self, guide_tok):
        assert guide_tok
        r = requests.get(f"{BASE}/auth/me", headers=_auth(guide_tok), timeout=20)
        assert r.status_code == 200
        me = r.json()
        assert me["email"] == GUIDE_EMAIL  # self email MUST appear
        assert me.get("is_moderator") is True

    def test_demo_login_ok(self, demo_tok):
        r = requests.get(f"{BASE}/auth/me", headers=_auth(demo_tok), timeout=20)
        assert r.status_code == 200
        assert r.json()["email"] == DEMO_EMAIL

    def test_register_response_has_email(self, user_a):
        assert user_a["user"].get("email", "").lower() == user_a["email"].lower()
        assert user_a["user"]["coins"] == 100


# ========================= SEC-002 Conversation IDOR =======================
class TestSecConversationIDOR:
    def test_direct_conv_non_member_403(self, user_a, user_b, guide_tok):
        # A starts a direct conv with guide
        r = requests.post(f"{BASE}/conversations/direct",
                          headers=_auth(user_a["token"]),
                          json={"user_id": _me_id(guide_tok)}, timeout=20)
        assert r.status_code == 200, r.text
        conv_id = r.json()["id"]

        # A (member) can list messages
        r1 = requests.get(f"{BASE}/conversations/{conv_id}/messages",
                          headers=_auth(user_a["token"]), timeout=20)
        assert r1.status_code == 200

        # B (NOT a member) must get 403 on every endpoint
        hb = _auth(user_b["token"])
        assert requests.get(f"{BASE}/conversations/{conv_id}/messages", headers=hb, timeout=20).status_code == 403
        assert requests.post(f"{BASE}/conversations/{conv_id}/messages", headers=hb,
                             json={"text": "sneaky"}, timeout=20).status_code == 403
        assert requests.post(f"{BASE}/conversations/{conv_id}/read", headers=hb, timeout=20).status_code == 403
        assert requests.post(f"{BASE}/conversations/{conv_id}/typing", headers=hb, timeout=20).status_code == 403
        assert requests.get(f"{BASE}/conversations/{conv_id}/typing", headers=hb, timeout=20).status_code == 403

        # Legit member A should still work on all
        ha = _auth(user_a["token"])
        assert requests.get(f"{BASE}/conversations/{conv_id}/messages", headers=ha, timeout=20).status_code == 200
        assert requests.post(f"{BASE}/conversations/{conv_id}/messages", headers=ha,
                             json={"text": "hi"}, timeout=20).status_code == 200
        assert requests.post(f"{BASE}/conversations/{conv_id}/read", headers=ha, timeout=20).status_code == 200
        assert requests.post(f"{BASE}/conversations/{conv_id}/typing", headers=ha, timeout=20).status_code == 200
        assert requests.get(f"{BASE}/conversations/{conv_id}/typing", headers=ha, timeout=20).status_code == 200

    def test_circle_conv_non_member_403(self, guide_tok, user_b, seed_circle_id):
        # Guide lists convs to find circle-type conv for the seed circle
        r = requests.get(f"{BASE}/conversations", headers=_auth(guide_tok), timeout=20)
        assert r.status_code == 200
        circle_conv = next((c for c in r.json() if c["type"] == "circle" and c.get("circle_id") == seed_circle_id), None)
        assert circle_conv is not None, "guide should have circle-type conv auto-created"
        cid = circle_conv["id"]

        # Guide (member) works
        assert requests.get(f"{BASE}/conversations/{cid}/messages", headers=_auth(guide_tok), timeout=20).status_code == 200

        # B is NOT a member of that circle → 403
        hb = _auth(user_b["token"])
        assert requests.get(f"{BASE}/conversations/{cid}/messages", headers=hb, timeout=20).status_code == 403
        assert requests.post(f"{BASE}/conversations/{cid}/messages", headers=hb,
                             json={"text": "x"}, timeout=20).status_code == 403


def _me_id(tok: str) -> str:
    r = requests.get(f"{BASE}/auth/me", headers=_auth(tok), timeout=20)
    return r.json()["id"]


# ============== SEC-003 Membership / ban / mute / private ==================
class TestSecMembership:
    def test_nonmember_cannot_post_or_comment(self, user_b, guide_tok, seed_circle_id):
        hb = _auth(user_b["token"])
        # non-member post
        r = requests.post(f"{BASE}/posts", headers=hb,
                          json={"circle_id": seed_circle_id, "text": "intruder"}, timeout=20)
        assert r.status_code == 403, r.text

        # Pull a post for commenting
        posts = requests.get(f"{BASE}/circles/{seed_circle_id}/posts",
                             headers=_auth(guide_tok), timeout=20).json()
        assert posts
        pid = posts[0]["id"]
        r2 = requests.post(f"{BASE}/posts/{pid}/comments", headers=hb,
                           json={"text": "sneaky comment"}, timeout=20)
        assert r2.status_code == 403, r2.text

    def test_removed_member_banned_from_write(self, user_d, guide_tok, seed_circle_id):
        hd = _auth(user_d["token"])
        # D joins
        r = requests.post(f"{BASE}/circles/{seed_circle_id}/join", headers=hd, timeout=20)
        assert r.status_code == 200
        # Normal post works
        rok = requests.post(f"{BASE}/posts", headers=hd,
                            json={"circle_id": seed_circle_id, "text": "TEST member ok"}, timeout=20)
        assert rok.status_code == 200
        # Guide removes
        uid = user_d["user"]["id"]
        rm = requests.post(f"{BASE}/circles/{seed_circle_id}/members/{uid}/remove",
                           headers=_auth(guide_tok), json={"minutes": 60}, timeout=20)
        assert rm.status_code == 200
        # Now D cannot post (banned, even without membership)
        rp = requests.post(f"{BASE}/posts", headers=hd,
                           json={"circle_id": seed_circle_id, "text": "I'm back"}, timeout=20)
        assert rp.status_code == 403

        # Comment too
        posts = requests.get(f"{BASE}/circles/{seed_circle_id}/posts",
                             headers=_auth(guide_tok), timeout=20).json()
        pid = posts[0]["id"]
        rc = requests.post(f"{BASE}/posts/{pid}/comments", headers=hd,
                           json={"text": "ghost"}, timeout=20)
        assert rc.status_code == 403

    def test_muted_member_blocked(self, user_c, guide_tok, seed_circle_id):
        hc = _auth(user_c["token"])
        # Join first
        requests.post(f"{BASE}/circles/{seed_circle_id}/join", headers=hc, timeout=20)
        # Mute
        uid = user_c["user"]["id"]
        rmute = requests.post(f"{BASE}/circles/{seed_circle_id}/members/{uid}/mute",
                              headers=_auth(guide_tok), json={"minutes": 60}, timeout=20)
        assert rmute.status_code == 200
        rp = requests.post(f"{BASE}/posts", headers=hc,
                           json={"circle_id": seed_circle_id, "text": "muzzled"}, timeout=20)
        assert rp.status_code == 403
        # Unmute → should post again
        rum = requests.post(f"{BASE}/circles/{seed_circle_id}/members/{uid}/unmute",
                            headers=_auth(guide_tok), timeout=20)
        assert rum.status_code == 200
        rok = requests.post(f"{BASE}/posts", headers=hc,
                            json={"circle_id": seed_circle_id, "text": "TEST unmuted"}, timeout=20)
        assert rok.status_code == 200

    def test_private_circle_gated(self, guide_tok, user_b):
        # Create private circle as guide
        r = requests.post(f"{BASE}/circles", headers=_auth(guide_tok), json={
            "name": f"TEST Private {_tag()}", "description": "secret", "category": "General",
            "is_private": True
        }, timeout=20)
        assert r.status_code == 200
        priv = r.json()
        cid = priv["id"]
        assert priv["is_private"] is True

        # Create a post inside as owner
        rp = requests.post(f"{BASE}/posts", headers=_auth(guide_tok),
                           json={"circle_id": cid, "text": "TEST secret post"}, timeout=20)
        assert rp.status_code == 200
        pid = rp.json()["id"]

        # Non-member B gets 403 on all reads
        hb = _auth(user_b["token"])
        for url in [
            f"{BASE}/circles/{cid}",
            f"{BASE}/circles/{cid}/posts",
            f"{BASE}/circles/{cid}/members",
            f"{BASE}/circles/{cid}/events",
            f"{BASE}/posts/{pid}/comments",
        ]:
            resp = requests.get(url, headers=hb, timeout=20)
            assert resp.status_code == 403, f"{url} -> {resp.status_code}"

        # Owner gets 200
        hg = _auth(guide_tok)
        for url in [
            f"{BASE}/circles/{cid}",
            f"{BASE}/circles/{cid}/posts",
            f"{BASE}/circles/{cid}/members",
            f"{BASE}/circles/{cid}/events",
            f"{BASE}/posts/{pid}/comments",
        ]:
            assert requests.get(url, headers=hg, timeout=20).status_code == 200

        # Discovery (mine=false): B must NOT see this private circle
        rb = requests.get(f"{BASE}/circles", headers=hb, timeout=20).json()
        assert cid not in [c["id"] for c in rb], "private circle leaked in discovery"
        # Guide (owner) sees it in mine=true
        rg = requests.get(f"{BASE}/circles?mine=true", headers=hg, timeout=20).json()
        assert cid in [c["id"] for c in rg]


# ===================== SEC-004 Wallet atomicity ============================
class TestSecWalletAtomicity:
    def test_atomic_debit_no_negative(self, guide_tok):
        # Register a dedicated throwaway
        u = _register("WAL")
        tok = u["token"]
        h = _auth(tok)
        # New user has 100 coins. Drain to 25 by sending 3 Flowers (25 each = 75) → leaves 25
        # Need a recipient: use guide
        gid = _me_id(guide_tok)
        for _ in range(3):
            r = requests.post(f"{BASE}/gifts", headers=h,
                              json={"recipient_id": gid, "gift_type": "Flower"}, timeout=20)
            assert r.status_code == 200
        bal = requests.get(f"{BASE}/wallet", headers=h, timeout=20).json()["balance"]
        assert bal == 25, bal

        # Fire 2 Flower gifts rapidly (not truly concurrent in requests, but
        # tests the conditional update_one guard). The second MUST 400.
        results = []
        for _ in range(2):
            r = requests.post(f"{BASE}/gifts", headers=h,
                              json={"recipient_id": gid, "gift_type": "Flower"}, timeout=20)
            results.append(r.status_code)
        assert 200 in results, results
        assert 400 in results, results

        final_bal = requests.get(f"{BASE}/wallet", headers=h, timeout=20).json()["balance"]
        assert final_bal >= 0, f"balance went negative: {final_bal}"
        assert final_bal == 0, f"expected 0 after one 25-coin debit from 25, got {final_bal}"

    def test_self_gift_blocked(self, user_a):
        aid = user_a["user"]["id"]
        r = requests.post(f"{BASE}/gifts", headers=_auth(user_a["token"]),
                          json={"recipient_id": aid, "gift_type": "Heart"}, timeout=20)
        assert r.status_code == 400

    def test_buy_bounds(self, user_a):
        h = _auth(user_a["token"])
        # amount > 100000
        r1 = requests.post(f"{BASE}/wallet/buy", headers=h, json={"amount": 100001}, timeout=20)
        assert r1.status_code == 400
        # amount <= 0
        r2 = requests.post(f"{BASE}/wallet/buy", headers=h, json={"amount": 0}, timeout=20)
        assert r2.status_code == 400
        r3 = requests.post(f"{BASE}/wallet/buy", headers=h, json={"amount": -5}, timeout=20)
        assert r3.status_code == 400
        # Valid still credits
        before = requests.get(f"{BASE}/wallet", headers=h, timeout=20).json()["balance"]
        r4 = requests.post(f"{BASE}/wallet/buy", headers=h, json={"amount": 50}, timeout=20)
        assert r4.status_code == 200
        after = requests.get(f"{BASE}/wallet", headers=h, timeout=20).json()["balance"]
        assert after == before + 50

    def test_normal_gift_debits_and_credits(self, guide_tok):
        # Buyer: fresh user
        u = _register("GFT")
        tok = u["token"]
        gid = _me_id(guide_tok)
        before_sender = requests.get(f"{BASE}/wallet", headers=_auth(tok), timeout=20).json()["balance"]
        # Need a post to attribute to for gift_count increment check
        # Find any seed post
        feed = requests.get(f"{BASE}/feed", headers=_auth(guide_tok), timeout=20).json()
        assert feed
        post = feed[0]
        gift_before = post["gift_count"]
        r = requests.post(f"{BASE}/gifts", headers=_auth(tok),
                          json={"recipient_id": gid, "gift_type": "Heart", "post_id": post["id"]}, timeout=20)
        assert r.status_code == 200
        after_sender = requests.get(f"{BASE}/wallet", headers=_auth(tok), timeout=20).json()["balance"]
        assert after_sender == before_sender - 10
        # Verify post gift_count ticked (re-fetch feed)
        feed2 = requests.get(f"{BASE}/feed", headers=_auth(guide_tok), timeout=20).json()
        same = next((p for p in feed2 if p["id"] == post["id"]), None)
        assert same is not None
        assert same["gift_count"] == gift_before + 1


# =================== SEC-005 File path traversal ===========================
class TestSecFiles:
    def test_traversal_blocked(self, guide_tok):
        # No auth required on serve_file endpoint
        r = requests.get(f"{BASE}/files/../something", timeout=20, allow_redirects=False)
        assert r.status_code == 404
        r2 = requests.get(f"{BASE}/files/etc/passwd", timeout=20, allow_redirects=False)
        assert r2.status_code == 404
        r3 = requests.get(f"{BASE}/files/notcircles/x.jpg", timeout=20, allow_redirects=False)
        assert r3.status_code == 404

    def test_upload_and_serve(self, guide_tok):
        # Upload a tiny PNG
        import io
        png = (b"\x89PNG\r\n\x1a\n" + b"\x00" * 50)
        files = {"file": ("test.png", io.BytesIO(png), "image/png")}
        r = requests.post(f"{BASE}/upload", headers=_auth(guide_tok), files=files, timeout=60)
        # Storage may be flaky in preview; skip gracefully if 502
        if r.status_code == 502:
            pytest.skip("object storage unavailable in preview")
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["url"].startswith("/api/files/circles/")
        path = j["path"]
        # Fetch it
        rget = requests.get(f"{BASE}/files/{path}", timeout=30)
        assert rget.status_code == 200
        assert rget.headers.get("Content-Type", "").startswith("image/")


# =================== P3 Email exposure =====================================
class TestEmailExposure:
    def test_get_user_hides_email(self, user_a, guide_tok):
        aid = user_a["user"]["id"]
        r = requests.get(f"{BASE}/users/{aid}", headers=_auth(guide_tok), timeout=20)
        assert r.status_code == 200
        assert "email" not in r.json(), r.json()

    def test_circle_members_hides_email(self, guide_tok, seed_circle_id):
        r = requests.get(f"{BASE}/circles/{seed_circle_id}/members",
                         headers=_auth(guide_tok), timeout=20)
        assert r.status_code == 200
        for m in r.json():
            assert "email" not in m, m

    def test_auth_me_shows_own_email(self, guide_tok):
        r = requests.get(f"{BASE}/auth/me", headers=_auth(guide_tok), timeout=20)
        assert r.json().get("email") == GUIDE_EMAIL


# =================== P3 Input bounds =======================================
class TestInputBounds:
    def test_post_text_too_long(self, guide_tok, seed_circle_id):
        long = "x" * 5001
        r = requests.post(f"{BASE}/posts", headers=_auth(guide_tok),
                          json={"circle_id": seed_circle_id, "text": long}, timeout=20)
        assert r.status_code == 422, r.text

    def test_message_text_too_long(self, guide_tok, seed_circle_id):
        # Find circle conv for guide
        convs = requests.get(f"{BASE}/conversations", headers=_auth(guide_tok), timeout=20).json()
        cc = next(c for c in convs if c["type"] == "circle" and c.get("circle_id") == seed_circle_id)
        long = "x" * 2001
        r = requests.post(f"{BASE}/conversations/{cc['id']}/messages",
                          headers=_auth(guide_tok), json={"text": long}, timeout=20)
        assert r.status_code == 422

    def test_create_circle_empty_name(self, guide_tok):
        r = requests.post(f"{BASE}/circles", headers=_auth(guide_tok),
                          json={"name": "", "category": "General"}, timeout=20)
        assert r.status_code == 422


# =================== Regression ============================================
class TestRegression:
    def test_feed_and_supporter_flag(self, guide_tok):
        r = requests.get(f"{BASE}/feed", headers=_auth(guide_tok), timeout=20)
        assert r.status_code == 200
        feed = r.json()
        assert feed
        for p in feed[:3]:
            assert isinstance(p["author_is_supporter"], bool)

    def test_create_post_like_comment_chain(self, guide_tok, seed_circle_id):
        rp = requests.post(f"{BASE}/posts", headers=_auth(guide_tok),
                           json={"circle_id": seed_circle_id, "text": "TEST iter7 chain"}, timeout=20)
        assert rp.status_code == 200
        pid = rp.json()["id"]
        assert isinstance(rp.json()["author_is_supporter"], bool)
        rl = requests.post(f"{BASE}/posts/{pid}/like", headers=_auth(guide_tok), timeout=20)
        assert rl.status_code == 200 and rl.json()["liked"] is True
        rc = requests.post(f"{BASE}/posts/{pid}/comments", headers=_auth(guide_tok),
                           json={"text": "TEST comment"}, timeout=20)
        assert rc.status_code == 200
        assert isinstance(rc.json()["author_is_supporter"], bool)

    def test_search_special_chars_safe(self, guide_tok):
        # Regex special char '(' MUST NOT 500
        r = requests.get(f"{BASE}/circles", headers=_auth(guide_tok),
                         params={"search": "("}, timeout=20)
        assert r.status_code == 200
        r2 = requests.get(f"{BASE}/circles", headers=_auth(guide_tok),
                          params={"search": "[.*"}, timeout=20)
        assert r2.status_code == 200

    def test_rooms_list_and_join(self, guide_tok):
        r = requests.get(f"{BASE}/rooms", headers=_auth(guide_tok), timeout=20)
        assert r.status_code == 200
        # Create a quick room and join
        cr = requests.post(f"{BASE}/rooms", headers=_auth(guide_tok),
                          json={"title": f"TEST room {_tag()}"}, timeout=20)
        assert cr.status_code == 200
        rid = cr.json()["id"]
        # host is auto-joined; call join again (idempotent)
        jr = requests.post(f"{BASE}/rooms/{rid}/join", headers=_auth(guide_tok), timeout=20)
        assert jr.status_code == 200

    def test_events_upcoming_and_rsvp(self, guide_tok, seed_circle_id):
        from datetime import datetime, timezone, timedelta
        future = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
        ce = requests.post(f"{BASE}/circles/{seed_circle_id}/events",
                           headers=_auth(guide_tok),
                           json={"title": f"TEST ev {_tag()}", "starts_at": future}, timeout=20)
        assert ce.status_code == 200
        eid = ce.json()["id"]
        up = requests.get(f"{BASE}/events/upcoming", headers=_auth(guide_tok), timeout=20)
        assert up.status_code == 200
        assert eid in [e["id"] for e in up.json()]
        rsv = requests.post(f"{BASE}/events/{eid}/rsvp", headers=_auth(guide_tok), timeout=20)
        assert rsv.status_code == 200

    def test_leaderboard(self, guide_tok, seed_circle_id):
        r = requests.get(f"{BASE}/circles/{seed_circle_id}/leaderboard",
                         headers=_auth(guide_tok), timeout=20)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_moderation_queue(self, guide_tok):
        r = requests.get(f"{BASE}/moderation/reports",
                         headers=_auth(guide_tok), timeout=20)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_mute_cap_still_enforced(self, guide_tok, seed_circle_id):
        # Have a throwaway join and get muted with absurd minutes
        u = _register("MC")
        requests.post(f"{BASE}/circles/{seed_circle_id}/join",
                      headers=_auth(u["token"]), timeout=20)
        uid = u["user"]["id"]
        r = requests.post(f"{BASE}/circles/{seed_circle_id}/members/{uid}/mute",
                          headers=_auth(guide_tok), json={"minutes": 999999}, timeout=20)
        assert r.status_code == 200
        from datetime import datetime, timezone, timedelta
        mu = r.json()["muted_until"]
        parsed = datetime.fromisoformat(mu.replace("Z", "+00:00"))
        delta = parsed - datetime.now(timezone.utc)
        assert delta <= timedelta(days=7, seconds=60), f"mute not capped at 7d: {delta}"


# =================== Rate limit (RUN LAST) =================================
class TestRateLimit:
    """Must be the last test class — exhausts login budget."""

    def test_login_rate_limit_429(self):
        # Fire many bad logins rapidly from same IP (slowapi memory counter,
        # per-process; k8s ingress may vary source IP so push harder).
        got_429 = False
        for i in range(30):
            r = requests.post(f"{BASE}/auth/login",
                              json={"email": f"nobody_{i}@x.com", "password": "wrong"}, timeout=10)
            if r.status_code == 429:
                got_429 = True
                break
        assert got_429, "login did not rate-limit at 10/min"

    def test_register_rate_limit_429(self):
        got_429 = False
        for i in range(8):
            r = requests.post(f"{BASE}/auth/register", json={
                "email": f"TEST_rl_{_tag()}_{i}@circles.app",
                "password": "pass1234",
                "name": "TEST RL"
            }, timeout=10)
            if r.status_code == 429:
                got_429 = True
                break
        assert got_429, "register did not rate-limit at 5/min"
