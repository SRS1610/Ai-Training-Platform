-- Runs once on first container start (as superuser). The application connects as the non-superuser
-- role "praxis" so PostgreSQL row-level security policies are enforced.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'praxis') THEN
    CREATE ROLE praxis LOGIN PASSWORD 'praxis' NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
ALTER DATABASE praxis OWNER TO praxis;
ALTER SCHEMA public OWNER TO praxis;
