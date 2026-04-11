# 디지털 교과서 캐싱 프록시/CDN 솔루션 연구 보고서

> 작성일: 2026-04-11

## 1. 문제 정의

학교/조직 환경에서:
- **클라이언트 기기**: iPad 등 태블릿
- **내부 네트워크**: 빠름 (1Gbps+)
- **외부 인터넷**: 느림/제한적
- **상황**: 다수 학생이 동시에 동일한 디지털 교과서 콘텐츠 접근 시 외부 대역폭 포화 → 로딩 시간 급증

**목표**: 조직 내부에 캐싱 레이어를 두어 최초 1회만 외부 다운로드, 이후 로컬 캐시에서 제공

**선택한 접근법**: 리버스 프록시 + Split-Horizon DNS
- iPad 환경에서 클라이언트 설정 변경 없이 동작하는 유일한 현실적 방식
- 포워드 프록시는 iPad에 MDM으로 프록시/CA 설정 배포 필요 → 비현실적

---

## 2. 오픈소스 솔루션 비교

| 솔루션 | HTTPS 캐싱 | 포워드 프록시 | 리버스 프록시 | 배포 난이도 | 비고 |
|--------|:----------:|:------------:|:------------:|:-----------:|------|
| **Squid** | SSL Bump | O | O | 중간 | 가장 검증된 프록시, 학교 사례 다수 |
| **Nginx** | SSL 터미네이션 | 제한적 | O | 낮음 | 고성능, 설정 직관적 |
| **Varnish** | 앞단 필요 | X | O | 높음 | 캐싱 성능 최고, VCL 학습 곡선 |
| **Apache Traffic Server** | O | O | O | 높음 | CDN급 확장성, 소규모엔 과사양 |
| **Caddy** | 자동 HTTPS | 제한적 | O | 낮음 | 설정 가장 단순, 캐싱 성숙도 낮음 |
| **pfSense + Squid** | SSL Bump | O | O | 중간 | 방화벽+캐싱 통합, GUI 관리 |

### 상세 설명

**Squid** — 1990년대부터 검증된 캐싱 프록시. SSL Bump으로 HTTPS 캐싱 가능 (클라이언트에 CA 인증서 배포 필요). pfSense/OPNsense에 패키지로 포함.

**Nginx** — 리버스 프록시 모드로 특정 도메인의 콘텐츠를 캐싱. `proxy_cache` 기능이 강력하고 동시 접속 처리 우수. 범용 포워드 프록시는 불가.

**Varnish** — 메모리 기반 캐싱으로 최고 성능이나 SSL 미지원(앞단에 Nginx 필요). VCL로 캐시 로직 완전 커스터마이징 가능.

**Apache Traffic Server** — 포워드+리버스 모두 지원. Yahoo, Apple이 사용. Apache Traffic Control과 결합하면 완전한 오픈소스 CDN 구축 가능.

---

## 3. 상용 솔루션

| 솔루션 | 타입 | 교육 특화 | 가격 | 배포 난이도 |
|--------|------|:---------:|------|:-----------:|
| **ApplianSys CACHEBOX** | 어플라이언스 | **최적화** | $1,500~ | 낮음 |
| **Nginx Plus** | 소프트웨어 | X | ~$3,500/년 | 중간 |
| **Broadcom ProxySG** | 어플라이언스 | X | 수천만원+ | 중간 |
| **Varnish Enterprise** | 소프트웨어 | X | 별도 견적 | 높음 |

### ApplianSys CACHEBOX (교육 환경 특화)
- 155개국 배포, UK 교육 시장 점유율 높음
- 수업 전 콘텐츠 사전 캐싱(Pre-warming) 기능
- 실제 성과: 대역폭 47~68% 절감, 접속 속도 150% 향상
- **한계**: 한국 디지털교과서 플랫폼 지원 여부 확인 필요

### 클라우드 CDN (Cloudflare, CloudFront 등)
**이 사용 사례에 부적합** — 클라우드 CDN은 원본 서버 부하를 줄이는 것이지, 클라이언트의 외부 회선 병목을 해결하지 못함. 온프레미스 캐싱만이 효과적.

---

## 4. 선택한 아키텍처: 리버스 프록시 + Split-Horizon DNS

### 아키텍처 개요

```
[iPad] → [학교 Wi-Fi] → [DHCP: DNS=10.0.1.1]
                              ↓
                    [내부 DNS 서버 (dnsmasq/Bind)]
                    textbook.provider.com → 10.0.1.100 (캐시 서버)
                    기타 도메인 → 외부 DNS로 포워딩
                              ↓
                    [Nginx 리버스 프록시 + 캐시] (10.0.1.100)
                    캐시 히트 → 로컬 응답 (<10ms)
                    캐시 미스 → 원본 서버에서 가져와 캐시 저장
```

