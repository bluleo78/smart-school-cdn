# Smart Home CDN

학교 내부 네트워크용 온프레미스 CDN 서비스. 디지털 교과서 콘텐츠를 캐싱/최적화하여 iPad 로딩 속도를 개선한다.

## Architecture

- **Rust 엔진**: Proxy(443/8080), TLS — 고성능 네트워크 처리
- **Node.js Admin**: Fastify API(4001) — 내부 전용, 외부 미노출
- **Admin Web**: React + nginx(7777) — API 리버스 프록시 내장
- **통신**: Admin↔Proxy HTTP (`http://proxy:8081`)
- **DB**: SQLite (Admin: 설정/통계/로그)
- **배포**: Docker Compose (로컬 테스트 / 운영 분리)

## Commands

- `pnpm dev` / `pnpm build` / `pnpm test` / `pnpm lint`
- `pnpm docker:build` / `pnpm docker:up` / `pnpm docker:down` — 로컬 통합 테스트용 (포트: 8082/4443/7778)

## Deploy

```bash
pnpm ship                # 전체 재배포 (proxy + admin-server + admin-web)
pnpm ship:proxy          # Proxy만 재배포
pnpm ship:admin          # Admin Server + Admin Web만 재배포
```

자세한 내용은 **[운영 배포 가이드](docs/guides/deploy-guide.md)** 참조.

## Key Files

- 아키텍처: `docs/architecture.md`
- 개발 로드맵: `docs/development-roadmap.md`
- 사용자 가이드: `docs/guides/user-guide.md`
- **운영 배포 가이드**: `docs/guides/deploy-guide.md`
- 디자인 시스템: `docs/design-system/` (smart-fire-hub 참조)
- E2E 테스트 가이드: `docs/guides/playwright-e2e-guide.md`
- **TC 작성 가이드라인**: `docs/guides/tc-guideline.md` — **기능 구현 시 반드시 참조**
- 커밋 컨벤션: `docs/guides/commit-convention.md` — **커밋 시 반드시 참조**
- 코딩 컨벤션: `docs/guides/coding-convention.md` — **코드 작성 시 반드시 참조**

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

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- For cross-module "how does X relate to Y" questions, prefer `graphify query "<question>"`, `graphify path "<A>" "<B>"`, or `graphify explain "<concept>"` over grep — these traverse the graph's EXTRACTED + INFERRED edges instead of scanning files
- After modifying code files in this session, run `graphify update .` to keep the graph current (AST-only, no API cost)
