# === Stage 1: Build ===
FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app
# pnpm workspace 루트 파일 복사 (lockfile은 루트에 위치)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY services/admin-server/package.json ./services/admin-server/
# admin-server 의존성만 설치
RUN pnpm install --frozen-lockfile --filter admin-server...
# 소스 복사 후 TypeScript 빌드
COPY services/admin-server/ ./services/admin-server/
RUN pnpm --filter admin-server build
# production 의존성만 /prod에 배포
RUN pnpm --filter admin-server deploy --legacy --prod /prod

# === Stage 2: Runtime ===
FROM node:22-alpine
WORKDIR /app
# production 의존성 복사
COPY --from=build /prod ./
# 컴파일된 JS 복사
COPY --from=build /app/services/admin-server/dist ./dist
EXPOSE 4001
CMD ["node", "dist/index.js"]
