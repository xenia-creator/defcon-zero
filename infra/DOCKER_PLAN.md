# Docker Deployment Plan

## 1. Objective

Containerize the DEFCON Zero application for deployment on a single
Linux Docker host, while keeping bot execution isolation as a separate
workstream.

All deployment configuration created for this work must remain under
`infra/`.

## 2. Application architecture

- Frontend: multi-stage Node 24 build, served by Nginx.
- Backend: Python 3.14 slim, FastAPI, Uvicorn.
- Database: PostgreSQL 18 with a persistent Docker volume.
- Frontend port: 5173.
- Backend port: 8002.
- PostgreSQL must not be exposed to the LAN.
- Frontend API URL must be configured at build time using VITE_API_URL.
- Backend CORS must allow the exact frontend origin.

The frontend uses root-relative API paths. Nginx will serve frontend
assets only; it will not rewrite or proxy API routes.

## 3. Backend runtime requirements

- Build context must be the repository root because backend imports
  the sibling engine package.
- Install dependencies from backend/requirements.txt.
- Run from /app/backend.
- Start exactly one Uvicorn process:
  uvicorn app.main:app --host 0.0.0.0 --port 8002
- Never use --reload or multiple Uvicorn workers.
- Run Alembic migrations explicitly before application startup.
- Initialize rounds using the existing create_rounds script.
- Health check: GET /health.

## 4. Database

- PostgreSQL 18.
- Persistent named volume.
- Internal application network only.
- Credentials supplied through environment variables or an
  uncommitted environment file.
- Alembic migrations run before backend startup.
- Round initialization runs before backend startup and is idempotent.
- Backup script covers both production and test databases.
- Backups are validated using pg_restore --list.
- Restore procedure tested successfully using a temporary recovery database.
- Backup files stored outside the repository with restricted permissions.

## 5. Resource and process considerations

The engine creates a multiprocessing pool sized using
min(number_of_matches, os.cpu_count()).

Backend submission checks use up to four threads. Tournament execution
uses one separate thread and can create a worker per CPU reported by
Python. Bot calls can spawn additional child processes.

Docker CPU quota and CPU affinity do not change Python's os.cpu_count()
in the tested environment. With a four-CPU quota and four-CPU affinity,
Python still reported 12 CPUs.

Therefore:
- Do not assume a four-CPU quota limits engine worker count to four.
- Initial CPU and memory limits require load testing.
- An engine-side container-aware worker-count adjustment requires
  approval and implementation by the engine owner.
- No engine files will be changed as part of this infrastructure work.

## 6. Bot execution isolation

The current engine uses Python multiprocessing, not disposable Docker
containers. A separate Docker runner is a future integration.

Do not mount the Docker socket into the backend container or claim
container-level bot isolation until the engine owner confirms the
runner interface and security requirements.

## 7. Outstanding decisions

- Confirm runner interface and Python version with the engine owner.
- Confirm whether the backend needs Docker API access for runner
  integration.
- Confirm production resource limits through load testing.
- Confirm college LAN address and frontend API URL at deployment.
- Confirm production secrets and environment injection method.

## 8. Verified infrastructure

- Docker Compose configuration validated.
- Backend and frontend images build successfully.
- PostgreSQL health checks pass.
- Backend migrations execute before application startup.
- Round initialization handles existing rounds without duplication.
- Backend and frontend containers pass health checks.
- Frontend security headers verified on root and asset responses.
- Database backup and recovery tested successfully.
- PostgreSQL is not exposed through a host-published port.
- Frontend and backend ports are currently bound to localhost.

## 9. Deployment safety

- Keep secrets out of Git and Docker build contexts.
- Do not expose PostgreSQL to the LAN.
- Use one backend process only.
- Use health checks and restart policies.
- Do not delete existing Docker containers or images without
  confirming their ownership and purpose.
