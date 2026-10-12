"""Organisation settings / branding / custom domains, API keys, SSO connections and the audit log API."""

from __future__ import annotations

import datetime as dt
import uuid

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID
from sqlalchemy import select

from app.core import security
from app.models.tenancy import ApiKey, SSOConnection
from app.modules.organisations import domains
from app.modules.sso import service as sso_service
from tests.factories import add_member, set_plan, signup

API = "/api/v1"


# ----------------------------------------------------------------------------- organisations


async def test_get_and_update_settings(client):
    admin = await signup(client, org_name="Settings Co")
    r = await client.get(f"{API}/organisations/current", headers=admin.headers)
    assert r.status_code == 200 and r.json()["settings"]["retention_days"] == 2555
    assert r.json()["features"]["custom_branding"] is False
    r = await client.patch(
        f"{API}/organisations/current",
        headers=admin.headers,
        json={
            "name": "Renamed Co",
            "settings": {"gamification_enabled": False, "retention_days": 365, "default_locale": "en-GB"},
        },
    )
    assert r.status_code == 200, r.text
    s = r.json()["settings"]
    assert (
        r.json()["name"] == "Renamed Co" and s["gamification_enabled"] is False and s["retention_days"] == 365
    )
    assert (await client.get(f"{API}/me", headers=admin.headers)).json()["settings"][
        "gamification_enabled"
    ] is False
    bad = await client.patch(
        f"{API}/organisations/current", headers=admin.headers, json={"settings": {"retention_days": 1}}
    )
    assert bad.status_code == 422
    # Admin without MFA cannot lock everyone (incl. themselves) behind MFA
    mfa = await client.patch(
        f"{API}/organisations/current", headers=admin.headers, json={"settings": {"require_mfa": True}}
    )
    assert mfa.status_code == 400 and mfa.json()["error"]["code"] == "mfa_required_for_admin"
    learner = await add_member(admin.org_id, "learner")
    assert (await client.get(f"{API}/organisations/current", headers=learner.headers)).status_code == 403
    assert (
        await client.patch(f"{API}/organisations/current", json={"name": "x"}, headers=learner.headers)
    ).status_code == 403


async def test_branding_requires_plan_and_valid_colours(client):
    admin = await signup(client)
    r = await client.patch(
        f"{API}/organisations/current", headers=admin.headers, json={"branding": {"primary_color": "#112233"}}
    )
    assert r.status_code == 402 and r.json()["error"]["details"]["feature"] == "custom_branding"
    await set_plan(admin.org_id, "business")
    bad = await client.patch(
        f"{API}/organisations/current", headers=admin.headers, json={"branding": {"primary_color": "red"}}
    )
    assert bad.status_code == 422
    extra = await client.patch(
        f"{API}/organisations/current", headers=admin.headers, json={"branding": {"evil": "<script>"}}
    )
    assert extra.status_code == 422
    ok = await client.patch(
        f"{API}/organisations/current",
        headers=admin.headers,
        json={
            "branding": {"primary_color": "#112233", "accent_color": "#abc"},
            "logo_url": "https://cdn.example.com/l.png",
        },
    )
    assert ok.status_code == 200, ok.text
    assert (
        ok.json()["branding"]["primary_color"] == "#112233"
        and ok.json()["branding"]["accent_color"] == "#abc"
    )
    assert ok.json()["logo_url"] == "https://cdn.example.com/l.png"
    cleared = await client.patch(
        f"{API}/organisations/current", headers=admin.headers, json={"branding": {"accent_color": None}}
    )
    assert "accent_color" not in cleared.json()["branding"] and cleared.json()["branding"]["primary_color"]


async def test_custom_domain_verification(client, monkeypatch):
    admin = await signup(client)
    assert (
        await client.put(
            f"{API}/organisations/current/domain", json={"domain": "learn.acme.test"}, headers=admin.headers
        )
    ).status_code == 402
    await set_plan(admin.org_id, "business")
    r = await client.put(
        f"{API}/organisations/current/domain",
        json={"domain": "https://Learn.Acme-Corp.com/"},
        headers=admin.headers,
    )
    assert r.status_code == 200, r.text
    st = r.json()
    assert st["domain"] == "learn.acme-corp.com" and st["status"] == "pending" and st["record_type"] == "TXT"
    assert st["record_name"] == "_praxis-verification.learn.acme-corp.com"
    expected = st["record_value"]

    records: dict[str, list[str] | None] = {"_praxis-verification.learn.acme-corp.com": ["unrelated"]}

    async def fake_lookup(name: str):
        return records.get(name, [])

    monkeypatch.setattr(domains, "lookup_txt", fake_lookup)
    r = await client.post(f"{API}/organisations/current/domain/verify", headers=admin.headers)
    assert r.json()["status"] == "pending" and r.json()["verified"] is False
    records["_praxis-verification.learn.acme-corp.com"] = [expected]
    r = await client.post(f"{API}/organisations/current/domain/verify", headers=admin.headers)
    assert r.json()["status"] == "verified" and r.json()["verified_at"]
    other = await signup(client)
    await set_plan(other.org_id, "business")
    taken = await client.put(
        f"{API}/organisations/current/domain", json={"domain": "learn.acme-corp.com"}, headers=other.headers
    )
    assert taken.status_code == 409
    bad = await client.put(
        f"{API}/organisations/current/domain", json={"domain": "not a domain"}, headers=other.headers
    )
    assert bad.status_code == 400
    assert (
        await client.delete(f"{API}/organisations/current/domain", headers=admin.headers)
    ).status_code == 204
    assert (await client.get(f"{API}/organisations/current/domain", headers=admin.headers)).json()[
        "status"
    ] == "none"


