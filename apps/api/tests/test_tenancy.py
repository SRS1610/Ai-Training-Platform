"""Tenant isolation at the database (RLS) level and audit-log immutability."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError

from app.core.audit import verify_chain, write_audit
from app.core.db import bind_tenant, get_sessionmaker
from app.models.content import Course
from tests.factories import add_member, signup


async def test_rls_blocks_cross_tenant_reads_and_writes(client):
    a = await signup(client, org_name="Tenant A")
    b = await signup(client, org_name="Tenant B")
    async with get_sessionmaker()() as s:
        await bind_tenant(s, a.org_id)
        s.add(Course(organisation_id=a.org_id, slug=f"c-{uuid.uuid4().hex[:6]}", title="A only"))
        await s.commit()
    async with get_sessionmaker()() as s:
        await bind_tenant(s, b.org_id)
        titles = (await s.execute(select(Course.title))).scalars().all()
        assert "A only" not in titles
        # Writing a row for another tenant violates the WITH CHECK policy
        s.add(Course(organisation_id=a.org_id, slug="evil", title="Injected"))
        with pytest.raises(DBAPIError):
            await s.flush()
        await s.rollback()
    async with get_sessionmaker()() as s:
        # No tenant bound at all => fail closed
        await bind_tenant(s, None)
        assert (await s.execute(select(Course))).scalars().all() == []


async def test_membership_required_for_org_header(client):
    a = await signup(client, org_name="Org One")
    b = await signup(client, org_name="Org Two")
    r = await client.get("/api/v1/me", headers={**a.headers, "X-Organisation-Id": str(b.org_id)})
    assert r.status_code == 403


async def test_learner_has_limited_permissions(client):
    admin = await signup(client)
    learner = await add_member(admin.org_id, "learner")
    perms = (await client.get("/api/v1/me", headers=learner.headers)).json()["permissions"]
    assert perms == ["courses.view", "learning.access"]


async def test_audit_log_is_append_only_and_chained(client):
    acct = await signup(client)
    async with get_sessionmaker()() as s:
        await bind_tenant(s, acct.org_id)
        await write_audit(s, action="test.one", organisation_id=acct.org_id, actor_user_id=acct.user_id)
        await write_audit(s, action="test.two", organisation_id=acct.org_id, actor_user_id=acct.user_id)
        await s.commit()
        result = await verify_chain(s, acct.org_id)
        assert result["valid"] and result["checked"] >= 3  # includes user.registered
    async with get_sessionmaker()() as s:
        with pytest.raises(DBAPIError):
            await s.execute(text("UPDATE audit_logs SET action = 'tampered'"))
        await s.rollback()
        with pytest.raises(DBAPIError):
            await s.execute(text("DELETE FROM audit_logs"))
        await s.rollback()
