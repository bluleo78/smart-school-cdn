# === Stage 1: Build ===
FROM node:22-alpine AS build
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app
# pnpm workspace 루트 파일 복사 (lockfile은 루트에 위치)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY services/admin-web/package.json ./services/admin-web/
# admin-web 의존성만 설치
RUN pnpm install --frozen-lockfile --filter admin-web...
# 소스 복사 후 Vite 빌드
COPY services/admin-web/ ./services/admin-web/
RUN pnpm --filter admin-web build

# === Stage 2: Nginx ===
FROM nginx:alpine
# Vite 빌드 결과를 nginx 서빙 경로로 복사
COPY --from=build /app/services/admin-web/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
