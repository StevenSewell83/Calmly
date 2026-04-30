FROM node:20-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.12.3 --activate

# Copy workspace manifests first for layer cache
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/

RUN pnpm install --frozen-lockfile --ignore-scripts

COPY shared/ ./shared/
COPY server/ ./server/

# ── Runtime image ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

LABEL org.opencontainers.image.source="https://github.com/your-org/calmly"
LABEL org.opencontainers.image.licenses="MIT"
LABEL org.opencontainers.image.description="Calmly sync server"

# Copy only what the server needs at runtime
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/server ./server
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-workspace.yaml ./pnpm-workspace.yaml

WORKDIR /app/server

# Run as non-root
USER node

EXPOSE 3001

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3001
ENV EMAIL_SENDER=console
ENV DEV_MAIL_DIR=/tmp/calmly-mail

HEALTHCHECK --interval=10s --timeout=5s --retries=10 --start-period=15s \
  CMD wget -qO- http://localhost:3001/health || exit 1

CMD ["sh", "-c", "node --import=tsx/esm node_modules/node-pg-migrate/bin/node-pg-migrate.js -m migrations up && node --import=tsx/esm src/index.ts"]
