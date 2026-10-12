"""Import every model so that ``Base.metadata`` is complete (Alembic autogenerate, create_all)."""

from app.models.ai import *  # noqa: F403
from app.models.assessment import *  # noqa: F403
from app.models.assignment import *  # noqa: F403
from app.models.base import Base
from app.models.content import *  # noqa: F403
from app.models.identity import *  # noqa: F403
from app.models.learning import *  # noqa: F403
from app.models.platform import *  # noqa: F403
from app.models.simulation import *  # noqa: F403
from app.models.tenancy import *  # noqa: F403

__all__ = ["Base"]


def rls_tables() -> list[str]:
    """Names of tenant-scoped tables protected by PostgreSQL row-level security."""
    return sorted(
        mapper.class_.__tablename__
        for mapper in Base.registry.mappers
        if getattr(mapper.class_, "__rls__", False)
    )
