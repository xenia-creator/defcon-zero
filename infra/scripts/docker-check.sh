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

echo "========== Container Status =========="
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps

echo
echo "========== Backend Health =========="
curl --fail --silent --show-error http://localhost:8002/health
echo

echo
echo "========== Frontend Health =========="
curl --fail --silent --show-error --output /dev/null \
    --write-out "HTTP %{http_code}\n" http://localhost:5173/

echo
echo "========== Database Health =========="
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" \
    exec -T db pg_isready -U postgres

echo
echo "All infrastructure checks completed successfully."
