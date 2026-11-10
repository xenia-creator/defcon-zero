# DEFCON Zero: Event Day Runbook

Run all commands from the repository root.

## 1. Pre-event checks

```bash
test -f infra/.env.docker
docker compose --env-file infra/.env.docker -f infra/compose.yaml config --quiet
docker compose --env-file infra/.env.docker -f infra/compose.yaml ps
```

## 2. Back up both databases

```bash
bash infra/scripts/docker-backup.sh
```

Confirm both `defcon` and `defcon_test` backups report VALID. Do not continue if either backup fails.

## 3. Stop the application

```bash
docker compose --env-file infra/.env.docker -f infra/compose.yaml stop backend frontend
```

Keep PostgreSQL running.

## 4. Reset event data

WARNING: This permanently deletes matches, standings, submissions, teams, and team accounts. Organiser accounts are preserved.

```bash
docker compose --env-file infra/.env.docker -f infra/compose.yaml run --rm --no-deps backend python -m scripts.reset_event --yes --delete-team-accounts
```

Verify that the printed database name is `defcon`.

Create the tournament rounds:

```bash
docker compose --env-file infra/.env.docker -f infra/compose.yaml run --rm --no-deps backend python -m scripts.create_rounds
```

## 5. Set organiser passwords

Run once for each existing organiser account:

```bash
docker compose --env-file infra/.env.docker -f infra/compose.yaml run --rm --no-deps backend python -m scripts.set_password ACTUAL_ORGANISER_USERNAME
```

Replace the placeholder with the actual organiser username. The script prompts for the password twice.

## 6. Create team accounts

Prepare the real account CSV outside the repository.

Required format:

```csv
username,password,role
team_alpha,REPLACE_WITH_PASSWORD,team
team_beta,REPLACE_WITH_PASSWORD,team
```

Never commit the CSV or expose its passwords.

Mount the CSV read-only into a temporary backend container:

```bash
docker compose --env-file infra/.env.docker -f infra/compose.yaml run --rm --no-deps -v /absolute/path/to/real-users.csv:/tmp/real-users.csv:ro backend python -m scripts.create_users /tmp/real-users.csv
```

Replace the example path with the actual absolute path. Verify that the printed database name is `defcon`. Existing usernames are skipped.


## 7. Configure event network access

Update these values in `infra/.env.docker` using the event server's actual LAN IP:

```dotenv
HOST_BIND_ADDRESS=0.0.0.0
VITE_API_URL=http://YOUR_LAN_IP:8002
CORS_ORIGINS=http://YOUR_LAN_IP:5173
```

Rebuild the frontend because `VITE_API_URL` is baked in at build time:

```bash
docker compose --env-file infra/.env.docker -f infra/compose.yaml build frontend
```

Do not commit the actual LAN IP or `.env.docker`.


## 8. Start the application

```bash
docker compose --env-file infra/.env.docker -f infra/compose.yaml up -d backend frontend
```

## 9. Verify service health

```bash
docker compose --env-file infra/.env.docker -f infra/compose.yaml ps
curl --fail http://127.0.0.1:8002/health
curl --fail --head http://127.0.0.1:5173/
```

Confirm both services are healthy and test organiser login before announcing readiness.

## 10. Safety rules

- Never commit environment files, account CSV files, passwords, or backups.
- Keep PostgreSQL port 5432 private.
- Run only one persistent backend instance.
- Never use Uvicorn reload mode in production.
- Stop backend and frontend during the event reset.
- Verify the target database before destructive operations.
- Always retain verified backups.
