# FS Review api image. Debian slim rather than Alpine: node-canvas (drawing scanned pages for OCR) and
# Prisma need glibc and OpenSSL. Build:  docker build -t fs-review-api .
# The `build` stage keeps the dev tools; docker-compose.prod.yml runs `prisma migrate deploy` from it.

FROM node:22-bookworm-slim AS build
# compilers and headers in case node-canvas has no prebuilt binary for this Node version
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ pkg-config openssl \
     libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY prisma prisma
COPY shared shared
COPY src src
# canvas is optional in package.json, so a failed install would only show up as broken OCR: fail here instead
RUN npx prisma generate && npm run build && node -e "require('canvas')"
# one-off tools (seed, legacy import) run from this stage: docker compose run --rm migrate npx tsx scripts/...
COPY scripts scripts

FROM build AS prune
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
     libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libjpeg62-turbo libgif7 librsvg2-2 \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prune /app/package.json ./
COPY --from=prune /app/node_modules node_modules
COPY --from=build /app/node_modules/.prisma node_modules/.prisma
COPY --from=prune /app/shared/package.json shared/
COPY --from=prune /app/shared/dist shared/dist
COPY --from=prune /app/dist dist
# uploaded files (when no S3 settings are given) and the OCR cache; mount a volume here
RUN mkdir -p data/files data/ocr-cache && chown -R node:node data
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# node directly, not npm, so SIGTERM reaches the api and it stops cleanly
CMD ["node", "dist/interface/http/server.js"]
