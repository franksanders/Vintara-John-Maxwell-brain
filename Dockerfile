FROM node:22-bookworm-slim AS base

WORKDIR /app
ENV NPM_CONFIG_CACHE=/npm-cache

FROM base AS dev

COPY package*.json ./
RUN npm ci

FROM dev AS build

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM base AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    EMBEDDING_CACHE_PATH=/app/.cache/embeddings.json \
    CONVERSATION_STORE_PATH=/app/.cache/conversations.json

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY public ./public
COPY data ./data

RUN mkdir -p /app/.cache && chown -R node:node /app
USER node

EXPOSE 3000

CMD ["node", "dist/server.js"]
