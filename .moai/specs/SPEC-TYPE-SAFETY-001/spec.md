# SPEC-TYPE-SAFETY-001

## 메타데이터

| 항목 | 값 |
|------|-----|
| ID | SPEC-TYPE-SAFETY-001 |
| 제목 | 플러그인-서버 이벤트 타입 안전성 및 테스트 계약 강화 |
| 우선순위 | High |
| 영역 | packages/plugin, packages/server |
| 관련 | SPEC-RENAME-FIX-001, 폴링 에러 수정 |
| 상태 | completed |
| 완료일 | 2026-04-21 |

---

## 1. 문제 서술

플러그인에 `strictNullChecks: true`가 활성화되어 있으나 **26건의 TypeScript 에러**가 방치 중. 에러 유형:

| 카테고리 | 에러 수 | 예시 |
|----------|---------|------|
| OfflineQueueItem 속성명 불일치 (`file_path` vs `filePath`) | 10건 | `api-client.ts:232`, `sync-engine.ts:86` |
| BatchResultItem 누락 속성 (`path`, `hash`) | 8건 | `sync-engine.ts:415-428` |
| ConflictQueueItem 속성명 불일치 (`localContent` vs `local_content`) | 4건 | `sync-engine.ts:586`, `ui/conflict-queue-view.ts:50-62` |
| WS 클라이언트 속성명 (`serverUrl` vs `server_url`) | 1건 | `sync-engine.ts:853` |
| Obsidian App 타입 불일치 | 1건 | `conflict.ts:205` |

또한 서버-플러그인 간 이벤트 스키마 계약이 명시적이지 않아, 서버 응답 필드 변경 시 플러그인에서 감지 불가.

### 근본 원인

1. TypeScript 에러를 경고로만 취급하고 수정하지 않음 (빌드는 성공하지만 런타임 에러 유발)
2. 서버 응답 스키마와 플러그인 타입이 수동 관리되어 어긋남
3. 테스트 mock 데이터가 실제 서버 응답 스키마와 무관하게 작성됨

---

## 2. 요구사항 (EARS 형식)

### REQ-TS-001: 기존 TypeScript 에러 전면 수정

**플러그인 코드는** `npx tsc --noEmit` 실행 시 **0건의 에러를 출력해야 한다 (shall)**

- `OfflineQueueItem` 타입의 속성명을 일관되게 통일 (`filePath` 또는 `file_path` 중 하나)
- `BatchResultItem` 타입에 `path`, `hash` 속성 추가
- `ConflictQueueItem` 타입의 속성명 통일
- WS 클라이언트 설정 속성명 수정 (`server_url`)
- Obsidian `App` 타입 이슈 해결

### REQ-TS-002: SyncEvent Zod 스키마 생성

**공유 모듈은** `SyncEventSchema` Zod 스키마를 **정의해야 한다 (shall)**

```typescript
export const SyncEventSchema = z.object({
  id: z.string().uuid(),
  event_type: z.enum(['created', 'updated', 'deleted', 'moved']),
  file_path: z.string().nullable(),
  file_type: z.string().nullable().optional(),
  device_id: z.string(),
  from_path: z.string().nullable().optional(),
  sequence: z.number().nullable().optional(),
  created_at: z.string(),
});
```

위치: `packages/plugin/src/schemas/sync-event.ts`

### REQ-TS-003: 테스트 mock 데이터 스키마 검증

**모든 테스트는** mock SyncEvent 데이터를 `SyncEventSchema.parse()`로 **검증해야 한다 (shall)**

- 테스트 헬퍼 함수 `createMockSyncEvent()` 생성
- 모든 테스트의 mock 이벤트 데이터를 헬퍼로 교체
- 스키마 불일치 시 테스트 즉시 실패

### REQ-TS-004: 계약 테스트 (Contract Test)

**CI는** 서버 OpenAPI 스펙과 플러그인 Zod 스키마의 일치성을 **검증해야 한다 (shall)**

- 서버의 `SyncEvent` 응답 스키마를 Zod 스키마로 변환
- 변환된 스키마와 플러그인의 `SyncEventSchema`가 호환되는지 검증
- CI 파이프라인에 계약 테스트 추가

---

## 3. 인수 기준

### AC-001: TypeScript 에러 0건
**Given** 플러그인 코드 베이스에서
**When** `npx tsc --noEmit` 실행 시
**Then** 에러가 0건이어야 함

### AC-002: Zod 스키마가 실제 서버 응답과 일치
**Given** 서버에서 SyncEvent 응답을 생성할 때
**When** 응답을 `SyncEventSchema.parse()`로 검증하면
**Then** 파싱 에러 없이 통과해야 함

### AC-003: mock 데이터 스키마 위반 감지
**Given** 테스트의 mock 이벤트 데이터가
**When** 서버 스키마와 불일치하는 필드를 포함하면
**Then** `SyncEventSchema.parse()`가 즉시 실패해야 함

### AC-004: 기존 테스트 회귀 없음
**Given** 변경 사항 적용 후
**When** 전체 테스트 스위트 실행 시
**Then** 모든 기존 테스트가 통과해야 함

---

## 4. 변경 파일 상세

### 4.1 `packages/plugin/src/types.ts` 또는 관련 타입 파일
- `OfflineQueueItem`, `BatchResultItem`, `ConflictQueueItem` 타입 수정

### 4.2 `packages/plugin/src/api-client.ts`
- 속성명 수정 (file_path → filePath 등)

### 4.3 `packages/plugin/src/sync-engine.ts`
- 속성명 수정, 타입 가드 추가

### 4.4 `packages/plugin/src/schemas/sync-event.ts` (신규)
- SyncEventSchema Zod 스키마 정의

### 4.5 `packages/plugin/tests/` (다수)
- mock 이벤트 데이터를 createMockSyncEvent()로 교체

---

## 5. 위험 및 완화

| 위험 | 확률 | 영향 | 완화 |
|------|------|------|------|
| 타입 수정으로 인한 런타임 동작 변경 | 중 | 중 | 기존 테스트로 회귀 검증 |
| Zod 런타임 오버헤드 | 낮음 | 낮음 | 테스트 전용으로 제한 |
| OpenAPI-Zod 변환 불일치 | 중 | 낮음 | 계약 테스트로 검증 |
