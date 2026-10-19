# M91 Blog Engine. Build from the repo root (workspace layout):
#   docker build -f apps/engine/Dockerfile -t m91-engine .
# Env vars come from the host at run time; nothing secret is baked in.
# Phase 7: the image also holds the blog (apps/blog) with its packages installed, so the Publisher can build
# the blog inside the container. Checked: the image builds, and the blog builds inside it as user node (see PHASE7_NOTES.md).

# --- Stage 1: build the dashboard (Phase 6). Its own npm project, with its own lockfile. ---
# Node 22: Vite 8 needs ^20.19 or >=22.12.
FROM node:22-slim AS dashboard
WORKDIR /build/dashboard
COPY apps/engine/dashboard/package.json apps/engine/dashboard/package-lock.json ./
RUN npm ci --no-audit --no-fund && npm cache clean --force
COPY apps/engine/dashboard/index.html apps/engine/dashboard/vite.config.ts apps/engine/dashboard/tsconfig.json ./
COPY apps/engine/dashboard/src ./src
RUN npm run build

# --- Stage 2: the engine (serving the built dashboard) and the blog's source for the Publisher. ---
# Node 22: Astro 7 needs >=22.12.
FROM node:22-slim

ENV NODE_ENV=production \
    MEM0_TELEMETRY=false \
    ASTRO_TELEMETRY_DISABLED=1 \
    PORT=8080

WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/engine/package.json apps/engine/package.json
COPY packages/content/package.json packages/content/package.json
# --omit=peer: mem0ai's optional peers (better-sqlite3 etc.) are for its self-hosted mode; the hosted client doesn't use them.
RUN npm ci --workspace @m91/engine --include-workspace-root --omit=dev --omit=peer && npm cache clean --force
COPY packages/content/src packages/content/src

# The blog: its own npm project; @m91/content is linked from ../../packages/content (copied above).
# Its build tools are regular dependencies, so --omit=dev keeps everything the build needs.
# Owned by "node": the Publisher writes src/content/posts, .astro and dist at run time.
COPY --chown=node:node apps/blog/package.json apps/blog/package-lock.json apps/blog/
RUN cd apps/blog && npm ci --omit=dev --no-audit --no-fund && npm cache clean --force && chown -R node:node /app/apps/blog
COPY --chown=node:node apps/blog/astro.config.mjs apps/blog/tsconfig.json apps/blog/
COPY --chown=node:node apps/blog/scripts apps/blog/scripts
COPY --chown=node:node apps/blog/public apps/blog/public
COPY --chown=node:node apps/blog/src apps/blog/src

COPY apps/engine/src apps/engine/src
COPY --from=dashboard /build/dashboard/dist apps/engine/dashboard/dist

USER node
EXPOSE 8080
CMD ["node", "apps/engine/src/server.js"]
