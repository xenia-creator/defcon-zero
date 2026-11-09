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

echo "Stopping DEFCON Zero services..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" stop

echo
echo "Services stopped. Database volumes and data are preserved."
