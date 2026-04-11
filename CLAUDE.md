# Smart Home CDN

학교 내부 네트워크용 온프레미스 CDN 서비스. 디지털 교과서 콘텐츠를 캐싱/최적화하여 iPad 로딩 속도를 개선한다.

## Architecture

- **Rust 엔진**: Proxy(443), Storage, Optimizer, DNS(53), TLS — 고성능 네트워크 처리
- **Node.js Admin**: Fastify API(4001 dev / 3000 prod) + React Dashboard(4173 dev)
- **통신**: Rust↔Rust gRPC (tonic), Admin↔Rust gRPC (@grpc/grpc-js)
- **DB**: SQLite (Storage: 캐시 메타, Admin: 설정/통계/로그)
- **배포**: Docker Compose

## Commands

- `pnpm dev` / `pnpm build` / `pnpm test` / `pnpm lint`
- `pnpm dev:infra` — Docker Compose 기동 후 dev
- `pnpm docker:build` / `pnpm docker:up` / `pnpm docker:down`

## Key Files

- 아키텍처: `docs/architecture.md`
- 개발 로드맵: `docs/development-roadmap.md`
- 사용자 가이드: `docs/guides/user-guide.md`
- 디자인 시스템: `docs/design-system/` (smart-fire-hub 참조)
- E2E 테스트 가이드: `docs/guides/playwright-e2e-guide.md`
- 커밋 컨벤션: `docs/guides/commit-convention.md` — **커밋 시 반드시 참조**

## Rules

- **한국어 주석 필수**: 클래스·메서드·주요 로직에 무엇을·왜 설명.
- **커밋/배포 금지**: 사용자 명시적 승인 후에만 실행.
- **테스트 필수**: Rust → 단위/통합 테스트, Admin API → Vitest, Dashboard → Playwright E2E.
- **포트 충돌 주의**: smart-fire-hub과 동시 실행 시 포트 할당표 참조 (`docs/architecture.md` §9).

## Tech Stack

| 영역 | 기술 |
|------|------|
| Proxy/Storage/Optimizer/DNS/TLS | Rust + axum + tokio + tonic |
| Admin API | Node.js + Fastify + TypeScript + better-sqlite3 |
| Dashboard | React 19 + Vite + shadcn/ui + TanStack Query + Zod v4 |
| 인터페이스 | Protocol Buffers (.proto) |
| 모노레포 | pnpm workspace + Turborepo |
| E2E 테스트 | Playwright |
| 배포 | Docker Compose (dev / prod 분리) |
