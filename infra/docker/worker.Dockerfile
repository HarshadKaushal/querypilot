FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/ssrf-guard/package.json packages/ssrf-guard/package.json
COPY packages/crypto/package.json packages/crypto/package.json
COPY packages/sql-guard/package.json packages/sql-guard/package.json
RUN npm ci
COPY . .
RUN npm run build --workspace=@ayd/worker

FROM node:22-alpine
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo /repo
WORKDIR /repo/apps/worker
CMD ["node", "dist/main.js"]