async def test_create_additional_organisation(client):
    user = await signup(client, org_name="First Org")
    r = await client.post(
        f"{API}/organisations",
        json={"name": "Second Org", "kind": "education"},
        headers={"Authorization": user.headers["Authorization"]},
    )
    assert r.status_code == 201, r.text
    new_id = r.json()["id"]
    me = await client.get(f"{API}/me", headers={**user.headers, "X-Organisation-Id": new_id})
    assert me.status_code == 200 and "organisation.manage" in me.json()["permissions"]
    assert me.json()["organisation"]["kind"] == "education"


# ----------------------------------------------------------------------------- API keys


async def test_api_key_lifecycle_and_auth(client, db):
    admin = await signup(client)
    r = await client.post(
        f"{API}/api-keys", json={"name": "HRIS sync", "scopes": ["users.view"]}, headers=admin.headers
    )
    assert r.status_code == 402
    await set_plan(admin.org_id, "business")
    r = await client.post(
        f"{API}/api-keys", json={"name": "HRIS sync", "scopes": ["users.view"]}, headers=admin.headers
    )
    assert r.status_code == 201, r.text
    key = r.json()["key"]
    prefix = r.json()["prefix"]
    assert key.startswith(f"pk_{prefix}_") and len(prefix) == 10
    row = await db.scalar(select(ApiKey).where(ApiKey.prefix == prefix))
    assert row.key_hash == security.hash_token(key) and key not in row.key_hash

    users = await client.get(f"{API}/users", headers={"X-API-Key": key})
    assert users.status_code == 200 and users.json()["total"] == 1
    # Scope-limited: cannot invite
    inv = await client.post(f"{API}/invitations", json={"email": "x@example.com"}, headers={"X-API-Key": key})
    assert inv.status_code == 403
    # API keys cannot mint API keys even with the scope
    assert (await client.get(f"{API}/api-keys", headers={"X-API-Key": key})).status_code == 403

    listed = (await client.get(f"{API}/api-keys", headers=admin.headers)).json()
    assert listed["total"] == 1 and "key" not in listed["items"][0]
    assert (await client.delete(f"{API}/api-keys/{row.id}", headers=admin.headers)).status_code == 204
    assert (await client.get(f"{API}/users", headers={"X-API-Key": key})).status_code == 401
    assert (await client.get(f"{API}/api-keys", headers=admin.headers)).json()["total"] == 0
    assert (
        await client.get(f"{API}/api-keys", params={"include_revoked": True}, headers=admin.headers)
    ).json()["items"][0]["status"] == "revoked"


async def test_api_key_scopes_subset_of_creator(client):
    admin = await signup(client)
    await set_plan(admin.org_id, "business")
    r = await client.post(
        f"{API}/api-keys", json={"name": "x", "scopes": ["system.manage"]}, headers=admin.headers
    )
    assert r.status_code == 400
    r = await client.post(
        f"{API}/roles",
        headers=admin.headers,
        json={"name": "Integrator", "permissions": ["api_keys.manage", "courses.view"]},
    )
    integrator = await add_member(admin.org_id, "integrator")
    r = await client.post(
        f"{API}/api-keys", json={"name": "x", "scopes": ["users.view"]}, headers=integrator.headers
    )
    assert r.status_code == 403 and r.json()["error"]["code"] == "privilege_escalation"
    r = await client.post(
        f"{API}/api-keys", json={"name": "x", "scopes": ["courses.view"]}, headers=integrator.headers
    )
    assert r.status_code == 201
    learner = await add_member(admin.org_id, "learner")
    assert (await client.get(f"{API}/api-keys", headers=learner.headers)).status_code == 403
    other = await signup(client)
    await set_plan(other.org_id, "business")
    assert (await client.delete(f"{API}/api-keys/{r.json()['id']}", headers=other.headers)).status_code == 404


