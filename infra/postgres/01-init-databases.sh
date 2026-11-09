#!/bin/bash
set -euo pipefail

: "${APP_DB_PASSWORD:?APP_DB_PASSWORD must be set}"

echo "Creating application database role..."

psql \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set=ON_ERROR_STOP=1 \
  --set=app_password="$APP_DB_PASSWORD" <<'SQL'
CREATE ROLE defcon_app
    LOGIN
    PASSWORD :'app_password';
SQL

echo "Creating application databases..."

createdb \
  --username "$POSTGRES_USER" \
  --owner=defcon_app \
  defcon

createdb \
  --username "$POSTGRES_USER" \
  --owner=defcon_app \
  defcon_test

echo "Application databases initialized."
