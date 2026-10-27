#!/usr/bin/env bash
# Local stand-in for Supabase, for tests only: Postgres 16 + PostgREST behind a small proxy
# that serves /rest/v1 the way Supabase's API gateway does (scripts/local-db/proxy.mjs).
#
#   scripts/local-db/start.sh           start it (or reuse what is already running) and apply
#                                       any new or changed supabase/migrations/*.sql
#   scripts/local-db/start.sh --reset   drop the database, recreate it, apply every migration
#   scripts/local-db/stop.sh            stop the proxy, PostgREST and Postgres
#
# Everything lives in .local-db/ (gitignored): the cluster, the PostgREST binary, logs,
# local-only test keys and .local-db/env (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
# SUPABASE_ANON_KEY, LOCAL_DB_URL) for the tests and the app. Invented test data only.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE="$ROOT/.local-db"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGDATA="$STATE/pgdata"
SOCK="$STATE/run"
BIN="$STATE/bin"
SECRETS="$STATE/secrets"
ENV_FILE="$STATE/env"
PGRST_CONF="$STATE/postgrest.conf"
PROXY="$ROOT/scripts/local-db/proxy.mjs"

PG_PORT=54322
API_PORT=54321
PGRST_PORT=3001
PGRST_ADMIN_PORT=3002
DB=postgres

PGRST_VERSION=v13.0.8
PGRST_TARBALL="postgrest-$PGRST_VERSION-linux-static-x86-64.tar.xz"
PGRST_URL="https://github.com/PostgREST/postgrest/releases/download/$PGRST_VERSION/$PGRST_TARBALL"
PGRST_SHA256=eb4471a7b8112a54e103539f2348c4d7f1c5b9b390649700ad62836e9211e279

RESET=0
for arg in "$@"; do
  case "$arg" in
    --reset) RESET=1 ;;
    -h | --help) sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg (use --reset or --help)" >&2; exit 2 ;;
  esac
done

say() { printf '[local-db] %s\n' "$*"; }
die() { printf '[local-db] ERROR: %s\n' "$*" >&2; exit 1; }

# Postgres refuses to run as root: when root, run it as the "postgres" OS user.
if [ "$(id -u)" = 0 ]; then
  id postgres >/dev/null 2>&1 || die "there is no 'postgres' OS user to run Postgres as"
  PG_OS_USER=postgres
  as_pg() { runuser -u postgres -- "$@"; }
else
  PG_OS_USER="$(id -un)"
  as_pg() { "$@"; }
fi

for b in initdb pg_ctl psql; do
  [ -x "$PGBIN/$b" ] || die "missing $PGBIN/$b (install PostgreSQL 16, or set PGBIN)"
done
for c in node curl tar xz sha256sum setsid; do
  command -v "$c" >/dev/null 2>&1 || die "missing command: $c"
done

cd "$ROOT" # the postgres OS user must be able to read the working directory
umask 077  # every file written here is private to its owner

# psql as the database superuser over the private socket. SQL always comes in on stdin (or -c),
# so files are read by this shell, not by the postgres OS user.
pg() { as_pg "$PGBIN/psql" -X -q -v ON_ERROR_STOP=1 -h "$SOCK" -p "$PG_PORT" -U postgres "$@"; }

pid_alive() { # pidfile marker: true when the pid in the file is running a command line holding marker
  local pid
  [ -f "$1" ] || return 1
  pid="$(cat "$1" 2>/dev/null || true)"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  [ -r "/proc/$pid/cmdline" ] || return 0
  tr '\0' ' ' <"/proc/$pid/cmdline" | grep -qF -- "$2"
}

stop_pid() { # pidfile marker label
  if pid_alive "$1" "$2"; then
    local pid i
    pid="$(cat "$1")"
    kill "$pid" 2>/dev/null || true
    for ((i = 0; i < 40; i++)); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.25
    done
    if kill -0 "$pid" 2>/dev/null; then kill -9 "$pid" 2>/dev/null || true; fi
    say "stopped $3"
  fi
  rm -f "$1"
}

launch() { # pidfile logfile command...: runs in its own session, survives this shell
  local pidf="$1" log="$2"
  shift 2
  setsid bash -c 'echo $$ > "$0"; exec "$@"' "$pidf" "$@" >>"$log" 2>&1 </dev/null &
}