**장점**: iPad에 아무 설정 없이 동작, DNS만 변경, 높은 캐시 효율, BYOD 지원
**단점**: 도메인별 설정 필요, TLS 인증서 관리(내부 CA 필요 + iPad에 CA 배포)

### iPad 환경 고려사항

- iPad은 Wi-Fi 접속 시 DHCP에서 DNS를 자동으로 받음 → 별도 설정 불필요
- 내부 CA 인증서는 MDM(Jamf/Intune) 또는 수동 프로파일 설치로 배포
- Safari의 Service Worker 캐시는 7일 미사용 시 자동 삭제 → 서버측 캐싱이 필수
- Certificate Pinning 사용하는 앱은 리버스 프록시로도 대응 불가 → 해당 트래픽은 우회

### 구현 필요 항목

| # | 항목 | 설명 | 우선순위 |
|---|------|------|:--------:|
| 1 | 대상 도메인 파악 | 디지털 교과서가 사용하는 실제 도메인/URL 구조 조사 | **최우선** |
| 2 | TLS 인증서 | 내부 CA 생성 + 대상 도메인 인증서 발급 | 높음 |
| 3 | 내부 DNS 설정 | 대상 도메인만 캐시 서버 IP로 오버라이드 | 높음 |
| 4 | Nginx 캐시 설정 | 정적/동적 콘텐츠 분리, 캐시 정책, 스토리지 | 높음 |
| 5 | iPad CA 배포 | MDM 또는 수동으로 내부 CA 신뢰 설정 | 높음 |
| 6 | Pre-warming | 수업 전 사전 캐싱 크론잡 | 선택 |
| 7 | 모니터링 | 캐시 히트율, 대역폭 절감 확인 | 선택 |

### 비교: 왜 다른 방식은 iPad에 부적합한가

| 방식 | iPad 문제점 |
|------|------------|
| 포워드 프록시 (Squid) | MDM으로 프록시+CA 설정 배포 필수, BYOD 불가 |
| 투명 프록시 | HTTPS 콘텐츠 단위 캐싱 불가 (SNI만 확인 가능) |
| Service Worker | 플랫폼이 구현해야 함, Safari 7일 제한, 공유기기 비효율 |

---

## 5. HTTPS 캐싱 핵심 과제

현재 대부분 콘텐츠가 HTTPS이므로 캐싱을 위해 아래 중 하나 선택 필수:

| 방법 | 설명 | 적합 상황 |
|------|------|-----------|
| **SSL Bump (MITM)** | 프록시가 CA 역할하여 TLS 복호화/재암호화 | MDM으로 CA 배포 가능한 관리 기기 |
| **리버스 프록시 SSL 터미네이션** | 특정 도메인을 로컬 프록시가 대신 응답 | 대상 도메인이 명확한 경우 |
| **플랫폼 제공자 협력** | 캐시 친화적 URL/에지 노드 프로그램 | 장기 해결책 |

**인증서 배포 방법**: MDM(Jamf, Intune), GPO(Active Directory), WPAD/DHCP

---

## 6. 콘텐츠 유형별 캐싱 전략

| 콘텐츠 유형 | 캐싱 가능성 | 전략 |
|-------------|:-----------:|------|
| 교과서 HTML/EPUB/PDF | 높음 | `Cache-Control: public, max-age=30d` |
| 이미지, CSS, JS, 폰트 | 높음 | 장기 캐싱 + 버전 기반 URL |
| 비디오(MP4/HLS) | 중간 | Range Request 처리 필요 |
| AI 개인화/학습 이력 API | 불가 | 프록시 우회 (DIRECT) |
| DRM 라이선스 요청 | 불가 | 프록시 우회 |
| DRM 암호화 파일 본체 | 가능 | 파일은 동일, 복호화는 클라이언트 |

**핵심**: 트래픽의 대부분은 정적 콘텐츠(이미지, 비디오, 문서)이므로 이것만 캐싱해도 **대역폭 70~90% 절감** 가능.

---

## 7. 단계별 구현 전략

### Phase 0: 사전 조사 (최우선)

- 디지털 교과서 플랫폼이 사용하는 **실제 도메인/CDN 도메인** 파악
- URL 구조 분석 (토큰 기반? 버전 기반? 정적 경로?)
- DRM/인증 방식 확인
- 이 조사 결과가 이후 모든 설정을 결정

