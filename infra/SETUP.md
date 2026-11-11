# DEFCON Zero - Server Setup

## 1. Environment

Verified on 9 November 2026.

- OS: Ubuntu 24.04.5 LTS (WSL2)
- CPU: Intel Core i7-9850H
- Python: 3.14.10
- PostgreSQL: 18.6
- Node.js: 24.22.2
- Git: 2.43.0

## 2. Verify system packages

```bash
python3.14 --version
psql --version
node --version
git --version
pg_lsclusters
sudo -u postgres psql -c "SELECT version();"
```

If PostgreSQL is stopped:

```bash
sudo service postgresql start
```

## 3. Project setup

```bash
cd ~
git clone <YOUR_REPOSITORY_URL> defcon-zero
cd ~/defcon-zero
git switch -c infra/server origin/main
```

Create and activate the virtual environment:

```bash
python3.14 -m venv .venv
source .venv/bin/activate
```

Install backend dependencies:

```bash
cd ~/defcon-zero/backend
pip install --upgrade pip
pip install -r requirements.txt
```

Install frontend dependencies:

```bash
cd ~/defcon-zero/frontend
npm ci
```

## 4. PostgreSQL configuration

Generate a password:

```bash
DB_PASS="$(python3.14 -c 'import secrets; print(secrets.token_urlsafe(32))')"
```

For a fresh PostgreSQL installation:

```bash
sudo -u postgres psql -v dbpass="$DB_PASS" <<'SQL'
CREATE ROLE defcon_app LOGIN PASSWORD :'dbpass';
CREATE DATABASE defcon OWNER defcon_app;
CREATE DATABASE defcon_test OWNER defcon_app;
SQL
```

If the role or databases already exist, inspect ownership and reuse them. Synchronize the role password:

```bash
sudo -u postgres psql -v dbpass="$DB_PASS" <<'SQL'
ALTER ROLE defcon_app PASSWORD :'dbpass';
SQL
```

Verify ownership:

```bash
sudo -u postgres psql -c "
SELECT rolname, rolcanlogin
FROM pg_roles
WHERE rolname = 'defcon_app';

SELECT datname, pg_get_userbyid(datdba) AS owner
FROM pg_database
WHERE datname IN ('defcon', 'defcon_test');
"
```

Verify authentication:

```bash
PGPASSWORD="$DB_PASS" psql -h localhost -U defcon_app -d defcon \
  -c "SELECT current_database(), current_user;"

PGPASSWORD="$DB_PASS" psql -h localhost -U defcon_app -d defcon_test \
  -c "SELECT current_database(), current_user;"
```

## 5. Backend environment

Generate a JWT secret:

```bash
JWT_SECRET="$(python3.14 -c 'import secrets; print(secrets.token_urlsafe(64))')"
```

Create `backend/.env`:

```bash
umask 077
cat > backend/.env <<EOF_ENV
DATABASE_URL=postgresql+asyncpg://defcon_app:${DB_PASS}@localhost:5432/defcon
TEST_DATABASE_URL=postgresql+asyncpg://defcon_app:${DB_PASS}@localhost:5432/defcon_test
JWT_SECRET=${JWT_SECRET}
CORS_ORIGINS=http://YOUR-LAN-IP:5173
EOF_ENV

chmod 600 backend/.env
unset DB_PASS JWT_SECRET
```

Replace `YOUR-LAN-IP` during production configuration.

Never commit `.env`, passwords, secrets, or account CSV files.

Verify:

```bash
git check-ignore backend/.env
```

## 6. Backend tests

From the backend directory with the virtual environment active:

```bash
cd ~/defcon-zero/backend
pytest -v
```

Verified result:

```text
332 passed in 387.63s
```

## 7. Linux engine memory-limit tests

From the repository root:

```bash
cd ~/defcon-zero
python -m pytest -v engine/test_memory_limits.py
```

Verified Linux result:

```text
2 passed, 1 skipped in 0.62s
```

The skipped test is the macOS-only fallback test. Both Linux memory-limit tests passed.

## 8. Git and security checks

```bash
git check-ignore backend/.env
git status --short
```

Before committing, verify that only intended files under `infra/` are staged.

Never stage `.env`, credentials, secrets, or account CSV files.

## 9. Production backend rule

Run exactly one backend process:

```bash

uvicorn app.main:app --host 0.0.0.0 --port 8002

```

Do not use --reload or multiple workers in production.
