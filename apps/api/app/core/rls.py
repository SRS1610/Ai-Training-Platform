"""SQL for PostgreSQL row-level security and audit-log immutability. Used by Alembic migrations and tests."""

from __future__ import annotations

TENANT_PREDICATE = (
    "(current_setting('app.rls_bypass', true) = 'on' "
    "OR organisation_id = NULLIF(current_setting('app.org_id', true), '')::uuid)"
)


def rls_enable_sql(table: str) -> list[str]:
    return [
        f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY',
        f'ALTER TABLE "{table}" FORCE ROW LEVEL SECURITY',
        f'DROP POLICY IF EXISTS tenant_isolation ON "{table}"',
        f'CREATE POLICY tenant_isolation ON "{table}" USING {TENANT_PREDICATE} WITH CHECK {TENANT_PREDICATE}',
    ]


def rls_disable_sql(table: str) -> list[str]:
    return [
        f'DROP POLICY IF EXISTS tenant_isolation ON "{table}"',
        f'ALTER TABLE "{table}" NO FORCE ROW LEVEL SECURITY',
        f'ALTER TABLE "{table}" DISABLE ROW LEVEL SECURITY',
    ]


AUDIT_IMMUTABLE_SQL = [
    """
    CREATE OR REPLACE FUNCTION audit_logs_immutable() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'audit_logs is append-only';
    END;
    $$ LANGUAGE plpgsql
    """,
    "DROP TRIGGER IF EXISTS audit_logs_no_update ON audit_logs",
    "CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs "
    "FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable()",
    "DROP TRIGGER IF EXISTS audit_logs_no_truncate ON audit_logs",
    "CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs "
    "FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_immutable()",
]

CERTIFICATE_SEQUENCE_SQL = ["CREATE SEQUENCE IF NOT EXISTS certificate_number_seq START 100"]
