FROM node:24-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libgbm-dev \
    libnss3 \
    libpango-1.0-0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon-dev \
    libxrandr2 \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable
WORKDIR /app
RUN chown node:node /app
COPY --chown=node:node . .
USER node

RUN pnpm install --frozen-lockfile
RUN DATABASE_URL=postgresql://user:password@localhost:5432/caption_generator \
    SKIP_ENV_VALIDATION=true \
    pnpm --filter @caption-generator/db exec prisma generate --config prisma7.config.ts
RUN pnpm --filter server build
RUN pnpm --filter server exec remotion browser ensure

ENV NODE_ENV=production
ENV PORT=4000

EXPOSE 4000
CMD ["pnpm", "--filter", "server", "start:container"]
