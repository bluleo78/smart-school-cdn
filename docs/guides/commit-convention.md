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

### 스쿼시 기준

**서비스 레이어 × 관심사 조합**으로 커밋을 나눈다.

| 커밋 | 포함 범위 | 예시 |
|------|-----------|------|
| `chore` | 의존성·설정·gitignore | `chore: sha2/tempfile 의존성 추가 + 아티팩트 gitignore` |
| `feat(<서비스>)` | 서비스 1개의 핵심 기능 | `feat(proxy): CacheLayer + HIT/MISS/BYPASS 통합` |
| `feat(<서비스>)` | 다른 서비스의 핵심 기능 | `feat(admin-server): 캐시 API 라우트 + 시드 데이터` |
| `feat(<서비스>)` | UI 서비스의 핵심 기능 | `feat(admin-web): 캐시 통계 대시보드 + 퍼지 UI` |
| `test` + `docs` | E2E 검증 + 문서 일괄 | `test: E2E 캐시 전체 검증 + TC 가이드라인 + 로드맵` |

**규칙:**
- 동일 파일을 여러 그룹이 공유하면 하나의 커밋으로 합친다 (`git add -p` 분리는 피한다)
- 독립 서비스 기능은 별도 커밋 — 리뷰 가능한 단위를 유지한다
- 테스트·문서는 해당 기능 커밋에 포함하거나 마지막에 일괄 커밋한다

**스쿼시 절차:**
```bash
# 1. 대상 범위 확인
git log <base>..HEAD --oneline

# 2. 소프트 리셋 — 변경 내용은 워킹 트리에 보존
git reset --soft <base>
git restore --staged .

# 3. 그룹별로 선택 스테이징 후 커밋
git add <파일1> <파일2> ...
git commit -m "feat(서비스): ..."
```

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
