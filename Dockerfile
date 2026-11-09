# syntax=docker/dockerfile:1
# Web (Next.js) and API (NestJS) images. FLUX inference runs natively on the
# host (Apple GPU), see scripts/inference-supervisor.sh.

FROM node:24-slim AS deps
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/inference/package.json apps/inference/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# ── API ─────────────────────────────────────────────────────
FROM deps AS api-build
COPY apps/api apps/api
RUN pnpm --filter api build && pnpm --filter api deploy --prod /out

FROM node:24-slim AS api
ENV NODE_ENV=production
WORKDIR /app/apps/api
COPY --from=api-build /out ./
EXPOSE 4310
CMD ["node", "dist/main.js"]

# ── Web ─────────────────────────────────────────────────────
FROM deps AS web-build
# Inlined into the browser bundle at build time: the URL the *browser* uses.
ARG NEXT_PUBLIC_API_URL=http://localhost:4310
ARG NEXT_PUBLIC_API_TOKEN=
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_PUBLIC_API_TOKEN=$NEXT_PUBLIC_API_TOKEN IMAGEGEN_IGNORE_DOTENV=1
COPY apps/web apps/web
RUN pnpm --filter web build

FROM node:24-slim AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 IMAGEGEN_IGNORE_DOTENV=1
WORKDIR /app
COPY --from=web-build /app ./
WORKDIR /app/apps/web
EXPOSE 3000
CMD ["node_modules/.bin/next", "start", "-p", "3000"]
