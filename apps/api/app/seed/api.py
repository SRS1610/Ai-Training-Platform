"""In-process HTTP client used by the seeder: every business action goes through the real API (ASGI
transport, Bearer token + ``X-Organisation-Id``), exactly like the web app or a mobile client would."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Any

from httpx import ASGITransport, AsyncClient

API = "/api/v1"


class SeedError(RuntimeError):
    """An API call made by the seeder failed (the seed data or an API contract is wrong)."""


@dataclass
class Actor:
    """A signed-in user acting in one organisation."""

    email: str
    full_name: str
    user_id: uuid.UUID
    token: str
    org_id: uuid.UUID | None = None
    roles: tuple[str, ...] = ()
    meta: dict[str, Any] = field(default_factory=dict)

    @property
    def headers(self) -> dict[str, str]:
        h = {"Authorization": f"Bearer {self.token}"}
        if self.org_id:
            h["X-Organisation-Id"] = str(self.org_id)
        return h

    def in_org(self, org_id: uuid.UUID) -> Actor:
        return Actor(self.email, self.full_name, self.user_id, self.token, org_id, self.roles, self.meta)


class Api:
    """Thin wrapper: raises :class:`SeedError` with the response body on unexpected status codes."""

    def __init__(self, client: AsyncClient) -> None:
        self.client = client
        self.calls = 0

    @classmethod
    def in_process(cls) -> Api:
        from app.main import app

        return cls(AsyncClient(transport=ASGITransport(app=app), base_url="http://seed.local", timeout=120))

    async def aclose(self) -> None:
        await self.client.aclose()

    async def request(
        self,
        method: str,
        path: str,
        actor: Actor | None = None,
        *,
        json: Any = None,
        params: dict[str, Any] | None = None,
        files: Any = None,
        data: Any = None,
        expect: tuple[int, ...] = (200, 201, 202, 204),
    ) -> Any:
        self.calls += 1
        r = await self.client.request(
            method,
            API + path,
            json=json,
            params=params,
            files=files,
            data=data,
            headers=actor.headers if actor else None,
        )
        # Login / register set auth cookies; the seeder authenticates with Bearer tokens only.
        self.client.cookies.clear()
        if r.status_code not in expect:
            raise SeedError(f"{method} {path} -> {r.status_code}: {r.text[:1500]}")
        if r.status_code == 204 or not r.content:
            return None
        return r.json()

    async def get(self, path: str, actor: Actor | None = None, **kw: Any) -> Any:
        return await self.request("GET", path, actor, **kw)

    async def post(self, path: str, actor: Actor | None = None, json: Any = None, **kw: Any) -> Any:
        return await self.request("POST", path, actor, json=json, **kw)

    async def put(self, path: str, actor: Actor | None = None, json: Any = None, **kw: Any) -> Any:
        return await self.request("PUT", path, actor, json=json, **kw)

    async def patch(self, path: str, actor: Actor | None = None, json: Any = None, **kw: Any) -> Any:
        return await self.request("PATCH", path, actor, json=json, **kw)

    # ------------------------------------------------------------------------------------------ auth

    async def register(self, email: str, password: str, full_name: str, org_name: str | None) -> Actor:
        body: dict[str, Any] = {"email": email, "password": password, "full_name": full_name}
        if org_name:
            body["organisation_name"] = org_name
        tok = await self.post("/auth/register", json=body, expect=(201,))
        actor = Actor(email, full_name, uuid.UUID(tok["user_id"]), tok["access_token"])
        me = await self.get("/me", actor)
        actor.org_id = uuid.UUID(me["organisation"]["id"])
        return actor

    async def login(
        self, email: str, password: str, full_name: str = "", org_id: uuid.UUID | None = None
    ) -> Actor:
        out = await self.post(
            "/auth/login", json={"email": email, "password": password, "device_label": "Praxis demo seeder"}
        )
        tok = out["tokens"]
        return Actor(email, full_name or email, uuid.UUID(tok["user_id"]), tok["access_token"], org_id)
