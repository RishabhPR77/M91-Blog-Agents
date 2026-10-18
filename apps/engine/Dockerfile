# M91 Blog Engine. Build from the repo root (workspace layout):
#   docker build -f apps/engine/Dockerfile -t m91-engine .
# Env vars come from the host at run time; nothing secret is baked in.
FROM node:20-slim

ENV NODE_ENV=production \
    MEM0_TELEMETRY=false \
    PORT=8080

WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/engine/package.json apps/engine/package.json
COPY packages/content/package.json packages/content/package.json
# --omit=peer: mem0ai's optional peers (better-sqlite3 etc.) are for its self-hosted mode; the hosted client doesn't use them.
RUN npm ci --workspace @m91/engine --include-workspace-root --omit=dev --omit=peer && npm cache clean --force
COPY packages/content/src packages/content/src
COPY apps/engine/src apps/engine/src

USER node
EXPOSE 8080
CMD ["node", "apps/engine/src/server.js"]
