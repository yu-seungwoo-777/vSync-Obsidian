---
id: SPEC-SYNC-DELETE-001
version: 1.1.0
status: Implemented
created: 2026-04-23
updated: 2026-04-23
author: yu
priority: High
issue_number: ""
---

# SPEC-SYNC-DELETE-001: 삭제 동기화 3-Way 파일 존재 추적

## HISTORY

- 2026-04-23: v1.0.0 초기 작성. research.md 기반으로 EARS 요구사항 도출.

## 개요

다중 기기 환경에서 한 기기(A)가 파일을 삭제하면, 서버는 소프트 삭제(`deletedAt` 설정) 후 "deleted" 동기화 이벤트를 생성한다. 그러나 다른 기기(B)가 `performInitialSync()`를 수행하면 삭제된 파일이 "로컬에만 있는 파일"로 분류되어 **재업로드**되는 버그가 존재한다.

근본 원인: `performInitialSync()`가 2-way 비교(server vs local)만 수행하며, 이전에 알고 있던 파일 목록(base state)을 고려하지 않기 때문이다.

해결 방안: 기존 `hash_cache`(Map\<path, hash\>)를 base 상태로 활용한 3-way 파일 존재 추적과, 이벤트 우선 처리(event-first processing)를 결합하여 삭제 전파를 보장한다.

## 환경 및 전제조건

### 환경

- **플랫폼**: Obsidian 플러그인 (TypeScript) + Node.js 서버
- **동기화 엔진**: `packages/plugin/src/sync-engine.ts`
- **서버 API**: `packages/server/src/services/file.ts` (수정 없음)
- **저장소**: `hash_cache` — `data.json`에 `hash_cache` 필드로 영속화된 LRU 캐시 (최대 10,000 항목)

### 전제조건

- PRE-001: `hash_cache`는 클라이언트가 직접 관리하며 서버 상태와 무관하게 유지된다.
- PRE-002: 서버 `listFiles()`는 `WHERE deletedAt IS NULL` 조건으로 소프트 삭제된 파일을 제외한다.
- PRE-003: 서버 `deleteFile()`은 소프트 삭제 후 "deleted" 타입의 동기화 이벤트를 생성한다.
- PRE-004: 서버 `uploadFile()`은 소프트 삭제된 파일 재업로드 시 `deletedAt: null`로 복원한다.
- PRE-005: 빈 `hash_cache` (초기 연결) 시에는 기존 2-way 동작과 동일하게 동작한다.

## 요구사항

### REQ-001: 원격 삭제 감지 및 로컬 삭제 수행

**Event-Driven**: **When** `performInitialSync()`가 파일 목록을 비교할 때, 특정 파일이 `hash_cache`(base)에 존재하고 로컬에 존재하지만 서버 `listFiles()` 결과에 존재하지 않으면, 동기화 엔진은 **shall** 해당 파일을 로컬에서 삭제하고 `hash_cache`에서 제거한다.

> **판정 매트릭스**: base=O, server=X, local=O → 원격 삭제됨 → 로컬 삭제
>
> **현재 동작(버그)**: 재업로드. **개선안**: 로컬 삭제.

### REQ-002: 로컬 삭제 감지 및 서버 전파

**Event-Driven**: **When** `performInitialSync()`가 파일 목록을 비교할 때, 특정 파일이 `hash_cache`(base)에 존재하고 서버에 존재하지만 로컬에 존재하지 않으면, 동기화 엔진은 **shall** 해당 파일을 서버에서도 삭제(소프트 삭제 API 호출)하고 `hash_cache`에서 제거한다.

> **판정 매트릭스**: base=O, server=O, local=X → 로컬 삭제됨 → 서버에 삭제 전파
>
> **현재 동작**: 서버에서 다운로드. **개선안**: 서버에 삭제 전파.

### REQ-003: 이벤트 우선 처리 (초기 동기화)

**Event-Driven**: **When** `performInitialSync()`가 시작되면, 동기화 엔진은 **shall** 3-way 비교를 수행하기 전에 `getEvents(lastEventId)`를 호출하여 미처리 "deleted" 이벤트를 먼저 처리한다. 처리 과정에서 해당 파일을 로컬에서 삭제하고 `hash_cache`에서 제거한다.

> 이 요구사항은 3-way 판정의 안전망 역할을 한다. LRU 캐시 eviction 등으로 인해 base 정보가 누락된 경우에도 이벤트 기반 처리가 삭제 전파를 보장한다.

### REQ-004: 전체 동기화 시 이벤트 우선 처리

**Event-Driven**: **When** `performFullSync()`가 시작되면, 동기화 엔진은 **shall** 로컬 파일 업로드를 수행하기 전에 `getEvents(lastEventId)`를 호출하여 미처리 "deleted" 이벤트를 먼저 처리한다. 처리된 deleted 이벤트에 해당하는 파일은 업로드 대상에서 제외한다.

