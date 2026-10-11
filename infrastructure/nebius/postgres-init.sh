#!/bin/sh
# Runs once on first boot of the Postgres volume. The app connects as a
# NON-superuser role that owns the database: superusers bypass row-level
# security, and Dira's tenant isolation depends on RLS being enforced.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
CREATE ROLE dira_app LOGIN PASSWORD '${DIRA_APP_DB_PASSWORD}' NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;
CREATE DATABASE dira OWNER dira_app;
SQL
