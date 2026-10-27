#!/usr/bin/env bash
# Stops the local test database that scripts/local-db/start.sh started: the /rest/v1 proxy,
# PostgREST and Postgres. The data stays in .local-db/ (start.sh --reset wipes it).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE="$ROOT/.local-db"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGDATA="$STATE/pgdata"

say() { printf '[local-db] %s\n' "$*"; }

if [ "$(id -u)" = 0 ]; then
  as_pg() { runuser -u postgres -- "$@"; }
else
  as_pg() { "$@"; }
fi
cd "$ROOT"

pid_alive() { # pidfile marker
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
  else
    say "$3 was not running"
  fi
  rm -f "$1"
}

stop_pid "$STATE/proxy.pid" "$ROOT/scripts/local-db/proxy.mjs" "the proxy"
stop_pid "$STATE/postgrest.pid" "$STATE/bin/postgrest" "PostgREST"

if [ -f "$PGDATA/PG_VERSION" ] && as_pg "$PGBIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1; then
  as_pg "$PGBIN/pg_ctl" -D "$PGDATA" -m fast -w -t 60 stop >/dev/null
  say "stopped Postgres"
else
  say "Postgres was not running"
fi
