# Vector - 프로덕트 명세서

## 프로젝트 개요

**프로젝트명**: Vector  
**설명**: 자체 호스팅 옵시디언 동기화 시스템  
**타겟 사용자**: 기술에 익숙한 옵시디언 사용자, 개발자, 다기기 작업 환경을 사용하는 전문가  
**기술 스택**: Node.js 22 LTS + Fastify 5 + Drizzle ORM + PostgreSQL 16 + MinIO + Docker

---

## 핵심 기능

### 1. 멀티디바이스 실시간 Vault 동기화
- iPhone, macOS, Ubuntu 등 여러 기기 간 실시간 동기화
- 파일 수준 변경 감지와 즉각적인 전파
- 네트워크 상태에 따른 스마트 폴백 메커니즘

### 2. 파일 버전 관리
- 최소 30일간 파일 버전 이력 유지
- 자동 백업 및 롤백 기능
- 변경 내역 추적 및 비교

### 3. 충돌 탐지 및 해결
- 자동 충돌 탐지 시스템
- 충돌 파일 자동 생성
- 사용자 친화적인 충돌 해결 인터페이스

### 4. AI 접근 통합
- LLM 도구 사용을 통한 REST API
- Vault 파일 읽기/쓰기/검색 기능
- AI가 작성한 파일의 즉각적인 반영

### 5. 옵시디언 네이티브 플러그인
- 타입스크립트로 개발된 네이티브 플러그인
- 원 UX 경제 유지
- 풀 통합된 동기화 엔진

### 6. 인프라 통합
- Proxmox + Docker 환경 완벽 지원
- Caddy 리버스 프록시 통합
- 컨테이너화된 배포 아키텍처

---

## 사용 사례

### 1. 개인 작업 환경
- 여러 개인 기기 간 문서 동기화
- 작업 진행 상태 유지
- 자동 백업으로 데이터 보호

### 2. 팀 협업
- 멤버 간 문서 공유 및 동기화
- 변경 이력 추적
- 충돌 방지 및 해결

### 3. AI 기반 작업 보조
- AI를 통한 문서 자동 생성
- 스마트 검색 및 분석
- 자동화된 콘텐츠 관리

### 4. 보안 및 개인정보 보호
- 자체 호스팅으로 데이터 통제
- API 키 기반 인증
- 암호화된 통신

---

## 비목표 (Non-goals)

### 1. 클라우드 서비스
- 상업적인 동기화 서비스 제공 아님
- 제3자에 의존하는 저장소 불가
- 외부 API 의존성 최소화

### 2. 복잡한 공동 작업
- 실시간 여러 사용자 동시 편집 지원 안 함
- 복잡한 권한 관리 시스템 불필요
- 락 메커니즘 단순화

### 3. 모바일 앱
- 옵시디언 플랫폼에만 집중
- 크로스 플랫폼 모바일 앱 개발 불필요
- 웹 인터페이스 간소화

### 4. 고급 분석
- 복잡한 데이터 분석 기능 불필요
- 사용자 행동 분석 제외
- 통계 기능 기본 수준으로 제한

---

## 개발 로드맵

### P0: MD→DB 검증 (1일)
- 기술 검증 및 개념 증명
- 데이터베이스 스키마 설계 검토
- 초기 아키텍처 확인

### P1: 기반 구축 (3-5일)
- 전체 데이터베이스 스키마 구현
- 마크다운 내용 PostgreSQL 직접 저장, MinIO는 바이너리 첨부파일 전용
- Docker Compose 환경 설정

### P2: API 코어 (5-7일)
- 모든 REST 엔드포인트 구현
- 기본 인증 시스템
- 파일 업로드/다운로드 기능

### P3: 실시간 기능 (4-6일)
- PostgreSQL LISTEN/NOTIFY 구현
- WebSocket 통신
- 폴링 폴백 메커니즘

### P4: 플러그인 MVP (6-8일)
- 옵시디언 플러그인 기본 기능
- 업로드/다운로드/WS 연동
- 최소 기능 제품 완성

### P5: 충돌 관리 (4-5일)
- 충돌 탐지 알고리즘
- 충돌 파일 생성
- 복구 메커니즘 구현

### P6: AI 접근 (5-7일)
- LLM Tool Use 명령어 체계 구현
- Vault 검색 기능
- 디바이스 추적 시스템

---

## AI 접근 아키텍처 (P6)

### 개요

