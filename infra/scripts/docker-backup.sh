#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="infra/.env.docker"
COMPOSE_FILE="infra/compose.yaml"
BACKUP_DIR="$HOME/defcon-backups/docker"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"

if [[ ! -f "$ENV_FILE" ]]; then
    echo "ERROR: $ENV_FILE not found."
    exit 1
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

backup_database() {
    local database="$1"
    local output="$BACKUP_DIR/${database}_${TIMESTAMP}.dump"
    local temporary="${output}.tmp"

    echo "Backing up $database..."

    if ! docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" \
        exec -T db pg_dump -U postgres -Fc "$database" > "$temporary"; then
        rm -f "$temporary"
        echo "ERROR: Backup failed for $database."
        return 1
    fi

    chmod 600 "$temporary"

    if ! pg_restore --list "$temporary" > /dev/null; then
        rm -f "$temporary"
        echo "ERROR: Backup validation failed for $database."
        return 1
    fi

    mv "$temporary" "$output"
    echo "VALID: $output"
}

backup_database defcon
backup_database defcon_test

echo
echo "Both database backups completed and validated."
