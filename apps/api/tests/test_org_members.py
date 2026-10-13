"""Organisation members, roles, invitations, departments and teams."""

from __future__ import annotations

import re
import uuid

from sqlalchemy import select

from app.core.email import ConsoleEmailProvider
from app.models.platform import AuditLog
from app.models.tenancy import Invitation
from tests.factories import PASSWORD, add_member, set_plan, signup, unique_email

API = "/api/v1"


def _invite_token(email: str) -> str:
    for mail in reversed(ConsoleEmailProvider.outbox):
        if mail.to == email and "accept-invite" in mail.text:
            return re.search(r"token=([\w\-]+)", mail.text).group(1)
    raise AssertionError("invitation email not found")


async def _actions(db, org_id) -> list[str]:
    return list(
        (await db.execute(select(AuditLog.action).where(AuditLog.organisation_id == org_id))).scalars()
    )


# ----------------------------------------------------------------------------- users


async def test_list_search_filter_and_detail(client):
    admin = await signup(client, org_name="Members Co")
    await set_plan(admin.org_id, "business")
    inst = await add_member(admin.org_id, "instructor", full_name="Ingrid Instructor")
    await add_member(admin.org_id, "learner", full_name="Larry Learner")
    r = await client.get(f"{API}/users", headers=admin.headers)
    assert r.status_code == 200 and r.json()["total"] == 3
    r = await client.get(f"{API}/users", params={"q": "ingrid"}, headers=admin.headers)
    assert [m["full_name"] for m in r.json()["items"]] == ["Ingrid Instructor"]
    r = await client.get(f"{API}/users", params={"role": "learner"}, headers=admin.headers)
    assert [m["full_name"] for m in r.json()["items"]] == ["Larry Learner"]
    r = await client.get(f"{API}/users", params={"page_size": 1, "page": 2}, headers=admin.headers)
    assert len(r.json()["items"]) == 1 and r.json()["total"] == 3
    d = (await client.get(f"{API}/users/{inst.user_id}", headers=admin.headers)).json()
    assert d["roles"] == ["instructor"] and d["enrolments"]["total"] == 0 and d["teams"] == []


async def test_learner_cannot_manage_users(client):
    admin = await signup(client)
    learner = await add_member(admin.org_id, "learner")
    assert (await client.get(f"{API}/users", headers=learner.headers)).status_code == 403
    r = await client.post(f"{API}/invitations", json={"email": unique_email()}, headers=learner.headers)
    assert r.status_code == 403
    r = await client.put(
        f"{API}/users/{admin.user_id}/roles", json={"roles": ["learner"]}, headers=learner.headers
    )
    assert r.status_code == 403
    assert (await client.delete(f"{API}/users/{admin.user_id}", headers=learner.headers)).status_code == 403


async def test_cross_tenant_members_are_404(client):
    a = await signup(client, org_name="Tenant A")
    b = await signup(client, org_name="Tenant B")
    b_member = await add_member(b.org_id, "learner")
    assert (await client.get(f"{API}/users/{b_member.user_id}", headers=a.headers)).status_code == 404
    r = await client.patch(f"{API}/users/{b_member.user_id}", json={"job_title": "x"}, headers=a.headers)
    assert r.status_code == 404
    assert (await client.delete(f"{API}/users/{b_member.user_id}", headers=a.headers)).status_code == 404
    listed = (await client.get(f"{API}/users", headers=a.headers)).json()["items"]
    assert all(m["user_id"] != str(b_member.user_id) for m in listed)


