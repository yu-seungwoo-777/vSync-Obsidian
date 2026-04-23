---
id: SPEC-PLUGIN-BUGFIX-001
version: 1.0.0
status: draft
created_at: 2026-04-22
updated: 2026-04-22
author: moai
priority: critical
labels: [bugfix, plugin, obsidian, typescript]
---

# 구현 계획: SPEC-PLUGIN-BUGFIX-001

## 마일스톤 구성

본 SPEC은 의존성 관계와 위험도에 따라 5단계 마일스톤으로 분해한다. 각 마일스톤은 선행 마일스톤 완료 후 시작한다.

---

## Milestone 1: Critical Bug Fixes (Priority: Critical)

REQ-001, REQ-002, REQ-003

### 순서 및 의존성

1. **REQ-003 (타입 통합)** 을 먼저 수행
   - `ConflictQueueItem`/`DiffOperation`의 단일 소스를 `types.ts`에 확립
   - 이후 모든 타입 참조가 올바른 소스를 가리키게 됨
   - **이유**: 다른 수정 사항이 타입을 참조하므로 타입 체계가 먼저 정리되어야 함

2. **REQ-001 (큐 복원)** 수행
   - `_isValidQueueItem`에서 `retry_count` → `retryCount` 수정
   - **이유**: 독립적 수정이나 타입 통합 후 컴파일 검증 필요

3. **REQ-002 (경로 인코딩)** 수행
   - `deleteFile`에 `encodeURIComponent` 추가
   - **이유**: 완전히 독립적인 수정

### 수정 파일

| 파일 | 변경 내용 | 위험도 |
|------|----------|--------|
| `types.ts` | 기존 타입 정의 유지 (변경 없음) | 낮음 |
| `conflict.ts` | 중복 타입 정의 제거, `types.ts`에서 재export | 중간 |
| `main.ts` | `_isValidQueueItem` 프로퍼티명 수정 | 낮음 |
| `api-client.ts` | `deleteFile` 경로 인코딩 추가 | 낮음 |

### 테스트 전략

- `types.ts` 재export 후 기존 임포트 경로가 정상 동작하는지 확인
- 오프라인 큐 복원 시나리오 테스트 (retryCount 검증)
- 한글/공백 파일명 삭제 API 테스트

---

## Milestone 2: Security Fix (Priority: High)

REQ-004

### 순서 및 의존성

- Milestone 1 완료 후 독립 수행 가능
- `settings.ts`의 `VSyncSettings` 인터페이스 변경 필요 여부 확인

### 수정 파일

| 파일 | 변경 내용 | 위험도 |
|------|----------|--------|
| `ui/connect-modal.ts` | 로그인 성공 후 `password` 필드 초기화 | 중간 |

### 위험 분석

- **위험**: 기존에 저장된 비밀번호가 다른 곳에서 참조될 가능성
- **완화**: `settings.ts`에서 `password` 필드를 참조하는 모든 위치 사전 조사 필요
- **주의**: 세션 토큰 만료 시 재인증 플로우가 정상 동작하는지 확인

### 테스트 전략

- 로그인 성공 후 `settings.password`가 빈 문자열인지 확인
- 세션 토큰 만료 시 재인증 모달 표시 확인

---

## Milestone 3: Logic Fixes (Priority: High)

REQ-007, REQ-008, REQ-009

### 순서 및 의존성

1. **REQ-008 (null App)** 을 먼저 수행
   - `conflict.ts`의 null App 처리
   - **이유**: REQ-003에서 타입 정리가 이미 완료됨

2. **REQ-007 (auto-merge)** 수행
   - `sync-engine.ts`의 `_tryAutoMerge` 로직 수정
   - **이유**: 독립적이지만 병합 충돌 처리와 연관

3. **REQ-009 (바이너리 알림)** 수행
   - `_persistQueue`에 사용자 알림 추가
   - **이유**: 완전히 독립적인 수정

### 수정 파일

| 파일 | 변경 내용 | 위험도 |
|------|----------|--------|
| `conflict.ts` | null App 가드 및 대체 경로 | 높음 |
| `sync-engine.ts` | `_tryAutoMerge` 병합 로직 수정 | 높음 |
| `main.ts` | `_persistQueue` 알림 추가 | 낮음 |

### 위험 분석

- **REQ-007 (높음)**: 병합 로직 변경이 기존 동기화 동작에 영향. local 우선이 아닌 실제 병합 시 예상치 못한 동작 가능. 기본 전략은 server 우선 병합으로 설정.
- **REQ-008 (높음)**: null App 가드 추가 시 충돌 해결 UI 경로와 비-UI 경로의 분기가 명확해야 함.
- **REQ-009 (낮음)**: 알림 추가만으로 기존 동작 변경 없음.

### 테스트 전략

- `_tryAutoMerge`에 대한 단위 테스트: local만, server만, 둘 다 빈 값, 둘 다 내용 있음
- null App 컨텍스트에서 충돌 해결 시 기본 동작 확인
- 바이너리 파일 큐 필터링 시 Notice 호출 확인

---

## Milestone 4: Code Quality — Naming (Priority: Medium)

REQ-005, REQ-006

### 순서 및 의존성

- Milestone 1-3 완료 후 수행
- **이유**: 명명 변경이 미치는 영향 범위가 넓어, 핵심 버그 수정이 먼저 완료되어야 회귀 위험 감소

### 수정 파일