### Phase 1: PoC (1주 이내)

**Nginx 리버스 프록시 + dnsmasq + 내부 CA**

1. 내부 CA 생성 (openssl)
2. 대상 도메인 인증서 발급
3. dnsmasq로 대상 도메인 → 캐시 서버 IP 오버라이드
4. Nginx 리버스 프록시 + 캐시 설정
5. 테스트 iPad에 CA 수동 설치 후 동작 확인

```nginx
# /etc/nginx/conf.d/textbook-cache.conf
proxy_cache_path /var/cache/nginx/textbook
    levels=1:2 keys_zone=textbook_cache:100m
    max_size=50g inactive=30d use_temp_path=off;

server {
    listen 443 ssl;
    server_name textbook-provider.com;

    ssl_certificate     /etc/nginx/ssl/textbook-provider.com.crt;
    ssl_certificate_key /etc/nginx/ssl/textbook-provider.com.key;

    location ~* \.(jpg|jpeg|png|gif|svg|webp|woff2|css|js|pdf|epub)$ {
        proxy_pass https://real-textbook-provider.com;
        proxy_cache textbook_cache;
        proxy_cache_valid 200 30d;
        proxy_cache_use_stale error timeout updating;
        add_header X-Cache-Status $upstream_cache_status;
    }

    location ~* /api/ {
        proxy_pass https://real-textbook-provider.com;
        proxy_no_cache 1;
    }
}
```

- **기대 효과**: 해당 도메인 대역폭 70~90% 절감

### Phase 2: 배포 및 안정화 (1개월 내)

- MDM으로 전체 iPad에 CA 인증서 배포
- 추가 교과서 도메인 확장
- Pre-warming 크론잡 설정 (수업 전날 인기 콘텐츠 사전 캐싱)
- Prometheus + Grafana 모니터링 스택
- 캐시 히트율/대역폭 절감 측정

### Phase 3: 장기 (1학기 내)

- 교과서 플랫폼 제공자와 협력 (캐시 친화적 API, 에지 노드 프로그램)
- 또는 학교용 오프라인 패키지 요청
- 이것이 가장 깨끗하고 지속 가능한 근본 해결책

---

## 8. 하드웨어 요구 사양 (중규모 학교 기준: 1,000명)

| 항목 | 사양 |
|------|------|
| CPU | 4코어+ (TLS 처리 고려) |
| RAM | 16GB (OS + 메모리 캐시 + 버퍼) |
| 캐시 스토리지 | 512GB NVMe SSD |
| OS 스토리지 | 128GB (OS/로그) |
| 네트워크 | 1Gbps NIC |
| **예상 비용** | 기존 서버 재활용 또는 약 100~200만원 |

---

## 9. 시나리오별 권장 솔루션

| 시나리오 | 권장 솔루션 | 이유 |
|----------|------------|------|
| **예산 있음 + IT 인력 부족** | ApplianSys CACHEBOX | 교육 특화 어플라이언스, 플러그앤플레이 |
| **예산 제한 + 기본 IT 역량** | pfSense + Squid | 무료, GUI 관리, 방화벽 통합 |
| **IT 역량 있음 + 고성능** | Nginx 리버스 프록시 | 최대 유연성, 세밀한 제어 |
| **교육청/학군 수준** | Apache Traffic Control | 다중 학교 계층적 CDN |

**iPad 환경에서는 모든 시나리오에서 리버스 프록시 + DNS 방식이 기본** — 포워드 프록시는 MDM 관리 기기에만 보조적으로 사용 가능.

---

## 10. 핵심 결론

1. **선택한 접근법**: 리버스 프록시 + Split-Horizon DNS — iPad에 설정 변경 없이 동작하는 유일한 현실적 방식
2. **최우선 과제**: 디지털 교과서 플랫폼의 실제 도메인/URL 구조/인증 방식 파악
3. **가장 실용적인 첫 단계**: Nginx 리버스 프록시 + dnsmasq + 내부 CA → PoC 1주 내 가능, 대역폭 70~90% 절감
4. **장기 전략**: 교과서 플랫폼 제공자와의 협력 (캐시 친화적 설계, 에지 노드 제공)
5. **DRM/토큰 인증이 있는 경우**: 네트워크 캐싱 효과 제한 → 플랫폼 협력이 더 중요
6. **클라우드 CDN은 이 문제에 도움 안 됨**: 병목이 외부 회선이므로 온프레미스 캐싱만 유효
