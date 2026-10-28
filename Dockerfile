# syntax=docker/dockerfile:1
# One container: Fastify serves the API and the built Vue app on port 3000.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/web/dist apps/web/dist
RUN addgroup -S app && adduser -S app -G app \
  && mkdir -p /app/.data/ai-assessments && chown -R app:app /app/.data
# Saved AI assessments (one JSON file per parcel). Mount a volume (e.g. EFS) here so they survive redeploys.
VOLUME ["/app/.data"]
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "--enable-source-maps", "apps/api/dist/server.js"]