LLM이 Vault의 문서를 안전하게 읽고, 쓰고, 수정하고, 검색하기 위한 **규격화된 Tool Commands**를 제공합니다. LLM이 직접 SQL을 작성하지 않고, 정의된 명령어를 통해서만 문서에 접근합니다.

### 아키텍처

```
┌─────────────────────────────────────────────────────────┐
│  클라이언트                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐ │
│  │ Obsidian    │  │ LLM Agent   │  │ CLI / 기타      │ │
│  │ Plugin      │  │ (Tool Use)  │  │ 클라이언트      │ │
│  └──────┬──────┘  └──────┬──────┘  └────────┬────────┘ │
│         │                │                   │          │
│    REST API         Tool Commands       REST API       │
└─────────┼────────────────┼───────────────────┼──────────┘
          │                │                   │
          ▼                ▼                   ▼
┌─────────────────────────────────────────────────────────┐
│  Fastify Server                                         │
│  ┌─────────────────────────────────────────────────────┐│
│  │  Service Layer (공유)                                ││
│  │  ├── uploadFile()   ── write_document                ││
│  │  ├── getFile()      ── read_document                 ││
│  │  ├── deleteFile()   ── delete_document               ││
│  │  ├── (신규) searchFiles()  ── search_documents       ││
│  │  └── (신규) editFile()     ── edit_document          ││
│  └─────────────────────────────────────────────────────┘│
│                         │                               │
│         ┌───────────────┼───────────────┐               │
│         ▼                               ▼               │
│  ┌─────────────┐               ┌─────────────┐         │
│  │ PostgreSQL  │               │   MinIO     │         │
│  │ (md TEXT)   │               │ (attachment)│         │
│  └─────────────┘               └─────────────┘         │
└─────────────────────────────────────────────────────────┘
```

### LLM Tool 명령어 정의

#### read_document
문서 내용 조회. 경로로 특정 파일을 읽습니다.

```json
{
  "name": "read_document",
  "params": { "path": "notes/todo.md" },
  "returns": {
    "content": "# 할일\n- [x] 회의",
    "hash": "abc123...",
    "version": 3,
    "updated_at": "2026-04-17T10:00:00Z"
  }
}
```

#### write_document
문서 생성 또는 전체 수정. 버전, 해시, 동기화 이벤트를 자동 생성합니다.

```json
{
  "name": "write_document",
  "params": {
    "path": "notes/new-topic.md",
    "content": "# 새 주제\n내용..."
  },
  "내부 처리": [
    "1. SHA-256 해시 자동 계산",
    "2. files 테이블에 content와 함께 upsert",
    "3. fileVersions에 새 버전 레코드 생성",
    "4. syncEvents에 'created' 또는 'updated' 이벤트 발행",
    "5. 동기화 대상 기기에 변경 전파"
  ],
  "returns": {
    "id": "uuid...",
    "version": 1,
    "hash": "def456..."
  }
}
```

#### edit_document
문서 부분 수정. old_text를 new_text로 치환합니다.

```json
{
  "name": "edit_document",
  "params": {
    "path": "notes/meeting.md",
    "old_text": "1월 10일",
    "new_text": "1월 15일"
  },
  "내부 처리": [
    "1. 현재 content 읽기",
    "2. 문자열 치환 (old_text → new_text)",
    "3. 치환 횟수 검증 (0건이면 에러 반환)",
    "4. 해시 계산 → 버전 생성 → 이벤트 발행"
  ],
  "returns": {
    "version": 4,
    "hash": "ghi789...",
    "changes": 1
  }
}
```

#### search_documents
Vault 전체 문서 검색. pg_trgm 기반 풀텍스트 검색을 사용합니다.

```json
{
  "name": "search_documents",
  "params": {
    "query": "회의록",
    "limit": 10,
    "folder": "notes/"
  },
  "내부 처리": [
    "1. pg_trgm 인덱스로 content 컬럼 검색",
    "2. 관련도 순 정렬",
    "3. 본문에서 매치된 컨텍스트 스니펫 추출"
  ],
  "returns": [
    {
      "path": "notes/meeting-2026-01.md",
      "snippet": "...## 회의록\n- 날짜: 1월 15일...",
      "score": 0.92
    }
  ]
}
```

#### list_documents
문서 목록 조회. 폴더 단위 필터링을 지원합니다.

