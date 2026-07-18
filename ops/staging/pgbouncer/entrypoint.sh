#!/bin/sh
set -eu

if [ -z "${POSTGRES_PASSWORD:-}" ]; then
  echo "POSTGRES_PASSWORD is required" >&2
  exit 64
fi

case "$POSTGRES_PASSWORD" in
  *[!A-Za-z0-9_-]*)
    echo "POSTGRES_PASSWORD must contain only letters, numbers, underscores, or hyphens" >&2
    exit 64
    ;;
esac

if [ "${#POSTGRES_PASSWORD}" -lt 32 ]; then
  echo "POSTGRES_PASSWORD must be at least 32 characters" >&2
  exit 64
fi

umask 077
chown pooler:pooler /run/pgbouncer
printf '"foodgood_staging" "%s"\n' "$POSTGRES_PASSWORD" > /run/pgbouncer/userlist.txt
chown pooler:pooler /run/pgbouncer/userlist.txt

exec su-exec pooler:pooler pgbouncer /etc/pgbouncer/pgbouncer.ini