# ----------------------------------------------------------------------------- SSO


def _self_signed_pem() -> str:
    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "idp.example.com")])
    now = dt.datetime.now(dt.UTC)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now)
        .not_valid_after(now + dt.timedelta(days=30))
        .sign(key, hashes.SHA256())
    )
    return cert.public_bytes(serialization.Encoding.PEM).decode()


async def test_sso_oidc_connection(client, db, monkeypatch):
    admin = await signup(client)
    body = {
        "protocol": "oidc",
        "name": "Okta",
        "email_domains": ["acme-sso.com"],
        "oidc": {"issuer": "https://idp.acme-sso.com", "client_id": "cid", "client_secret": "s3cret!"},
    }
    assert (await client.post(f"{API}/sso/connections", json=body, headers=admin.headers)).status_code == 402
    await set_plan(admin.org_id, "enterprise")
    no_secret = {**body, "oidc": {"issuer": "https://idp.acme-sso.com", "client_id": "cid"}}
    assert (
        await client.post(f"{API}/sso/connections", json=no_secret, headers=admin.headers)
    ).status_code == 400
    gmail = {**body, "email_domains": ["gmail.com"]}
    assert (await client.post(f"{API}/sso/connections", json=gmail, headers=admin.headers)).status_code == 400
    r = await client.post(f"{API}/sso/connections", json=body, headers=admin.headers)
    assert r.status_code == 201, r.text
    conn = r.json()
    assert "s3cret" not in r.text and conn["config"]["has_client_secret"] is True
    assert conn["email_domains"] == [] and conn["pending_domains"] == ["acme-sso.com"]
    assert conn["login_url"].endswith(f"/auth/oauth/sso-{conn['id']}/authorize")
    row = await db.get(SSOConnection, uuid.UUID(conn["id"]))
    assert security.decrypt_str(row.config["client_secret_encrypted"]) == "s3cret!"

    # Unverified domains do not activate SSO discovery
    disc = await client.get(f"{API}/auth/sso/discover", params={"email": "bob@acme-sso.com"})
    assert disc.json()["sso_available"] is False
    pending = next(d for d in conn["domains"] if not d["verified"])

    async def fake_lookup(name: str):
        return [pending["record_value"]] if name == pending["record_name"] else []

    monkeypatch.setattr(domains, "lookup_txt", fake_lookup)
    r = await client.post(f"{API}/sso/connections/{conn['id']}/verify-domains", headers=admin.headers)
    assert r.json()["email_domains"] == ["acme-sso.com"] and r.json()["pending_domains"] == []
    disc = await client.get(f"{API}/auth/sso/discover", params={"email": "bob@acme-sso.com"})
    assert disc.json()["sso_available"] is True

    # Test connection against a stubbed discovery document
    async def fake_discovery(issuer: str):
        return 200, {
            "issuer": issuer,
            "authorization_endpoint": f"{issuer}/auth",
            "token_endpoint": f"{issuer}/token",
            "userinfo_endpoint": f"{issuer}/userinfo",
        }

    monkeypatch.setattr(sso_service, "fetch_discovery", fake_discovery)
    t = await client.post(f"{API}/sso/connections/{conn['id']}/test", headers=admin.headers)
    assert t.status_code == 200 and t.json()["ok"] is True

    async def broken_discovery(issuer: str):
        return 200, {"issuer": "https://evil.example.com"}

    monkeypatch.setattr(sso_service, "fetch_discovery", broken_discovery)
    t = await client.post(f"{API}/sso/connections/{conn['id']}/test", headers=admin.headers)
    assert t.json()["ok"] is False

    # Update keeps the stored secret when not re-sent
    u = await client.patch(
        f"{API}/sso/connections/{conn['id']}",
        headers=admin.headers,
        json={"enforce_sso": True, "oidc": {"issuer": "https://idp.acme-sso.com", "client_id": "cid2"}},
    )
    assert (
        u.status_code == 200 and u.json()["config"]["client_id"] == "cid2" and u.json()["enforce_sso"] is True
    )
    assert (
        await client.patch(
            f"{API}/sso/connections/{conn['id']}",
            headers=admin.headers,
            json={"default_role_key": "org_admin"},
        )
    ).status_code == 400

    # Another org cannot claim the same verified domain or see the connection
    other = await signup(client)
    await set_plan(other.org_id, "enterprise")
    clash = await client.post(f"{API}/sso/connections", json=body, headers=other.headers)
    assert clash.status_code == 409
    assert (await client.get(f"{API}/sso/connections/{conn['id']}", headers=other.headers)).status_code == 404
    assert (
        await client.delete(f"{API}/sso/connections/{conn['id']}", headers=admin.headers)
    ).status_code == 204