wait_http() { # url seconds [curl args...]
  local url="$1" secs="$2" i
  shift 2
  for ((i = 0; i < secs * 4; i++)); do
    if curl -fsS --noproxy '*' -o /dev/null --max-time 2 "$@" "$url" 2>/dev/null; then return 0; fi
    sleep 0.25
  done
  return 1
}

http_status() { # url apikey
  curl -s --noproxy '*' -o /dev/null -w '%{http_code}' --max-time 5 -H "apikey: $2" "$1" || true
}

# --- Local-only test keys (made once, kept in .local-db/secrets) -----------------------------
mkdir -p "$STATE" "$BIN"
chmod 711 "$STATE" # the postgres OS user may pass through to pgdata/ and run/, not list it
if [ ! -s "$SECRETS" ]; then
  node -e '
    const r = () => require("node:crypto").randomBytes(32).toString("hex");
    process.stdout.write(`JWT_SECRET=${r()}\nPG_PASSWORD=${r()}\nAUTHENTICATOR_PASSWORD=${r()}\n`);
  ' >"$SECRETS.tmp"
  mv "$SECRETS.tmp" "$SECRETS"
  say "made local-only test keys in .local-db/secrets"
fi
# shellcheck source=/dev/null
. "$SECRETS"
for v in JWT_SECRET PG_PASSWORD AUTHENTICATOR_PASSWORD; do
  [[ "${!v:-}" =~ ^[0-9a-f]{64}$ ]] || die ".local-db/secrets is damaged ($v); delete it and run start.sh --reset"
done

# --- Postgres cluster ------------------------------------------------------------------------
if [ ! -f "$PGDATA/PG_VERSION" ]; then
  if [ -d "$PGDATA" ] && [ -n "$(ls -A "$PGDATA" 2>/dev/null)" ]; then
    die ".local-db/pgdata exists but is not a Postgres cluster; delete it and run start.sh again"
  fi
  say "creating a Postgres 16 cluster in .local-db/pgdata"
  mkdir -p "$PGDATA" "$SOCK"
  chown "$PG_OS_USER" "$PGDATA" "$SOCK"
  chmod 700 "$PGDATA" "$SOCK"
  pwfile="$SOCK/initdb-password"
  printf '%s\n' "$PG_PASSWORD" >"$pwfile"
  chown "$PG_OS_USER" "$pwfile"
  if ! as_pg "$PGBIN/initdb" -D "$PGDATA" -U postgres --pwfile="$pwfile" \
    --auth-local=trust --auth-host=scram-sha-256 --encoding=UTF8 --locale=C.UTF-8 \
    >"$STATE/initdb.log" 2>&1; then
    rm -f "$pwfile"
    die "initdb failed (see .local-db/initdb.log)"
  fi
  rm -f "$pwfile"
  cat >>"$PGDATA/postgresql.conf" <<EOF

# --- Scorecard local test database (scripts/local-db/start.sh) ---
listen_addresses = '127.0.0.1'
port = $PG_PORT
unix_socket_directories = '$SOCK'
timezone = 'UTC'
log_timezone = 'UTC'
synchronous_commit = off
# Keep row values out of the log: no failing statements, no DETAIL lines.
log_min_error_statement = panic
log_error_verbosity = terse
EOF
fi
# Local socket connections are "trust": only the owner of this 0700 folder can reach the socket.
mkdir -p "$SOCK"
chown "$PG_OS_USER" "$SOCK"
chmod 700 "$SOCK"
touch "$STATE/postgres.log"
chown "$PG_OS_USER" "$STATE/postgres.log"

if as_pg "$PGBIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1; then
  say "Postgres is already running on 127.0.0.1:$PG_PORT"
else
  say "starting Postgres on 127.0.0.1:$PG_PORT"
  as_pg "$PGBIN/pg_ctl" -D "$PGDATA" -l "$STATE/postgres.log" -w -t 60 start >/dev/null ||
    die "Postgres did not start (see .local-db/postgres.log)"
fi

