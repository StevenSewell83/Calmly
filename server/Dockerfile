FROM node:20-alpine AS base
WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.12.3 --activate

# Copy workspace manifests first for cache efficiency
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/

# Install deps (no native modules in server)
RUN pnpm install --frozen-lockfile --ignore-scripts

# Copy source
COPY shared/ ./shared/
COPY server/ ./server/

WORKDIR /app/server

EXPOSE 3001

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3001
ENV EMAIL_SENDER=console
ENV DEV_MAIL_DIR=/tmp/calmly-mail

# Run migrations then start the server
CMD ["sh", "-c", "node --import=tsx/esm node_modules/node-pg-migrate/bin/node-pg-migrate.js -m migrations up && node --import=tsx/esm src/index.ts"]
