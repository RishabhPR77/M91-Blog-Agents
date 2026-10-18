# M91 Blog Engine v2. Env vars come from the host at run time; nothing secret is baked in.
FROM node:20-slim

ENV NODE_ENV=production \
    MEM0_TELEMETRY=false \
    PORT=8080

WORKDIR /app
COPY package.json package-lock.json ./
# --omit=peer: mem0ai's optional peers (better-sqlite3 etc.) are for its self-hosted mode; the hosted client doesn't use them.
RUN npm ci --omit=dev --omit=peer && npm cache clean --force
COPY src ./src

USER node
EXPOSE 8080
CMD ["node", "src/server.js"]
