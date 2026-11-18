# syntax=docker/dockerfile:1
# FlickKick web client: production build served by Caddy, which also
# terminates TLS and reverse-proxies the Nakama API + realtime socket.
# Build context: repository root.

FROM node:22.22.0-bookworm-slim AS build
# Optional mirror. Corepack needs it too: it downloads pnpm itself.
ARG NPM_REGISTRY=https://registry.npmjs.org/
ENV COREPACK_NPM_REGISTRY=$NPM_REGISTRY \
    NPM_CONFIG_FETCH_RETRIES=10 \
    NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=5000 \
    NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=60000 \
    NPM_CONFIG_FETCH_TIMEOUT=600000
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /repo

# Dependencies first (cached while lockfile and manifests are unchanged).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/web/vendor apps/web/vendor
COPY packages/config/package.json packages/config/
COPY packages/rules/package.json packages/rules/
COPY packages/sim/package.json packages/sim/
RUN --mount=type=cache,target=/pnpm/store,sharing=locked \
    pnpm config set registry "$NPM_REGISTRY" \
 && pnpm config set store-dir /pnpm/store \
 && pnpm install --frozen-lockfile --filter "@flickkick/web..."

COPY tsconfig.base.json ./
COPY packages packages
COPY apps/web apps/web

# Public client settings, baked into the bundle at build time.
ARG VITE_NAKAMA_HOST
ARG VITE_NAKAMA_PORT=443
ARG VITE_NAKAMA_SSL=true
ARG VITE_NAKAMA_SERVER_KEY
ARG VITE_COMMS_URL=
ENV VITE_NAKAMA_HOST=$VITE_NAKAMA_HOST \
    VITE_NAKAMA_PORT=$VITE_NAKAMA_PORT \
    VITE_NAKAMA_SSL=$VITE_NAKAMA_SSL \
    VITE_NAKAMA_SERVER_KEY=$VITE_NAKAMA_SERVER_KEY \
    VITE_COMMS_URL=$VITE_COMMS_URL
RUN test -n "$VITE_NAKAMA_HOST" && test -n "$VITE_NAKAMA_SERVER_KEY" \
 && pnpm --filter @flickkick/web build

FROM caddy:2.11.7-alpine AS runtime
COPY --from=build /repo/apps/web/dist /srv
COPY server/deploy/Caddyfile /etc/caddy/Caddyfile

EXPOSE 80 443 443/udp
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=10 \
  CMD wget -q --spider http://127.0.0.1:2019/config/ || exit 1

# Dokploy/Traefik owns TLS; both public domains route to this target on port 80.
FROM runtime AS dokploy
COPY server/deploy/Caddyfile.dokploy /etc/caddy/Caddyfile

# Default target: Caddy owns TLS on a standalone Linux host.
FROM runtime AS standalone