# --- Supabase's roles (cluster-wide; safe to repeat) ------------------------------------------
LOCAL_DB_AUTH_PW="$AUTHENTICATOR_PASSWORD" pg -d template1 <<'SQL'
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator; end if;
end $$;
alter role anon nologin noinherit;
alter role authenticated nologin noinherit;
alter role service_role nologin noinherit bypassrls;
\getenv auth_pw LOCAL_DB_AUTH_PW
alter role authenticator login noinherit password :'auth_pw';
\unset auth_pw
set client_min_messages = warning;
grant anon, authenticated, service_role to authenticator;
alter role anon set statement_timeout = '3s';
alter role authenticated set statement_timeout = '8s';
alter role postgres set search_path = "$user", public, extensions;
SQL

# --- The database ----------------------------------------------------------------------------
if [ "$RESET" = 1 ]; then
  stop_pid "$STATE/postgrest.pid" "$BIN/postgrest" "PostgREST"
  say "--reset: dropping and recreating the database"
  pg -d template1 -c "drop database if exists $DB with (force)"
fi
if [ "$(pg -d template1 -At -c "select count(*) from pg_database where datname = '$DB'")" = 0 ]; then
  pg -d template1 -c "create database $DB"
fi

# Once per database, before any migration: what a new Supabase project already has. Supabase
# grants everything on new public tables, sequences and functions to anon, authenticated and
# service_role by default, so the migrations' own revokes are what keeps them out. This runs only
# on a new database, so a later migration that changes these defaults is never undone here.
if [ "$(pg -d "$DB" -At -c "select count(*) from pg_namespace where nspname = 'supabase_migrations'")" = 0 ]; then
  say "setting up the database like a new Supabase project"
  pg -d "$DB" -1 -f - <<'SQL'
set client_min_messages = warning;
create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;

-- Supabase reloads PostgREST's schema cache after every schema change (same event triggers).
create or replace function extensions.pgrst_ddl_watch() returns event_trigger
language plpgsql as $$
declare cmd record;
begin
  for cmd in select * from pg_event_trigger_ddl_commands() loop
    if cmd.command_tag in (
      'CREATE SCHEMA', 'ALTER SCHEMA', 'CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO', 'ALTER TABLE',
      'CREATE FOREIGN TABLE', 'ALTER FOREIGN TABLE', 'CREATE VIEW', 'ALTER VIEW',
      'CREATE MATERIALIZED VIEW', 'ALTER MATERIALIZED VIEW', 'CREATE FUNCTION', 'ALTER FUNCTION',
      'CREATE TRIGGER', 'CREATE TYPE', 'ALTER TYPE', 'CREATE RULE', 'COMMENT'
    ) and cmd.schema_name is distinct from 'pg_temp' then
      notify pgrst, 'reload schema';
    end if;
  end loop;
end $$;
create or replace function extensions.pgrst_drop_watch() returns event_trigger
language plpgsql as $$
declare obj record;
begin
  for obj in select * from pg_event_trigger_dropped_objects() loop
    if obj.object_type in ('schema', 'table', 'foreign table', 'view', 'materialized view',
                           'function', 'trigger', 'type', 'rule')
       and obj.is_temporary is false then
      notify pgrst, 'reload schema';
    end if;
  end loop;
end $$;
do $$
begin
  if not exists (select 1 from pg_event_trigger where evtname = 'pgrst_ddl_watch') then
    create event trigger pgrst_ddl_watch on ddl_command_end execute procedure extensions.pgrst_ddl_watch();
  end if;
  if not exists (select 1 from pg_event_trigger where evtname = 'pgrst_drop_watch') then
    create event trigger pgrst_drop_watch on sql_drop execute procedure extensions.pgrst_drop_watch();
  end if;
end $$;

-- Which migration files were applied, and their checksums (not exposed through the API).
create schema supabase_migrations;
create table supabase_migrations.schema_migrations (
  name text primary key,
  sha256 text not null,
  applied_at timestamptz not null default now()
);
SQL
fi