```json
{
  "name": "list_documents",
  "params": {
    "folder": "notes/",
    "recursive": true
  },
  "returns": [
    { "path": "notes/todo.md", "hash": "...", "updated_at": "..." },
    { "path": "notes/meeting.md", "hash": "...", "updated_at": "..." }
  ]
}
```

#### upload_attachment
이미지, PDF 등 바이너리 첨부파일 업로드. MinIO에 저장합니다.

```json
{
  "name": "upload_attachment",
  "params": {
    "path": "images/screenshot.png",
    "data": "<base64-encoded>"
  },
  "내부 처리": [
    "1. MinIO에 바이너리 저장",
    "2. files 테이블에 fileType='attachment'로 메타데이터 저장",
    "3. content는 NULL, storageKey로 MinIO 참조",
    "4. 동기화 이벤트 발행"
  ],
  "returns": { "id": "uuid...", "url": "/v1/vault/:id/attachment/images/screenshot.png" }
}
```

### 규격화로 얻는 이점

| 이점 | 설명 |
|------|------|
| **버전 규칙 강제** | LLM이 잊어도 Tool 내부에서 fileVersions 자동 생성 |
| **해시 무결성** | content hash 자동 계산, LLM이 신경 쓸 필요 없음 |
| **동기화 보장** | sync event 자동 발행, AI 생성/수정 문서가 모든 기기에 즉시 전파 |
| **검증 일관성** | 경로 순회 방지, 크기 제한, 권한 체크를 Tool에서 통합 적용 |
| **Plugin과 동일 규칙** | Service Layer 공유로 플러그인·LLM·CLI 모두 같은 로직 적용 |
| **감사 추적** | Tool 호출 로그로 LLM이 수행한 작업 추적 가능 |

### P7: 최적화 및 마무리 (3-4일)
- 설정 UI 개선
- 상태 표줄바 구현
- 오류 처리 및 모니터링
- 문서화 완성

### P8: API 계약 일원화 (완료)
- OpenAPI 3.0.3 명세 도입 (docs/api/openapi.yaml)
- openapi-typescript로 서버/플러그인 타입 자동 생성
- 모든 JSON 응답 필드를 snake_case로 표준화
- 직렬화 계층(src/utils/serialize.ts)으로 내부 camelCase 변환 분리
- 플러그인 타입 id 불일치 수정 (number → string UUID)

---

## 해결 필요 이슈

### ISSUE-001: 볼트 용량 쿼터 및 MD-첨부파일 링크 무결성

**상태**: 미해결 (P5 완료 후 식별)

**문제**:
현재 볼트별 용량 제한이 없고, 단일 파일 크기 제한도 Raw 마크다운(10MB)에만 적용됨.
첨부파일(png, jpg, pdf, mp4 등)은 크기 제한 없이 업로드 가능.

**발생 시나리오**:
1. 대용량 첨부파일(pptx, mp4 등) 업로드 → MinIO 디스크 만료
2. 마크다운에 `![[presentation.pptx]]` 링크가 있으나 실제 파일 업로드 실패
3. 다른 기기에서 마크다운 열람 → 링크 깨짐, 원인 불명확
4. MD와 첨부파일이 독립적으로 처리되어 불일치 상태 발생 가능

**필요 조치**:
- [ ] 단일 첨부파일 크기 제한 설정 (권장: 50MB)
- [ ] 볼트별 총 용량 쿼터 및 사용량 조회 API
- [ ] 업로드 실패 시 MD-첨부파일 링크 무결성 검증
- [ ] 용량 초과 시 명확한 에러 응답 (413 Payload Too Large / 507 Insufficient Storage)
- [ ] 정리(cleanup) 작업 시 링크된 파일은 보존 보장

---

## 성능 목표

### 응답 시간
- API 응답: < 200ms
- WebSocket 메시지: < 50ms
- 파일 업로드: < 1GB/분

### 안정성
- 가동률: 99.9%
- 데이터 무결성: 100%
- 충돌률: < 0.1%

### 확장성
- 동시 사용자: 100+
- 동시 연결: 1000+
- 파일 크기: 최대 10GB

---

## 성공 지표

### 기술적 지표
- 테스트 커버리지: 85%+
- 버전 관리 정확도: 99.9%
- 실시간 동기지성: 95%+

### 사용자 경험 지표
- 플러그인 안정성: 4.8/5
- 동기속도: 사용자 만족도 90%+
- 오류 발생률: < 1%

### 운영 지표
- 배포 간격: 주 1회
- 모니터링 경고: < 5/주
- 백업 성공률: 100%