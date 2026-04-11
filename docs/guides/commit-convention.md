# 커밋 컨벤션

## 형식

```
<type>: <한국어 설명>

- 변경 항목 1
- 변경 항목 2
```

## 타입

| 타입 | 설명 | 예시 |
|------|------|------|
| `feat` | 새 기능 | `feat: HTTP 리버스 프록시 + 요청 모니터링 UI` |
| `fix` | 버그 수정 | `fix: 캐시 TTL 만료 시 원본 재검증 누락` |
| `refactor` | 리팩터링 (기능 변화 없음) | `refactor: dev 스크립트를 scripts/dev.sh로 분리` |
| `docs` | 문서 추가/수정 | `docs: 사용자 가이드 CA 인증서 설치 섹션 추가` |
| `chore` | 설정/빌드/의존성 | `chore: turbo 의존성 추가` |
| `test` | 테스트 추가/수정 | `test: 도메인 관리 페이지 E2E 테스트` |

## 규칙

### 커밋 메시지
- **무엇을 변경했는지**만 기술한다
- Phase 번호, 로드맵 단계 등 프로젝트 관리 정보는 포함하지 않는다
- 변경 항목을 `-` 목록으로 기술한다

### 작업 단위 커밋
- 하나의 작업 단위(기능, 리팩터링 등)를 완료하면 **하나의 커밋으로 합친다** (squash)
- 진행 중 여러 중간 커밋이 생겨도 완료 시 `git reset --soft`로 합침

### 커밋 직후 수정 (amend)
- lint/test fail 등 커밋 직후 발생한 수정은 새 커밋이 아닌 `git commit --amend`로 이전 커밋에 합친다
- 이미 push한 커밋은 amend 대신 새 커밋으로 수정한다

### 로드맵 업데이트
- 작업 완료 시 `docs/development-roadmap.md`의 체크박스(`[ ]` → `[x]`)를 커밋에 포함

### 예시

```
feat: 모노레포 개발 환경 구성

- pnpm workspace + Turborepo 모노레포 설정
- Rust workspace (proxy crate 스캐폴딩)
- Admin Server (Fastify + TypeScript, /api/health 엔드포인트)
- Admin Web (Vite + React 19 + Tailwind v4, AppLayout + 5개 페이지 라우팅)
- ESLint 서비스별 설정 + husky pre-commit (lint-staged + Playwright E2E)
- Playwright E2E 테스트 (레이아웃 렌더링 + 네비게이션)
- scripts/dev.sh (포트 정리 후 turbo dev 기동)
```
