#!/usr/bin/env sh
# Creates server/deploy/.env.prod from .env.prod.example with fresh random
# secrets. Refuses to overwrite an existing file (rotating secrets logs every
# player out and must be planned; see docs/DEPLOYMENT.md).
set -eu
cd "$(dirname "$0")"

target=.env.prod
if [ -e "$target" ]; then
  echo "$target already exists; not overwriting." >&2
  exit 1
fi
command -v openssl >/dev/null || { echo "openssl is required" >&2; exit 1; }

rand() { openssl rand -hex "$1"; }

umask 077
sed \
  -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(rand 24)|" \
  -e "s|^NAKAMA_SERVER_KEY=.*|NAKAMA_SERVER_KEY=fk-$(rand 12)|" \
  -e "s|^NAKAMA_SESSION_KEY=.*|NAKAMA_SESSION_KEY=$(rand 32)|" \
  -e "s|^NAKAMA_REFRESH_KEY=.*|NAKAMA_REFRESH_KEY=$(rand 32)|" \
  -e "s|^NAKAMA_HTTP_KEY=.*|NAKAMA_HTTP_KEY=$(rand 32)|" \
  -e "s|^NAKAMA_CONSOLE_PASSWORD=.*|NAKAMA_CONSOLE_PASSWORD=$(rand 16)|" \
  -e "s|^NAKAMA_CONSOLE_SIGNING_KEY=.*|NAKAMA_CONSOLE_SIGNING_KEY=$(rand 32)|" \
  -e "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=$(rand 16)|" \
  .env.prod.example > "$target"

echo "Wrote $(pwd)/$target (mode 600). Now set WEB_DOMAIN, API_DOMAIN and ACME_EMAIL in it."
