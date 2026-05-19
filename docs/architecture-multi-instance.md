# Proxy 멀티 인스턴스 아키텍처 결정 기록 (#393)

> 작성: 2026-05-19 · 트리거 시점이 오면 본 문서 기반으로 #393 sub-issue 분리

## 결정 요약

- **현재 (프로토타입 ~ 초기 운영)**: 단일 proxy 인스턴스 유지. 단일 학교 트래픽 규모(학생 ~1000명, 도메인 수십 건)에서 충분.
- **확장 시점 도래 시**: **Option A — Sticky routing (consistent hash by URL)** 채택.
- **트리거 조건**: 학교 규모 확장 / 다수 학교 통합 운영 / SPOF 사고 / proxy 단일 인스턴스 CPU·메모리 한계 도달.

## 배경

학생 1000명 동시 1교시 시작 시나리오에서 proxy 단일 프로세스가 처리량/메모리 한계에 가까워질 수 있다.
- in-flight 메모리 캡(#391): 64 동시 origin fetch + 2GB 컨테이너 한도 → 단일 인스턴스 안정성 보장
- coalescer broadcast capacity(#390): 1024 — burst 마진
- stale-if-error(#388): origin 장애 시 자가 복구
- 위 3종이 단일 인스턴스의 안정성 한도를 끌어올렸지만, **수평 확장 = 처리량 ×N** 이라는 별개 축은 미해결.

## 현재 공유 상태

### ✅ 자연 공유 (멀티 인스턴스 안전)

- **L2 캐시 (디스크)** — `storage-service` 별도 gRPC. 여러 proxy 가 한 storage 공유 → L2 hit 자동 동기화
- **TLS / DNS / Optimizer** — 모두 별도 gRPC 서비스 → 공유 호출 OK

### ⚠️ 프로세스 로컬 (멀티 인스턴스 시 충돌/낭비)

| 상태 | 위치 | 멀티 인스턴스 시 문제 |
|------|------|---|
| L1 (moka 메모리) | proxy 프로세스 (`memory_cache` in `main.rs`) | 동일 URL 가 인스턴스마다 중복 메모리 점유, hit ratio ↓ |
| Coalescer in-flight | proxy 프로세스 (`coalescer.rs`) | 인스턴스 A·B 가 같은 URL 을 각각 origin fetch → origin 부하 N배 |
| DomainMap (도메인 설정) | proxy 메모리 (admin push 수신) | admin-server 가 단일 `PROXY_ADMIN_URL` 가정, 멀티 endpoint fan-out 부재 |
| Stats counters (atomic) | proxy 프로세스 (`state.rs`) | admin polling 시 인스턴스별 stats 분리, 합산 로직 부재 |

## 옵션 비교

| 옵션 | 핵심 아이디어 | 비용 | 처리량 효과 | 적합 시점 |
|------|---|---|---|---|
| **A. Sticky routing** | L4/L7 LB 가 URL hash 로 인스턴스 분배 — 같은 URL = 같은 인스턴스 | ★ | 거의 ×N (L1·coalescer 자연 hit) | **단일 학교 / 처리량 + HA 모두** |
| B. Active-passive (HA only) | 1대만 active, 나머지 standby + 자동 failover | ★★ | ×1 (가용성만 ↑) | 단일 학교 / SPOF 해소만 |
| C. Distributed coalescer + L1 제거 | L1 제거, L2만 의존, coalesce 를 storage-service 로 이관 | ★★★ | ×N 이지만 L1 효과 손실 | 수만 명 동시 트래픽 |
| D. L1 stale broadcast | 인스턴스 간 L1 invalidation pub/sub | ★★★★ | ×N + L1 효과 일부 | 매우 큰 규모 |

## Option A 채택 시 요구 작업

1. **admin-server → 멀티 proxy fan-out**
   - `PROXY_ADMIN_URL` (단일) → `PROXY_ADMIN_URLS` (CSV) 또는 서비스 디스커버리 (Docker DNS / Consul)
   - 도메인 push/sync/PURGE 모두 모든 인스턴스에 broadcast

2. **PURGE 전파**
   - L2 는 storage-service 공유라 자동 처리
   - L1 은 인스턴스별 → 모든 proxy 에 PURGE 호출 (admin-server fan-out)

3. **Stats 합산**
   - admin-server 가 `/admin/stats` 를 모든 proxy 에서 polling 후 합산
   - admin-web 표시는 클러스터 합산값

4. **Health / registration**
   - proxy 부팅 시 admin-server 등록 (또는 admin-server polling)
   - 사라진 인스턴스 자동 제외

5. **TLS cert hot reload broadcast**
   - tls-service 가 cert rotation 시 모든 proxy 에 reload 신호

6. **LB 설정**
   - HAProxy: `balance source` 또는 `hash $request_uri consistent`
   - 또는 nginx `hash $request_uri consistent`
   - LB 자체 HA 별도 고려 (keepalived / VRRP)

## 추정 비용 (Option A 단일 학교 적용)

| 항목 | 비용 |
|------|------|
| (1) admin-server fan-out | 1~2일 |
| (2) PURGE broadcast | 0.5일 |
| (3) Stats 합산 | 1일 |
| (4) Health registration | 1~2일 |
| (5) TLS reload broadcast | 1일 |
| (6) LB 설정 + docker-compose 멀티 replica + 통합 검증 | 1~2일 |
| **합계** | **6~9일** + 운영 검증 별도 |

## 단점 / 리스크

- **LB 단일 의존** — LB 자체 HA 가 새로운 SPOF. keepalived/VRRP 추가 필요
- **URL hash 불균등** — 인기 URL 이 한 인스턴스에 집중되면 hot-spot. consistent hash 의 virtual node 수로 완화
- **인스턴스 추가/제거 시 hash 재분배** — consistent hash 라 영향 최소화 가능. 재분배 동안 L1 일시 miss

## 즉시 채택 단계는 아님

현재 단일 proxy 로 충분. 본 문서는 **확장 시 채택할 결정 사전 기록**.

트리거 도래 시 본 문서 기반 sub-issue 분리:
- "(#393-1) admin-server PROXY_ADMIN_URLS 멀티 fan-out"
- "(#393-2) admin-server PURGE/stats 클러스터 합산"
- "(#393-3) proxy registration + health 동적 추적"
- "(#393-4) HAProxy/nginx 설정 + docker-compose replica 통합"

## 참고 코드 / 위치

- `services/proxy/src/main.rs` — moka L1 + http_client 초기화
- `services/proxy/src/coalescer.rs` — in-flight 맵
- `services/proxy/src/state.rs` — atomic stats
- `services/admin-server/src/routes/domains.ts` — 도메인 push/PURGE
- `services/storage-service/src/grpc.rs` — 공유 L2

## 관련 이슈

- #391 in-flight 메모리 캡 (단일 인스턴스 안정성)
- #390 coalescer broadcast capacity (burst 마진)
- #388 stale-if-error (origin 장애 자가 복구)