| 파일 | 변경 내용 | 위험도 |
|------|----------|--------|
| `api-client.ts` | `_base_url` → `_baseUrl`, `_vault_id` → `_vaultId`, `_device_id` → `_deviceId` | 중간 |
| `sync-engine.ts` | `_base_url` → `_baseUrl`, `_vault_id` → `_vaultId` | 중간 |
| `sync-logger.ts` | `get_all` → `getAll`, `on_update` → `onUpdate` | 중간 |
| `settings.ts` | snake_case 필드 존재 시 변경 | 낮음 |
| `services/ws-client.ts` | snake_case 필드 존재 시 변경 | 낮음 |

### 위험 분석

- **위험**: 명명 변경이 널리 퍼져 있어 누락된 참조로 인한 컴파일 에러 가능
- **완화**: TypeScript 컴파일러가 누락된 참조를 자동 감지함
- **전략**: 각 파일의 변경 후 즉시 `tsc --noEmit` 실행하여 컴파일 검증

### 테스트 전략

- 명명 변경 후 전체 테스트 스위트 실행
- `tsc --noEmit` 컴파일 검증

---

## Milestone 5: Minor Cleanups (Priority: Low)

REQ-010, REQ-011, REQ-012

### 순서 및 의존성

- 모든 선행 마일스톤 완료 후 수행
- **이유**: 포맷팅/클린업은 기능 변경 완료 후 적용하여 변경 이력을 명확히 함

### 수정 파일

| 파일 | 변경 내용 | 위험도 |
|------|----------|--------|
| `main.ts` | 들여쓰기 8-공백 → 4-공백 (REQ-010) | 낮음 |
| `main.ts` | `.find()` 콜백 타입 어노테이션 제거 (REQ-011) | 낮음 |
| `api-client.ts` | `Content-Type` → `contentType` 표준화 (REQ-012) | 낮음 |

### 위험 분석

- 모든 변경이 낮은 위험도
- 포맷팅 변경은 diff 노이즈를 증가시키므로 마지막에 수행

### 테스트 전략

- 전체 테스트 스위트 실행
- `tsc --noEmit` 컴파일 검증
- ESLint 검증 (설정된 경우)

---

## MX 태그 전략

수정되는 모든 파일에 @MX 태그를 적용한다:

### Critical/Low Modified Files

| 파일 | MX 태그 | 적용 위치 | 이유 |
|------|---------|----------|------|
| `main.ts:_isValidQueueItem` | `@MX:WARN` | 메서드 선언 | 큐 복원 핵심 로직 |
| `api-client.ts:deleteFile` | `@MX:NOTE` | 메서드 선언 | 경로 인코딩 명시 |
| `conflict.ts:handleMergeConflict` | `@MX:WARN` | null 가드 위치 | null App 안전 처리 |
| `sync-engine.ts:_tryAutoMerge` | `@MX:ANCHOR` | 메서드 선언 | fan_in >= 3 예상 |
| `main.ts:_persistQueue` | `@MX:NOTE` | 바이너리 필터링 위치 | 사용자 알림 명시 |

### 태그 템플릿

```
// @MX:WARN [SPEC-PLUGIN-BUGFIX-001] 오프라인 큐 복원 핵심 검증 — retryCount 프로퍼티명 변경 금지
// @MX:NOTE [SPEC-PLUGIN-BUGFIX-001] deleteFile 경로 인코딩 필수 — 비ASCII 파일명 삭제 실패 방지
// @MX:ANCHOR [SPEC-PLUGIN-BUGFIX-001] 자동 병합 로직 — local+server 콘텐츠 모두 사용 필수
```

---

## 전체 의존성 그래프

```
Milestone 1 (Critical)
    ├── REQ-003 (타입 통합) ← 선행
    ├── REQ-001 (큐 복원)
    └── REQ-002 (경로 인코딩)
         │
         ▼
Milestone 2 (Security)
    └── REQ-004 (비밀번호 제거)
         │
         ▼
Milestone 3 (Logic)
    ├── REQ-008 (null App) ← 선행
    ├── REQ-007 (auto-merge)
    └── REQ-009 (바이너리 알림)
         │
         ▼
Milestone 4 (Naming)
    ├── REQ-005 (private 필드)
    └── REQ-006 (메서드)
         │
         ▼
Milestone 5 (Cleanups)
    ├── REQ-010 (들여쓰기)
    ├── REQ-011 (타입 어노테이션)
    └── REQ-012 (헤더)
```

---

## 참조 구현 (research.md 기반)

### REQ-001 수정 예시

```typescript
// BEFORE (main.ts:622)
typeof obj.retry_count === 'number'

// AFTER
typeof obj.retryCount === 'number'
```

### REQ-002 수정 예시

```typescript
// BEFORE (api-client.ts:316)
const url = buildApiUrl(this._base_url, this._vault_id, 'file', path);

// AFTER
const url = buildApiUrl(this._base_url, this._vault_id, 'file', encodeURIComponent(path));
```

### REQ-003 수정 예시

```typescript
// BEFORE (conflict.ts:35-56) — 중복 정의 제거
export type ConflictQueueItem = { ... };

// AFTER (conflict.ts) — types.ts에서 재export
export type { ConflictQueueItem, DiffOperation } from './types';
```

### REQ-004 수정 예시

```typescript
// BEFORE (connect-modal.ts:293-299)
const newSettings: Partial<VSyncSettings> = {
    password: this._password,  // 평문 저장
    ...
};

// AFTER
const newSettings: Partial<VSyncSettings> = {
    password: '',  // 세션 토큰으로 대체
    ...
};
```

### REQ-008 수정 예시

```typescript
// BEFORE (conflict.ts:204-205)
const modal = new conflictResolveModal(
    null as unknown as App,  // 위험!
    ...
);

// AFTER — null 가드 추가
if (!this._app) {
    // 프로그래매틱 기본 해결: server 우선
    resolve({ choice: 'server' });
    return;
}
const modal = new conflictResolveModal(this._app, ...);
```
