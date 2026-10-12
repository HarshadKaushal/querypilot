FROM node:22-alpine AS build
WORKDIR /repo
ENV DATABASE_URL=postgresql://ayd:ayd@localhost:5432/ayd
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
RUN npm run build --workspace=@ayd/shared && npm run build --workspace=@ayd/ssrf-guard && npm run build --workspace=@ayd/crypto && npm run build --workspace=@ayd/sql-guard && npm run build --workspace=@ayd/database && npm run build --workspace=@ayd/api

FROM node:22-alpine
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo /repo
EXPOSE 3000
CMD ["sh", "-c", "npm run migrate --workspace=@ayd/database && node apps/api/dist/main.js"]
