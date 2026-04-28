# === Stage 1: Build — 호스트 네이티브 플랫폼 (TypeScript 빌드, 빠름) ===
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@10 --activate
# better-sqlite3 초기 컴파일 도구 (빌드플랫폼용)
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY services/admin-server/package.json ./services/admin-server/
RUN pnpm install --frozen-lockfile --filter admin-server...
COPY crates/cdn-proto/proto/ ./crates/cdn-proto/proto/
COPY services/admin-server/ ./services/admin-server/
RUN pnpm --filter admin-server build
RUN pnpm --filter admin-server deploy --legacy --prod /prod

# === Stage 2: 네이티브 모듈 리빌드 — 타겟 플랫폼 (better-sqlite3만) ===
FROM node:22-alpine AS native
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY --from=build /prod ./
# better-sqlite3를 타겟 플랫폼용으로 재컴파일
RUN npm rebuild better-sqlite3

# === Stage 3: Runtime ===
FROM node:22-alpine
WORKDIR /app
COPY --from=native /app ./
COPY --from=build /app/services/admin-server/dist ./dist
COPY --from=build /app/crates/cdn-proto/proto /crates/cdn-proto/proto
EXPOSE 4001
CMD ["node", "dist/index.js"]