async def test_sso_saml_connection(client):
    admin = await signup(client)
    await set_plan(admin.org_id, "enterprise")
    bad = await client.post(
        f"{API}/sso/connections",
        headers=admin.headers,
        json={
            "protocol": "saml",
            "name": "ADFS",
            "saml": {
                "idp_entity_id": "urn:idp",
                "sso_url": "https://adfs.example.com/sso",
                "x509_cert": "x" * 40,
            },
        },
    )
    assert bad.status_code == 400 and bad.json()["error"]["code"] == "invalid_certificate"
    r = await client.post(
        f"{API}/sso/connections",
        headers=admin.headers,
        json={
            "protocol": "saml",
            "name": "ADFS",
            "saml": {
                "idp_entity_id": "urn:idp",
                "sso_url": "https://adfs.example.com/sso",
                "x509_cert": _self_signed_pem(),
            },
        },
    )
    assert r.status_code == 201, r.text
    assert r.json()["requires_saml_adapter"] is True and r.json()["login_url"] is None
    t = await client.post(f"{API}/sso/connections/{r.json()['id']}/test", headers=admin.headers)
    assert t.json()["ok"] is True and t.json()["details"]["requires_saml_adapter"] is True
    listed = (await client.get(f"{API}/sso/connections", headers=admin.headers)).json()
    assert len(listed) == 1
    learner = await add_member(admin.org_id, "learner")
    assert (await client.get(f"{API}/sso/connections", headers=learner.headers)).status_code == 403


# ----------------------------------------------------------------------------- audit logs


async def test_audit_log_list_filter_verify_export(client):
    admin = await signup(client)
    learner = await add_member(admin.org_id, "learner")
    await client.patch(f"{API}/users/{learner.user_id}", json={"job_title": "Analyst"}, headers=admin.headers)
    await client.post(f"{API}/users/{learner.user_id}/suspend", headers=admin.headers)
    r = await client.get(f"{API}/audit-logs", headers=admin.headers)
    assert r.status_code == 200 and r.json()["total"] >= 3
    actions = [i["action"] for i in r.json()["items"]]
    assert actions[0] == "member.suspended"  # newest first
    fam = (await client.get(f"{API}/audit-logs", params={"action": "member."}, headers=admin.headers)).json()
    assert {i["action"] for i in fam["items"]} == {"member.updated", "member.suspended"}
    ent = (
        await client.get(
            f"{API}/audit-logs",
            params={"entity_type": "user", "entity_id": str(learner.user_id)},
            headers=admin.headers,
        )
    ).json()
    assert ent["total"] == 2
    by_actor = (
        await client.get(
            f"{API}/audit-logs",
            params={"actor_user_id": str(admin.user_id), "action": "member.updated"},
            headers=admin.headers,
        )
    ).json()
    assert by_actor["total"] == 1
    future = (
        await client.get(
            f"{API}/audit-logs", params={"date_from": "2999-01-01T00:00:00Z"}, headers=admin.headers
        )
    ).json()
    assert future["total"] == 0
    v = (await client.get(f"{API}/audit-logs/verify", headers=admin.headers)).json()
    assert v["valid"] is True and v["checked"] >= 3
    exp = await client.get(f"{API}/audit-logs/export", params={"action": "member."}, headers=admin.headers)
    assert exp.status_code == 200 and exp.headers["content-type"].startswith("text/csv")
    lines = exp.text.strip().splitlines()
    assert lines[0].startswith("created_at,action") and len(lines) == 3
    one = r.json()["items"][0]["id"]
    assert (await client.get(f"{API}/audit-logs/{one}", headers=admin.headers)).status_code == 200
    # tenant isolation + permission
    other = await signup(client)
    assert (await client.get(f"{API}/audit-logs/{one}", headers=other.headers)).status_code == 404
    assert all(
        i["organisation_id"] == str(other.org_id)
        for i in (await client.get(f"{API}/audit-logs", headers=other.headers)).json()["items"]
    )
    fresh_learner = await add_member(admin.org_id, "learner")
    assert (await client.get(f"{API}/audit-logs", headers=fresh_learner.headers)).status_code == 403
    auditor = await add_member(admin.org_id, "auditor")
    assert (await client.get(f"{API}/audit-logs", headers=auditor.headers)).status_code == 200


async def test_sso_secret_never_listed(client):
    admin = await signup(client)
    await set_plan(admin.org_id, "enterprise")
    await client.post(
        f"{API}/sso/connections",
        headers=admin.headers,
        json={
            "protocol": "oidc",
            "name": "Okta",
            "oidc": {
                "issuer": "https://idp.example.org",
                "client_id": "a",
                "client_secret": "top-secret-value",
            },
        },
    )
    listed = await client.get(f"{API}/sso/connections", headers=admin.headers)
    assert "top-secret-value" not in listed.text and "client_secret_encrypted" not in listed.text
