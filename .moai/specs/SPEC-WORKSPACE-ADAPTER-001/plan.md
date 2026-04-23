---
spec_id: SPEC-WORKSPACE-ADAPTER-001
version: 1.0.0
status: planned
created: "2026-04-21"
updated: "2026-04-21"
---

# 구현 계획: WorkspaceAdapter 인터페이스 도입

## 기술 접근

VaultAdapter 패턴(`sync-engine.ts:996-1014`, `main.ts:555-725`)을 그대로 따른다.

1. **인터페이스 정의**: `main.ts`에 WorkspaceAdapter 인터페이스 정의
   - VaultAdapter가 sync-engine.ts에 정의된 이유는 SyncEngine이 소비하기 때문
   - WorkspaceAdapter는 main.ts만 소비하므로 main.ts에 정의

2. **팩토리 메서드**: `_createWorkspaceAdapter()` 메서드 추가
   - `_createVaultAdapter()`와 동일한 방식
   - `this.app.workspace`를 캡처하여 클로저로 전달

3. **인스턴스 필드**: `_workspaceAdapter` 필드 추가
   - `onload()`에서 생성, 다른 메서드에서 사용

4. **호출 대체**: 5곳의 직접 호출을 어댑터로 교체

## 마일스톤

### M1: 인터페이스 및 팩토리 구현 (Priority: High)

1. `WorkspaceAdapter` 인터페이스를 `main.ts`에 정의
2. `_createWorkspaceAdapter()` 팩토리 메서드 구현
3. `_workspaceAdapter` 인스턴스 필드 추가 및 `onload()`에서 초기화

### M2: 직접 호출 교체 (Priority: High)

1. `onload()` line 115: `this.app.workspace.onLayoutReady` -> `_workspaceAdapter.onLayoutReady`
2. `_activateLogView()`: `getLeavesOfType` + `getRightLeaf` -> 어댑터 메서드
3. `activateConflictView()`: `getLeavesOfType` + `getRightLeaf` -> 어댑터 메서드
4. `_openFileFromSearch()`: `getAbstractFileByPath` + `openFile` -> `_workspaceAdapter.openFile`

### M3: 테스트 업데이트 (Priority: High)

1. `obsidian.ts` 모킹에 `getRightLeaf`, `getLeaf` + `openFile` 추가
2. `main.test.ts`에 WorkspaceAdapter 관련 테스트 추가
3. 기존 테스트의 `this.app.workspace` 직접 접근을 어댑터 경로로 업데이트

## 영향 범위

| 파일 | 변경 유형 | 설명 |
|------|-----------|------|
| `src/main.ts` | 수정 | 인터페이스 정의, 팩토리, 호출 교체 |
| `tests/mocks/obsidian.ts` | 수정 | workspace mock 보완 (getRightLeaf, getLeaf) |
| `tests/unit/main.test.ts` | 수정 | 어댑터 경로 테스트, 기존 테스트 업데이트 |

## 위험 및 완화

| 위험 | 가능성 | 영향 | 완화 |
|------|--------|------|------|
| `(workspace as any)` 캐스팅 동작 변경 | 낮음 | 중간 | 어댑터 내부에 캐스팅 로직 격리, 변경 시 영향 최소화 |
| 기존 테스트 실패 | 낮음 | 높음 | 기존 동작을 변경하지 않는 순수 리팩터링, 테스트 먼저 수정 |
| getRightLeaf 미지원 환경 | 중간 | 낮음 | null 체크 유지 (기존 패턴과 동일) |
