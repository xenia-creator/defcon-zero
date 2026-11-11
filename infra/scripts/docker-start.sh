#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="infra/.env.docker"
COMPOSE_FILE="infra/compose.yaml"

if [[ ! -f "$ENV_FILE" ]]; then
    echo "ERROR: $ENV_FILE not found."
    exit 1
fi

compose() {
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

echo "Validating Docker Compose configuration..."
compose config --quiet

echo
echo "Starting PostgreSQL..."
compose up -d db

DB_CONTAINER="$(compose ps -q db)"

if [[ -z "$DB_CONTAINER" ]]; then
    echo "ERROR: PostgreSQL container was not created."
    exit 1
fi

echo "Waiting for PostgreSQL to become healthy..."

DB_STATUS=""

for attempt in {1..60}; do
    DB_STATUS="$(docker inspect \
        --format '{{.State.Health.Status}}' \
        "$DB_CONTAINER" 2>/dev/null || true)"

    if [[ "$DB_STATUS" == "healthy" ]]; then
        break
    fi

    if [[ "$DB_STATUS" == "unhealthy" ]]; then
        echo "ERROR: PostgreSQL is unhealthy."
        exit 1
    fi

    sleep 2
done

if [[ "$DB_STATUS" != "healthy" ]]; then
    echo "ERROR: PostgreSQL did not become healthy within 120 seconds."
    exit 1
fi

echo "PostgreSQL is healthy."

echo
echo "Building backend image..."
compose build backend

echo
echo "Applying database migrations..."
compose run --rm --no-deps backend alembic upgrade head

echo
echo "Initializing application rounds..."
compose run --rm --no-deps backend python -m scripts.create_rounds

echo
echo "Starting backend and frontend..."
compose up -d backend frontend

echo
echo "Current service status:"
compose ps

echo
echo "Startup sequence completed."
