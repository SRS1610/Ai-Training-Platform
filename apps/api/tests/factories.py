"""Account factories shared by all test modules."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime

from httpx import AsyncClient
from sqlalchemy import select

from app.core import security
from app.core.db import get_sessionmaker
from app.models.identity import AuthSession, User
from app.models.tenancy import MembershipStatus, OrganisationUser, Role

PASSWORD = "Correct-Horse-Battery-9"


@dataclass
class Account:
    user_id: uuid.UUID
    org_id: uuid.UUID
    email: str
    token: str
    headers: dict[str, str] = field(default_factory=dict)


def unique_email(prefix: str = "user") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}@example.com"


async def signup(client: AsyncClient, *, org_name: str | None = "Acme Pty Ltd", email: str | None = None,
                 full_name: str = "Test Admin") -> Account:
    """Register via the public API. The registrant becomes org_admin of a new organisation."""
    email = email or unique_email("admin")
    r = await client.post("/api/v1/auth/register", json={
        "email": email, "password": PASSWORD, "full_name": full_name, "organisation_name": org_name,
    })
    assert r.status_code == 201, r.text
    token = r.json()["access_token"]
    me = await client.get("/api/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200, me.text
    org_id = uuid.UUID(me.json()["organisation"]["id"])
    client.cookies.clear()
    return Account(uuid.UUID(r.json()["user_id"]), org_id, email, token,
                   {"Authorization": f"Bearer {token}", "X-Organisation-Id": str(org_id)})


async def add_member(org_id: uuid.UUID, *role_keys: str, email: str | None = None,
                     full_name: str = "Test Member") -> Account:
    """Create a user directly in the DB with the given roles in ``org_id`` and mint an access token."""
    email = email or unique_email("member")
    async with get_sessionmaker()() as s:
        s.info["rls_bypass"] = True
        user = User(email=email, full_name=full_name, password_hash=security.hash_password(PASSWORD),
                    default_organisation_id=org_id, email_verified_at=datetime.now(UTC))
        s.add(user)
        await s.flush()
        roles = (await s.execute(select(Role).where(Role.organisation_id == org_id,
                                                    Role.key.in_(role_keys or ("learner",))))).scalars().all()
        s.add(OrganisationUser(organisation_id=org_id, user_id=user.id, status=MembershipStatus.ACTIVE,
                               joined_at=datetime.now(UTC), roles=list(roles)))
        sess = AuthSession(user_id=user.id, refresh_token_hash=security.hash_token(security.generate_token()),
                           expires_at=datetime(2100, 1, 1, tzinfo=UTC))
        s.add(sess)
        await s.flush()
        token, _ = security.create_access_token(user_id=user.id, session_id=sess.id, mfa=False)
        await s.commit()
        return Account(user.id, org_id, email, token,
                       {"Authorization": f"Bearer {token}", "X-Organisation-Id": str(org_id)})


async def set_plan(org_id: uuid.UUID, plan_code: str = "business", **settings_overrides) -> None:
    """Switch an organisation's plan (tests creating many courses / using paid features)."""
    from app.models.tenancy import Organisation

    async with get_sessionmaker()() as s:
        s.info["rls_bypass"] = True
        org = await s.get(Organisation, org_id)
        org.plan_code = plan_code
        if settings_overrides:
            org.settings = {**(org.settings or {}), **settings_overrides}
        await s.commit()
