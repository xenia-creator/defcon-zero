#!/usr/bin/env bash

set -Eeuo pipefail

INTERVAL="${1:-1}"

if ! [[ "$INTERVAL" =~ ^[1-9][0-9]*$ ]]; then
    echo "Usage: $0 [interval_in_seconds]"
    exit 1
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

COMPOSE=(docker compose --env-file infra/.env.docker -f infra/compose.yaml)

CONTAINER_ID="$("${COMPOSE[@]}" ps -q backend)"

if [[ -z "$CONTAINER_ID" ]]; then
    echo "ERROR: Backend container is not running."
    exit 1
fi

CONTAINER_NAME="$(docker inspect --format '{{.Name}}' "$CONTAINER_ID" | sed 's#^/##')"

OUTPUT="/tmp/defcon-pid-usage-$(date +%Y%m%d-%H%M%S).csv"

PEAK=0
SAMPLES=0

printf 'timestamp,container,pids\n' > "$OUTPUT"

echo "PID monitoring started"
echo "Container: $CONTAINER_NAME"
echo "Interval:  ${INTERVAL}s"
echo "CSV file:  $OUTPUT"
echo "Press Ctrl+C to stop."
echo

cleanup() {
    echo
    echo "Monitoring stopped."
    echo "Samples collected: $SAMPLES"
    echo "Peak observed PIDs: $PEAK"
    echo "Results saved to: $OUTPUT"
    exit 0
}

trap cleanup INT TERM

while true; do
    TIMESTAMP="$(date --iso-8601=seconds)"

    PIDS="$(docker stats --no-stream --format '{{.PIDs}}' "$CONTAINER_ID" 2>/dev/null | tr -d '[:space:]' || true)"

    if [[ "$PIDS" =~ ^[0-9]+$ ]]; then
        printf '%s,%s,%s\n' "$TIMESTAMP" "$CONTAINER_NAME" "$PIDS" >> "$OUTPUT"

        if (( PIDS > PEAK )); then
            PEAK="$PIDS"
        fi

        SAMPLES=$((SAMPLES + 1))
        echo "[$TIMESTAMP] PIDs: $PIDS | Peak: $PEAK"
    else
        echo "[$TIMESTAMP] WARNING: Could not read PID count."
    fi

    sleep "$INTERVAL"
done
