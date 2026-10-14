FROM node:24-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
# npm ci needs every workspace manifest, including the web app it does not build here.
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/ssrf-guard/package.json packages/ssrf-guard/package.json
COPY packages/crypto/package.json packages/crypto/package.json
COPY packages/sql-guard/package.json packages/sql-guard/package.json
COPY packages/core/package.json packages/core/package.json
RUN npm ci
COPY . .
ENV DATABASE_URL=postgresql://ayd:ayd@localhost:5432/ayd
RUN npm run build --workspace=@ayd/shared && npm run build --workspace=@ayd/ssrf-guard && npm run build --workspace=@ayd/crypto && npm run build --workspace=@ayd/sql-guard && npm run build --workspace=@ayd/database && npm run build --workspace=@ayd/core && npm run build --workspace=@ayd/worker

FROM node:24-alpine
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo /repo
WORKDIR /repo/apps/worker
CMD ["node", "dist/main.js"]