> **현재 동작(버그)**: 먼저 모든 로컬 파일을 업로드한 후 이벤트를 폴링하므로, 업로드로 인해 삭제된 파일이 복원되는 경쟁 상태가 발생한다.

### REQ-005: hash_cache 정확성 유지

**Ubiquitous**: 동기화 엔진은 **shall** 삭제된 파일(로컬 또는 원격)에 대해 `hash_cache`에서 해당 항목을 제거하여 base 상태의 정확성을 유지한다.

> `hash_cache`의 LRU 정책(최대 10,000 항목)으로 인해 오래된 항목은 자연스럽게 evict된다. 이 경우 base 정보가 없으므로 안전하게 기존 2-way 동작으로 fallback된다.

### REQ-006: 기존 2-way 동작 보존

**State-Driven**: **While** `hash_cache`가 비어 있거나 특정 파일의 base 정보가 없는 경우, 동기화 엔진은 **shall** 기존 2-way 비교(server vs local) 동작을 그대로 수행한다.

> 초기 연결 시나 LRU eviction 후에는 base 상태를 알 수 없으므로, 기존 동작(로컬에만 있으면 업로드, 서버에만 있으면 다운로드)을 유지한다.

## 3-Way 판정 매트릭스 (참고)

| base | server | local | 판정 | 개선안 |
|------|--------|-------|------|--------|
| O | O | O | 변경 없음 (해시 비교) | 기존과 동일 |
| O | O | X | 로컬 삭제됨 | 서버에 삭제 전파 (REQ-002) |
| O | X | O | **원격 삭제됨** | **로컬에서 삭제 (REQ-001)** |
| O | X | X | 양쪽 삭제됨 | 스킵 |
| X | O | O | 양쪽 새 파일 | 해시 비교 (기존과 동일) |
| X | O | X | 원격 새 파일 | 다운로드 (기존과 동일) |
| X | X | O | 로컬 새 파일 | 업로드 (기존과 동일) |
| X | X | X | 존재 불가 | 스킵 |

## 제약사항

- CON-001: 서버 코드(`packages/server/src/`)는 수정하지 않는다. 서버의 소프트 삭제, 이벤트 생성, `listFiles` 필터링 동작은 올바르다.
- CON-002: 기존 동기화 프로토콜(API 스키마, 이벤트 포맷)을 변경하지 않는다.
- CON-003: 데이터베이스 스키마 변경을 수반하지 않는다.
- CON-004: UI 컴포넌트(모달, 설정 화면 등)는 수정하지 않는다.
- CON-005: `hash_cache`의 LRU 정책과 최대 크기(10,000)는 변경하지 않는다.

## 제외 범위 (What NOT to Build)

- 서버 측 코드 수정 (서버 동작은 이미 올바름)
- 데이터베이스 스키마 변경
- UI 컴포넌트 수정 (충돌 해결 모달, 설정 화면 등)
- 타입 정의(`types.ts`) 변경
- API 클라이언트(`api-client.ts`) 변경
- 바이너리 파일 동기화 로직 변경 (바이너리도 동일한 3-way 판정 적용 대상이나, 판정 로직 자체는 경로 기반이므로 바이너리 특화 코드 불필요)
- 실시간(WebSocket) 동기화 모드 변경 (폴링 모드와 동일한 3-way 로직 공유)

## Implementation Notes (Sync Phase)

**Implemented**: 2026-04-23 (commit 565be73)
**Methodology**: TDD (RED-GREEN-REFACTOR)
**Files Modified**: 4 (1 source + 3 test files)

### Implementation Summary

| Component | Description | Lines |
|-----------|-------------|-------|
| `_determineFileAction()` | 3-way judgment pure function | ~20 |
| `performInitialSync()` | 3-way comparison replacing 2-way | ~80 |
| `_processDeletedEventsFirst()` | Event-first helper with security | ~70 |
| `performFullSync()` | Event-first before upload, exclude deleted | ~10 |

### Divergence from Plan

| Planned | Actual | Reason |
|---------|--------|--------|
| M1-M6 milestones | T1-T5 tasks | TDD-friendly reordering |
| 3 test files | 3 test files | As planned |
| No security changes | Zod validation + bulk delete limit + path validation | Evaluator feedback |

### Acceptance Criteria Status

| AC | Status |
|----|--------|
| AC-001 (Remote delete -> local delete) | PASS |
| AC-002 (Local delete -> server propagate) | PASS |
| AC-003 (Event-first in initial sync) | PASS |
| AC-004 (Event-first in full sync) | PASS |
| AC-005 (Empty cache -> 2-way preserved) | PASS |
| AC-006 (Both deleted -> no conflict) | PASS |
| AC-007 (Binary file delete) | PASS |
| AC-008 (hash_cache accuracy) | PASS |

### Test Coverage

- Total tests: 119 (8+6+3+3+4+7+88 existing)
- All pass, 0 regressions
- No server code changes
- No UI changes
