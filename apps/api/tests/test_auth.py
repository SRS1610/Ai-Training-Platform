from __future__ import annotations

import re

import pyotp
from sqlalchemy import select, text

from app.core.email import ConsoleEmailProvider
from app.core import security
from app.models.identity import User
from tests.factories import PASSWORD, signup, unique_email


def _last_token(email: str, path: str) -> str:
    for mail in reversed(ConsoleEmailProvider.outbox):
        if mail.to == email and path in mail.text:
            return re.search(r"token=([\w\-]+)", mail.text).group(1)
    raise AssertionError("email not found")


async def test_register_login_me(client):
    acct = await signup(client, org_name="Globex")
    me = (await client.get("/api/v1/me", headers=acct.headers)).json()
    assert me["organisation"]["name"] == "Globex"
    assert "organisation.manage" in me["permissions"]
    assert "system.manage" not in me["permissions"]
    r = await client.post("/api/v1/auth/login", json={"email": acct.email, "password": PASSWORD})
    assert r.status_code == 200 and r.json()["tokens"]["access_token"]


async def test_individual_signup_gets_personal_workspace(client):
    acct = await signup(client, org_name=None, full_name="Solo Learner")
    me = (await client.get("/api/v1/me", headers=acct.headers)).json()
    assert me["organisation"]["kind"] == "personal"
    assert "learning.access" in me["permissions"]


async def test_duplicate_and_weak_password(client):
    email = unique_email()
    r = await client.post("/api/v1/auth/register", json={"email": email, "password": "short", "full_name": "X"})
    assert r.status_code == 400 and r.json()["error"]["code"] == "weak_password"
    await signup(client, email=email)
    r = await client.post("/api/v1/auth/register", json={"email": email, "password": PASSWORD, "full_name": "X"})
    assert r.status_code == 409


async def test_wrong_password_and_lockout(client):
    acct = await signup(client)
    for _ in range(5):
        r = await client.post("/api/v1/auth/login", json={"email": acct.email, "password": "wrong-password-1"})
        assert r.status_code == 401
    r = await client.post("/api/v1/auth/login", json={"email": acct.email, "password": PASSWORD})
    assert r.status_code == 401 and r.json()["error"]["code"] == "account_locked"


async def test_unauthenticated_and_bad_token(client):
    assert (await client.get("/api/v1/me")).status_code == 401
    r = await client.get("/api/v1/me", headers={"Authorization": "Bearer not-a-jwt"})
    assert r.status_code == 401


async def test_refresh_rotation_and_reuse_detection(client):
    email = unique_email()
    r = await client.post("/api/v1/auth/register", json={"email": email, "password": PASSWORD, "full_name": "R",
                                                         "include_refresh_token": True})
    rt1 = r.json()["refresh_token"]
    client.cookies.clear()
    r2 = await client.post("/api/v1/auth/refresh", json={"refresh_token": rt1, "include_refresh_token": True})
    assert r2.status_code == 200
    rt2 = r2.json()["refresh_token"]
    assert rt2 != rt1
    # Re-using the old token revokes the whole session
    assert (await client.post("/api/v1/auth/refresh", json={"refresh_token": rt1})).status_code == 401
    assert (await client.post("/api/v1/auth/refresh", json={"refresh_token": rt2})).status_code == 401


async def test_logout_revokes_access_token(client):
    acct = await signup(client)
    assert (await client.post("/api/v1/auth/logout", headers=acct.headers)).status_code == 204
    assert (await client.get("/api/v1/me", headers=acct.headers)).status_code == 401


async def test_mfa_enrol_and_login(client):
    acct = await signup(client)
    setup = (await client.post("/api/v1/auth/mfa/setup", headers=acct.headers)).json()
    code = pyotp.TOTP(setup["secret"]).now()
    r = await client.post("/api/v1/auth/mfa/enable", json={"code": code}, headers=acct.headers)
    assert r.status_code == 200 and len(r.json()["recovery_codes"]) == 8
    recovery = r.json()["recovery_codes"][0]
    r = await client.post("/api/v1/auth/login", json={"email": acct.email, "password": PASSWORD})
    assert r.json()["mfa_required"] is True and r.json()["tokens"] is None
    bad = await client.post("/api/v1/auth/mfa/verify", json={"mfa_token": r.json()["mfa_token"], "code": "000000"})
    assert bad.status_code == 401
    ok = await client.post("/api/v1/auth/mfa/verify", json={"mfa_token": r.json()["mfa_token"],
                                                           "recovery_code": recovery})
    assert ok.status_code == 200
    # recovery codes are single use
    r = await client.post("/api/v1/auth/login", json={"email": acct.email, "password": PASSWORD})
    again = await client.post("/api/v1/auth/mfa/verify", json={"mfa_token": r.json()["mfa_token"],
                                                              "recovery_code": recovery})
    assert again.status_code == 401


async def test_password_reset_and_email_verification(client, db):
    acct = await signup(client)
    verify_token = _last_token(acct.email, "verify-email")
    assert (await client.post("/api/v1/auth/email/verify", json={"token": verify_token})).status_code == 200
    assert (await client.post("/api/v1/auth/email/verify", json={"token": verify_token})).status_code == 400

    assert (await client.post("/api/v1/auth/password/forgot", json={"email": acct.email})).status_code == 202
    # unknown emails get the same response (no enumeration)
    assert (await client.post("/api/v1/auth/password/forgot", json={"email": unique_email()})).status_code == 202
    token = _last_token(acct.email, "reset-password")
    new_pw = "Another-Strong-Passphrase-7"
    assert (await client.post("/api/v1/auth/password/reset", json={"token": token, "password": new_pw})).status_code == 200
    # Existing sessions are revoked after a reset
    assert (await client.get("/api/v1/me", headers=acct.headers)).status_code == 401
    r = await client.post("/api/v1/auth/login", json={"email": acct.email, "password": new_pw})
    assert r.status_code == 200
    user = await db.scalar(select(User).where(User.email == acct.email))
    assert user.email_verified_at is not None and user.password_hash != new_pw


async def test_cookie_auth_requires_csrf(client):
    email = unique_email()
    r = await client.post("/api/v1/auth/register", json={"email": email, "password": PASSWORD, "full_name": "C"})
    csrf = r.json()["csrf_token"]
    assert client.cookies.get("praxis_access")
    assert (await client.get("/api/v1/me")).status_code == 200  # safe method, cookie auth
    no_csrf = await client.patch("/api/v1/me", json={"full_name": "New"})
    assert no_csrf.status_code == 403 and no_csrf.json()["error"]["code"] == "csrf_failed"
    ok = await client.patch("/api/v1/me", json={"full_name": "New"}, headers={"X-CSRF-Token": csrf})
    assert ok.status_code == 200 and ok.json()["full_name"] == "New"
    client.cookies.clear()


async def test_sessions_list_and_revoke(client):
    acct = await signup(client)
    sessions = (await client.get("/api/v1/auth/sessions", headers=acct.headers)).json()
    assert len(sessions) == 1 and sessions[0]["current"] is True


async def test_security_headers(client):
    r = await client.get("/api/v1/health")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "DENY"
    assert r.json()["checks"]["database"] == "ok"


async def test_password_hashing_is_argon2():
    h = security.hash_password(PASSWORD)
    assert h.startswith("$argon2id$") and security.verify_password(PASSWORD, h)
    assert not security.verify_password("nope", h)
