# API-only production image. Node and pnpm are pinned to the project's Node 22/pnpm 9 toolchain.
FROM node:22.23.4-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS base

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

FROM base AS build-dependencies
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

FROM build-dependencies AS build
COPY tsconfig.json ./
COPY server ./server
COPY shared ./shared
COPY drizzle ./drizzle
RUN pnpm build

FROM base AS production-dependencies
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile --prod

FROM node:22.23.4-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS runtime

ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app

RUN groupadd --system --gid 10001 circles \
    && useradd --system --uid 10001 --gid circles --home-dir /app circles

COPY --from=production-dependencies --chown=circles:circles /app/node_modules ./node_modules
COPY --from=build --chown=circles:circles /app/dist ./dist
COPY --chown=circles:circles package.json ./package.json
COPY --chown=circles:circles server/certificates ./server/certificates

USER circles
EXPOSE 3000

# /api/ready checks restricted-role database and private OAuth-store readiness.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '3000') + '/api/ready').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1))"

CMD ["node", "dist/index.js"]