# --- Migrations, in name order: new files, and files that changed since they were applied -----
MIGRATED=0
shopt -s nullglob
migrations=()
while IFS= read -r f; do migrations+=("$f"); done < <(printf '%s\n' "$ROOT"/supabase/migrations/*.sql | LC_ALL=C sort)
shopt -u nullglob
[ "${#migrations[@]}" -gt 0 ] && [ -n "${migrations[0]}" ] || die "no supabase/migrations/*.sql files found"
for f in "${migrations[@]}"; do
  name="$(basename "$f")"
  [[ "$name" =~ ^[0-9]+_[A-Za-z0-9_-]+\.sql$ ]] || die "unexpected migration file name: $name"
  sha="$(sha256sum "$f" | cut -d' ' -f1)"
  old="$(pg -d "$DB" -At -c "select sha256 from supabase_migrations.schema_migrations where name = '$name'")"
  [ "$old" = "$sha" ] && continue
  if [ -n "$old" ]; then
    say "$name changed since it was applied: applying it again (start.sh --reset gives a clean database)"
  else
    say "applying $name"
  fi
  # One transaction per file, like `supabase db push`: a failing file leaves nothing behind.
  printf '== %s %s (stdin below is this file) ==\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$name" >>"$STATE/migrate.log"
  if ! pg -d "$DB" -1 -f - \
    -c "insert into supabase_migrations.schema_migrations (name, sha256) values ('$name', '$sha')
        on conflict (name) do update set sha256 = excluded.sha256, applied_at = now()" \
    <"$f" >>"$STATE/migrate.log" 2>&1; then
    grep -E 'ERROR|FATAL' "$STATE/migrate.log" | tail -n 5 >&2 || true
    die "$name failed to apply (nothing from it was kept; full output in .local-db/migrate.log)"
  fi
  MIGRATED=1
done
[ "$MIGRATED" = 1 ] || say "migrations are up to date"

# --- PostgREST (official static build from GitHub releases, checksum pinned) -----------------
if ! { [ -x "$BIN/postgrest" ] && "$BIN/postgrest" --version 2>/dev/null | grep -qF "${PGRST_VERSION#v}"; }; then
  [ "$(uname -m)" = x86_64 ] || die "this script fetches the linux x64 PostgREST build; this machine is $(uname -m)"
  say "downloading PostgREST $PGRST_VERSION from GitHub releases"
  dl="$(mktemp -d "$STATE/download.XXXXXX")"
  if ! curl -fsSL --retry 3 --connect-timeout 20 -o "$dl/$PGRST_TARBALL" "$PGRST_URL"; then
    rm -rf "$dl"
    die "could not download $PGRST_URL (is github.com blocked on this network? The other official
       source is the postgrest/postgrest image on Docker Hub; this script does not fall back to it)"
  fi
  got="$(sha256sum "$dl/$PGRST_TARBALL" | cut -d' ' -f1)"
  if [ "$got" != "$PGRST_SHA256" ]; then
    rm -rf "$dl"
    die "PostgREST download has the wrong checksum ($got); not using it"
  fi
  mkdir "$dl/x"
  tar -xJf "$dl/$PGRST_TARBALL" -C "$dl/x" postgrest
  install -m 0700 "$dl/x/postgrest" "$BIN/postgrest"
  rm -rf "$dl"
fi

conf="db-uri = \"postgres://authenticator:$AUTHENTICATOR_PASSWORD@127.0.0.1:$PG_PORT/$DB\"
db-schemas = \"public\"
db-anon-role = \"anon\"
db-extra-search-path = \"public, extensions\"
db-max-rows = 1000
db-channel-enabled = true
jwt-secret = \"$JWT_SECRET\"
server-host = \"127.0.0.1\"
server-port = $PGRST_PORT
admin-server-port = $PGRST_ADMIN_PORT
log-level = \"error\""
CONF_CHANGED=0
if [ ! -f "$PGRST_CONF" ] || [ "$(cat "$PGRST_CONF")" != "$conf" ]; then
  printf '%s\n' "$conf" >"$PGRST_CONF"
  CONF_CHANGED=1
fi

if pid_alive "$STATE/postgrest.pid" "$BIN/postgrest" && [ "$CONF_CHANGED" = 1 ]; then
  say "PostgREST settings changed: restarting it"
  stop_pid "$STATE/postgrest.pid" "$BIN/postgrest" "PostgREST"
fi
if pid_alive "$STATE/postgrest.pid" "$BIN/postgrest"; then
  say "PostgREST is already running on 127.0.0.1:$PGRST_PORT"
  if [ "$MIGRATED" = 1 ]; then
    pg -d "$DB" -c "notify pgrst, 'reload schema'"
    sleep 1
  fi
else
  say "starting PostgREST on 127.0.0.1:$PGRST_PORT"
  launch "$STATE/postgrest.pid" "$STATE/postgrest.log" "$BIN/postgrest" "$PGRST_CONF"
  sleep 0.5
fi
wait_http "http://127.0.0.1:$PGRST_ADMIN_PORT/ready" 30 && pid_alive "$STATE/postgrest.pid" "$BIN/postgrest" ||
  die "PostgREST is not ready (see .local-db/postgrest.log; is port $PGRST_PORT or $PGRST_ADMIN_PORT taken?)"

# --- API keys: HS256 JWTs signed with the local secret (fixed claims, so they never change) ----
make_jwt() {
  LOCAL_DB_JWT_SECRET="$JWT_SECRET" node -e '
    const crypto = require("node:crypto");
    const part = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const head = part({ alg: "HS256", typ: "JWT" });
    const body = part({ iss: "supabase-local", role: process.argv[1], iat: 1700000000, exp: 2000000000 });
    const sig = crypto.createHmac("sha256", process.env.LOCAL_DB_JWT_SECRET).update(`${head}.${body}`).digest("base64url");
    process.stdout.write(`${head}.${body}.${sig}`);
  ' "$1"
}
SERVICE_KEY="$(make_jwt service_role)"
ANON_KEY="$(make_jwt anon)"
envtext="# Local test database (scripts/local-db/start.sh). Local-only test keys: never use them elsewhere.
SUPABASE_URL=http://127.0.0.1:$API_PORT
SUPABASE_SERVICE_ROLE_KEY=$SERVICE_KEY
SUPABASE_ANON_KEY=$ANON_KEY
LOCAL_DB_URL=postgresql://postgres:$PG_PASSWORD@127.0.0.1:$PG_PORT/$DB"
ENV_CHANGED=0
if [ ! -f "$ENV_FILE" ] || [ "$(cat "$ENV_FILE")" != "$envtext" ]; then
  printf '%s\n' "$envtext" >"$ENV_FILE"
  ENV_CHANGED=1
fi

# --- The /rest/v1 proxy ----------------------------------------------------------------------
if pid_alive "$STATE/proxy.pid" "$PROXY" && [ "$ENV_CHANGED" = 1 ]; then
  stop_pid "$STATE/proxy.pid" "$PROXY" "the proxy (keys changed)"
fi
if pid_alive "$STATE/proxy.pid" "$PROXY"; then
  say "proxy is already running on 127.0.0.1:$API_PORT"
else
  say "starting the /rest/v1 proxy on 127.0.0.1:$API_PORT"
  launch "$STATE/proxy.pid" "$STATE/proxy.log" node "$PROXY" "$ENV_FILE" "$PGRST_PORT"
  sleep 0.3
fi
wait_http "http://127.0.0.1:$API_PORT/rest/v1/" 15 -H "apikey: $SERVICE_KEY" && pid_alive "$STATE/proxy.pid" "$PROXY" ||
  die "the proxy is not answering (see .local-db/proxy.log; is port $API_PORT taken?)"

# --- Smoke check: the service key gets in, the anon key does not -------------------------------
svc="$(http_status "http://127.0.0.1:$API_PORT/rest/v1/agents?select=id&limit=1" "$SERVICE_KEY")"
anon="$(http_status "http://127.0.0.1:$API_PORT/rest/v1/agents?select=id&limit=1" "$ANON_KEY")"
[ "$svc" = 200 ] || die "service key could not read agents (HTTP $svc)"
case "$anon" in
  401 | 403) ;;
  *) die "the anon key was NOT refused on agents (HTTP $anon): check the migration's revokes" ;;
esac

say "ready: API http://127.0.0.1:$API_PORT/rest/v1 (PostgREST $PGRST_VERSION), Postgres 127.0.0.1:$PG_PORT"
say "env file: $ENV_FILE (also has LOCAL_DB_URL for psql). Stop with scripts/local-db/stop.sh"
printf 'SUPABASE_URL=http://127.0.0.1:%s\n' "$API_PORT"
printf 'SUPABASE_SERVICE_ROLE_KEY=%s\n' "$SERVICE_KEY"
printf 'SUPABASE_ANON_KEY=%s\n' "$ANON_KEY"