async def test_update_member_profile_fields(client, db):
    admin = await signup(client)
    learner = await add_member(admin.org_id, "learner")
    dept = (await client.post(f"{API}/departments", json={"name": "Ops"}, headers=admin.headers)).json()
    r = await client.patch(
        f"{API}/users/{learner.user_id}",
        headers=admin.headers,
        json={
            "job_title": "Analyst",
            "department_id": dept["id"],
            "manager_user_id": str(admin.user_id),
            "employee_id": "E-100",
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["department_name"] == "Ops" and r.json()["employee_id"] == "E-100"
    r = await client.patch(
        f"{API}/users/{learner.user_id}",
        json={"manager_user_id": str(learner.user_id)},
        headers=admin.headers,
    )
    assert r.status_code == 400
    r = await client.patch(
        f"{API}/users/{learner.user_id}", json={"department_id": str(uuid.uuid4())}, headers=admin.headers
    )
    assert r.status_code == 400
    assert "member.updated" in await _actions(db, admin.org_id)


async def test_roles_and_last_admin_protection(client, db):
    admin = await signup(client)
    learner = await add_member(admin.org_id, "learner")
    # The only admin cannot demote, suspend or remove themselves into a headless org
    r = await client.put(
        f"{API}/users/{admin.user_id}/roles", json={"roles": ["learner"]}, headers=admin.headers
    )
    assert r.status_code == 409 and r.json()["error"]["code"] == "last_admin"
    r = await client.put(
        f"{API}/users/{learner.user_id}/roles",
        json={"roles": ["org_admin", "learner"]},
        headers=admin.headers,
    )
    assert r.status_code == 200 and r.json()["roles"] == ["learner", "org_admin"]
    # Now there are two admins: demoting one is fine
    r = await client.put(
        f"{API}/users/{admin.user_id}/roles", json={"roles": ["instructor"]}, headers=admin.headers
    )
    assert r.status_code == 200
    second = learner  # now the only admin
    r = await client.put(
        f"{API}/users/{second.user_id}/roles", json={"roles": ["learner"]}, headers=second.headers
    )
    assert r.status_code == 409
    r = await client.put(
        f"{API}/users/{second.user_id}/roles", json={"roles": ["nope"]}, headers=second.headers
    )
    assert r.status_code == 400 and r.json()["error"]["code"] == "unknown_role"
    assert "member.roles_changed" in await _actions(db, admin.org_id)


async def test_role_assignment_cannot_escalate(client):
    admin = await signup(client)
    # A custom role that can manage roles but nothing else must not hand out org_admin
    r = await client.post(
        f"{API}/roles",
        json={"name": "Role manager", "permissions": ["roles.manage", "users.view"]},
        headers=admin.headers,
    )
    assert r.status_code == 201
    mgr = await add_member(admin.org_id, "role_manager")
    learner = await add_member(admin.org_id, "learner")
    r = await client.put(
        f"{API}/users/{learner.user_id}/roles", json={"roles": ["org_admin"]}, headers=mgr.headers
    )
    assert r.status_code == 403 and r.json()["error"]["code"] == "privilege_escalation"


async def test_suspend_reactivate_and_remove(client, db):
    admin = await signup(client)
    learner = await add_member(admin.org_id, "learner")
    assert (
        await client.post(f"{API}/users/{admin.user_id}/suspend", headers=admin.headers)
    ).status_code == 400
    r = await client.post(f"{API}/users/{learner.user_id}/suspend", headers=admin.headers)
    assert r.status_code == 200 and r.json()["status"] == "suspended"
    assert (await client.get(f"{API}/me", headers=learner.headers)).status_code == 403
    r = await client.post(f"{API}/users/{learner.user_id}/reactivate", headers=admin.headers)
    assert r.json()["status"] == "active"
    assert (await client.get(f"{API}/me", headers=learner.headers)).status_code == 200
    assert (await client.delete(f"{API}/users/{admin.user_id}", headers=admin.headers)).status_code == 400
    assert (await client.delete(f"{API}/users/{learner.user_id}", headers=admin.headers)).status_code == 204
    assert (await client.get(f"{API}/users/{learner.user_id}", headers=admin.headers)).status_code == 404
    actions = await _actions(db, admin.org_id)
    assert {"member.suspended", "member.reactivated", "member.removed"} <= set(actions)


async def test_cannot_manage_member_with_more_permissions(client, db):
    admin = await signup(client)
    other_admin = await add_member(admin.org_id, "org_admin")
    manager = await add_member(admin.org_id, "training_manager")
    learner = await add_member(admin.org_id, "learner")
    target = f"{API}/users/{other_admin.user_id}"
    # users.edit / users.delete alone must not reach a member holding permissions the caller lacks
    for method, url, kwargs in [
        ("post", f"{target}/suspend", {}),
        ("post", f"{target}/reactivate", {}),
        ("patch", target, {"json": {"job_title": "Hijacked"}}),
    ]:
        r = await getattr(client, method)(url, headers=manager.headers, **kwargs)
        assert r.status_code == 403, (method, url, r.text)
        assert r.json()["error"]["code"] == "insufficient_privileges"
    # Grant the manager users.delete via a custom role: removal of an admin is still refused
    r = await client.post(
        f"{API}/roles",
        json={"name": "Remover", "permissions": ["users.view", "users.edit", "users.delete"]},
        headers=admin.headers,
    )
    assert r.status_code == 201
    remover = await add_member(admin.org_id, "training_manager", "remover")
    r = await client.delete(target, headers=remover.headers)
    assert r.status_code == 403 and r.json()["error"]["code"] == "insufficient_privileges"
    r = await client.get(target, headers=admin.headers)
    assert r.json()["status"] == "active" and r.json()["job_title"] != "Hijacked"
    # ...but members whose permissions are a subset of the caller's remain manageable
    r = await client.post(f"{API}/users/{learner.user_id}/suspend", headers=manager.headers)
    assert r.status_code == 200 and r.json()["status"] == "suspended"
    r = await client.post(f"{API}/users/{learner.user_id}/reactivate", headers=manager.headers)
    assert r.status_code == 200 and r.json()["status"] == "active"
    r = await client.patch(
        f"{API}/users/{learner.user_id}", json={"job_title": "Analyst"}, headers=manager.headers
    )
    assert r.status_code == 200 and r.json()["job_title"] == "Analyst"
    assert (await client.delete(f"{API}/users/{learner.user_id}", headers=remover.headers)).status_code == 204
    # Org admins can still act on other admins
    r = await client.post(f"{API}/users/{other_admin.user_id}/suspend", headers=admin.headers)
    assert r.status_code == 200 and r.json()["status"] == "suspended"


async def test_create_member_directly_with_temp_password(client):
    admin = await signup(client)
    email = unique_email("direct")
    r = await client.post(
        f"{API}/users",
        json={"email": email, "full_name": "Direct Hire", "roles": ["instructor"]},
        headers=admin.headers,
    )
    assert r.status_code == 201, r.text
    temp = r.json()["temporary_password"]
    assert temp and r.json()["roles"] == ["instructor"]
    login = await client.post(f"{API}/auth/login", json={"email": email, "password": temp})
    assert login.status_code == 200
    client.cookies.clear()
    dup = await client.post(
        f"{API}/users", json={"email": email, "full_name": "Again"}, headers=admin.headers
    )
    assert dup.status_code == 409
    weak = await client.post(
        f"{API}/users",
        json={"email": unique_email(), "full_name": "W", "password": "short"},
        headers=admin.headers,
    )
    assert weak.status_code == 400


async def test_free_plan_user_limit(client):
    admin = await signup(client)  # free plan: 5 users incl. pending invitations
    for _ in range(3):
        await add_member(admin.org_id, "learner")
    r = await client.post(
        f"{API}/users", json={"email": unique_email(), "full_name": "Fifth"}, headers=admin.headers
    )
    assert r.status_code == 201
    r = await client.post(
        f"{API}/users", json={"email": unique_email(), "full_name": "Sixth"}, headers=admin.headers
    )
    assert r.status_code == 402 and r.json()["error"]["code"] == "plan_limit"
    r = await client.post(f"{API}/invitations", json={"email": unique_email()}, headers=admin.headers)
    assert r.status_code == 402


async def test_csv_import_creates_invitations(client, db):
    admin = await signup(client)
    await set_plan(admin.org_id, "business")
    await client.post(f"{API}/departments", json={"name": "Sales"}, headers=admin.headers)
    existing = await add_member(admin.org_id, "learner")
    good1, good2 = unique_email("csv"), unique_email("csv")
    csv_body = (
        "email,role,department\n"
        f"{good1},instructor,Sales\n"
        f"{good2},,\n"
        "not-an-email,learner,\n"
        f"{existing.email},learner,\n"
        f"{unique_email()},wizard,\n"
        f"{unique_email()},learner,Nowhere\n"
    )
    r = await client.post(
        f"{API}/users/import",
        headers=admin.headers,
        files={"file": ("people.csv", csv_body.encode(), "text/csv")},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["invited"] == 2 and len(body["errors"]) == 4
    assert {e["row"] for e in body["errors"]} == {4, 5, 6, 7}
    invs = (
        (await db.execute(select(Invitation).where(Invitation.organisation_id == admin.org_id)))
        .scalars()
        .all()
    )
    by_email = {i.email: i for i in invs}
    assert by_email[good1].role_keys == ["instructor"] and by_email[good1].department_id is not None
    assert by_email[good2].role_keys == ["learner"]
    assert _invite_token(good1)


# ----------------------------------------------------------------------------- invitations


async def test_invitation_accept_creates_account(client, db):
    admin = await signup(client, org_name="Inviting Org")
    email = unique_email("invitee")
    r = await client.post(
        f"{API}/invitations", json={"email": email, "roles": ["instructor"]}, headers=admin.headers
    )
    assert r.status_code == 201 and r.json()["status"] == "pending"
    token = _invite_token(email)
    inv = await db.scalar(select(Invitation).where(Invitation.email == email))
    assert inv.token_hash != token  # only the hash is stored
    look = await client.get(f"{API}/invitations/lookup", params={"token": token})
    assert look.status_code == 200
    assert look.json()["organisation_name"] == "Inviting Org" and look.json()["email"] == email
    assert look.json()["existing_account"] is False
    bad = await client.post(f"{API}/invitations/accept", json={"token": token})
    assert bad.status_code == 400 and bad.json()["error"]["code"] == "account_details_required"
    r = await client.post(
        f"{API}/invitations/accept", json={"token": token, "full_name": "New Person", "password": PASSWORD}
    )
    assert r.status_code == 200, r.text
    assert r.json()["account_created"] is True and r.json()["access_token"]
    client.cookies.clear()
    headers = {"Authorization": f"Bearer {r.json()['access_token']}", "X-Organisation-Id": str(admin.org_id)}
    me = (await client.get(f"{API}/me", headers=headers)).json()
    assert me["organisation"]["id"] == str(admin.org_id) and "courses.publish" in me["permissions"]
    # Token is single use
    assert (await client.get(f"{API}/invitations/lookup", params={"token": token})).status_code == 404
    again = await client.post(
        f"{API}/invitations/accept", json={"token": token, "full_name": "X", "password": PASSWORD}
    )
    assert again.status_code == 404
    assert "invitation.accepted" in await _actions(db, admin.org_id)


async def test_invitation_accept_existing_user(client):
    admin = await signup(client, org_name="Second Org")
    other = await signup(client, org_name="Their Own Org")
    r = await client.post(f"{API}/invitations", json={"email": other.email}, headers=admin.headers)
    assert r.status_code == 201
    token = _invite_token(other.email)
    look = (await client.get(f"{API}/invitations/lookup", params={"token": token})).json()
    assert look["existing_account"] is True
    anon = await client.post(
        f"{API}/invitations/accept", json={"token": token, "full_name": "x", "password": PASSWORD}
    )
    assert anon.status_code == 401 and anon.json()["error"]["code"] == "login_required"
    stranger = await signup(client, org_name="Stranger Org")
    wrong = await client.post(
        f"{API}/invitations/accept",
        json={"token": token},
        headers={"Authorization": stranger.headers["Authorization"]},
    )
    assert wrong.status_code == 403 and wrong.json()["error"]["code"] == "invitation_email_mismatch"
    ok = await client.post(
        f"{API}/invitations/accept",
        json={"token": token},
        headers={"Authorization": other.headers["Authorization"]},
    )
    assert (
        ok.status_code == 200 and ok.json()["account_created"] is False and ok.json()["access_token"] is None
    )
    orgs = (await client.get(f"{API}/me/organisations", headers=other.headers)).json()
    assert {o["name"] for o in orgs} == {"Second Org", "Their Own Org"}
    # Already a member now: cannot be invited again
    dup = await client.post(f"{API}/invitations", json={"email": other.email}, headers=admin.headers)
    assert dup.status_code == 409


async def test_invitation_revoke_resend_list_and_bulk(client):
    admin = await signup(client)
    await set_plan(admin.org_id, "business")
    email = unique_email("rv")
    inv = (await client.post(f"{API}/invitations", json={"email": email}, headers=admin.headers)).json()
    first = _invite_token(email)
    r = await client.post(f"{API}/invitations/{inv['id']}/resend", headers=admin.headers)
    assert r.status_code == 200
    second = _invite_token(email)
    assert first != second
    assert (await client.get(f"{API}/invitations/lookup", params={"token": first})).status_code == 404
    assert (await client.delete(f"{API}/invitations/{inv['id']}", headers=admin.headers)).status_code == 204
    assert (await client.get(f"{API}/invitations/lookup", params={"token": second})).status_code == 404
    assert (
        await client.post(f"{API}/invitations/{inv['id']}/resend", headers=admin.headers)
    ).status_code == 409
    bulk = await client.post(
        f"{API}/invitations/bulk",
        headers=admin.headers,
        json={"emails": [unique_email(), unique_email(), admin.email], "roles": ["learner"]},
    )
    assert bulk.status_code == 201
    assert len(bulk.json()["invited"]) == 2 and bulk.json()["errors"][0]["email"] == admin.email
    pending = (
        await client.get(f"{API}/invitations", params={"status": "pending"}, headers=admin.headers)
    ).json()
    assert pending["total"] == 2
    revoked = (
        await client.get(f"{API}/invitations", params={"status": "revoked"}, headers=admin.headers)
    ).json()
    assert revoked["total"] == 1
    other = await signup(client)
    assert (await client.delete(f"{API}/invitations/{inv['id']}", headers=other.headers)).status_code == 404


async def test_invitation_cannot_grant_more_than_inviter(client):
    admin = await signup(client)
    manager = await add_member(admin.org_id, "training_manager")
    r = await client.post(
        f"{API}/invitations", json={"email": unique_email(), "roles": ["org_admin"]}, headers=manager.headers
    )
    assert r.status_code == 403
    r = await client.post(
        f"{API}/invitations", json={"email": unique_email(), "roles": ["learner"]}, headers=manager.headers
    )
    assert r.status_code == 201


# ----------------------------------------------------------------------------- roles


async def test_custom_roles_crud(client, db):
    admin = await signup(client)
    perms = (await client.get(f"{API}/roles/permissions", headers=admin.headers)).json()
    assert "system.manage" not in {p["code"] for p in perms}
    r = await client.post(
        f"{API}/roles",
        headers=admin.headers,
        json={"name": "Content Reviewer", "permissions": ["courses.view", "submissions.review"]},
    )
    assert r.status_code == 201 and r.json()["key"] == "content_reviewer"
    role_id = r.json()["id"]
    assert (
        await client.post(f"{API}/roles", headers=admin.headers, json={"name": "Content Reviewer"})
    ).status_code == 409
    bad = await client.post(
        f"{API}/roles", headers=admin.headers, json={"name": "X", "permissions": ["system.manage"]}
    )
    assert bad.status_code == 400
    r = await client.patch(
        f"{API}/roles/{role_id}",
        headers=admin.headers,
        json={"permissions": ["courses.view"], "description": "Reads courses"},
    )
    assert r.status_code == 200 and r.json()["permissions"] == ["courses.view"]
    roles = (await client.get(f"{API}/roles", headers=admin.headers)).json()
    system = next(x for x in roles if x["key"] == "learner")
    assert system["is_system"] is True
    r = await client.patch(
        f"{API}/roles/{system['id']}", headers=admin.headers, json={"permissions": ["users.view"]}
    )
    assert r.status_code == 403
    assert (await client.delete(f"{API}/roles/{system['id']}", headers=admin.headers)).status_code == 403
    member = await add_member(admin.org_id, "content_reviewer")
    assert (await client.delete(f"{API}/roles/{role_id}", headers=admin.headers)).status_code == 409
    await client.put(
        f"{API}/users/{member.user_id}/roles", json={"roles": ["learner"]}, headers=admin.headers
    )
    assert (await client.delete(f"{API}/roles/{role_id}", headers=admin.headers)).status_code == 204
    other = await signup(client)
    assert (await client.get(f"{API}/roles/{system['id']}", headers=other.headers)).status_code == 404
    learner = await add_member(admin.org_id, "learner")
    assert (await client.post(f"{API}/roles", headers=learner.headers, json={"name": "Y"})).status_code == 403
    assert {"role.created", "role.updated", "role.deleted"} <= set(await _actions(db, admin.org_id))


# ----------------------------------------------------------------------------- departments & teams


async def test_departments_tree_and_teams(client):
    admin = await signup(client)
    learner = await add_member(admin.org_id, "learner")
    eng = (
        await client.post(f"{API}/departments", json={"name": "Engineering"}, headers=admin.headers)
    ).json()
    web = (
        await client.post(
            f"{API}/departments", json={"name": "Web", "parent_id": eng["id"]}, headers=admin.headers
        )
    ).json()
    cyc = await client.patch(
        f"{API}/departments/{eng['id']}", json={"parent_id": web["id"]}, headers=admin.headers
    )
    assert cyc.status_code == 400 and cyc.json()["error"]["code"] == "department_cycle"
    tree = (await client.get(f"{API}/departments/tree", headers=admin.headers)).json()
    assert tree[0]["name"] == "Engineering" and tree[0]["children"][0]["name"] == "Web"
    await client.patch(
        f"{API}/users/{learner.user_id}", json={"department_id": web["id"]}, headers=admin.headers
    )
    web_out = (await client.get(f"{API}/departments/{web['id']}", headers=admin.headers)).json()
    assert web_out["member_count"] == 1

    team = await client.post(
        f"{API}/teams",
        json={"name": "Frontend", "department_id": web["id"], "lead_user_id": str(admin.user_id)},
        headers=admin.headers,
    )
    assert team.status_code == 201 and team.json()["member_count"] == 1
    tid = team.json()["id"]
    r = await client.post(
        f"{API}/teams/{tid}/members", json={"user_ids": [str(learner.user_id)]}, headers=admin.headers
    )
    assert r.status_code == 200 and r.json()["member_count"] == 2
    outsider = await add_member((await signup(client)).org_id, "learner")
    r = await client.post(
        f"{API}/teams/{tid}/members", json={"user_ids": [str(outsider.user_id)]}, headers=admin.headers
    )
    assert r.status_code == 400
    members = (await client.get(f"{API}/teams/{tid}/members", headers=admin.headers)).json()
    assert members["total"] == 2
    detail = (await client.get(f"{API}/users/{learner.user_id}", headers=admin.headers)).json()
    assert detail["teams"] == [{"id": tid, "name": "Frontend"}]
    by_team = (await client.get(f"{API}/users", params={"team_id": tid}, headers=admin.headers)).json()
    assert by_team["total"] == 2
    assert (
        await client.delete(f"{API}/teams/{tid}/members/{learner.user_id}", headers=admin.headers)
    ).status_code == 204
    assert (
        await client.delete(f"{API}/teams/{tid}/members/{learner.user_id}", headers=admin.headers)
    ).status_code == 404
    # Learners can't edit structure; other orgs can't see it
    assert (await client.post(f"{API}/teams", json={"name": "X"}, headers=learner.headers)).status_code == 403
    other = await signup(client)
    assert (await client.get(f"{API}/teams/{tid}", headers=other.headers)).status_code == 404
    assert (await client.get(f"{API}/departments/{eng['id']}", headers=other.headers)).status_code == 404
    # Deleting a parent re-parents its children
    assert (await client.delete(f"{API}/departments/{eng['id']}", headers=admin.headers)).status_code == 204
    flat = (await client.get(f"{API}/departments", headers=admin.headers)).json()
    assert [(d["name"], d["parent_id"]) for d in flat] == [("Web", None)]
    assert (await client.delete(f"{API}/teams/{tid}", headers=admin.headers)).status_code == 204
    assert (await client.get(f"{API}/teams", headers=admin.headers)).json() == []
