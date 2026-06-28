FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
# Install all deps (including devDeps) so TypeScript compiler is available
RUN npm ci
COPY . .
RUN npm run build
# Prune dev deps after build
RUN npm prune --production

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/data ./data
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "dist/server.js"]
