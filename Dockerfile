FROM node:22-bookworm-slim AS build

WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build \
    && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    APP_VERSION=0.1.0 \
    HOST=0.0.0.0 \
    PORT=3001 \
    DB_PATH=/data/busca-vendas.sqlite \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    MELI_LOCAL_BROWSER_ENABLED=false

COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/server ./server

RUN mkdir -p /data && chown node:node /data

USER node
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server/index.mjs"]
