---
id: SPEC-OBSIDIAN-API-GAP-001
version: "1.0"
status: draft
created: "2026-04-21"
updated: "2026-04-21"
---

# 구현 계획: Obsidian Vault API 공식 메서드 전환

## 구현 순서

우선순위(높음 > 중간 > 낮음)에 따라 구현하며, 각 단계는 이전 단계에 의존하지 않아 독립적으로 진행 가능하다.

### 마일스톤 1: VaultAdapter 인터페이스 확장 (우선순위: HIGH)

**목표**: VaultAdapter 인터페이스에 새 메서드를 추가한다.

**작업 항목**:
1. `VaultAdapter` 인터페이스에 `process`, `trash`, `cachedRead` 메서드 시그니처 추가 (sync-engine.ts)
2. Obsidian 모킹 라이브러리에 stub 메서드 추가 (`tests/mocks/obsidian.ts`, `tests/mocks/vault.ts`)
3. 기존 테스트가 새 인터페이스에 맞게 통과하는지 확인

**산출물**: 확장된 VaultAdapter 인터페이스, 업데이트된 모킹 라이브러리

### 마일스톤 2: REQ-API-001 onLayoutReady 래핑 (우선순위: HIGH)

**목표**: `_startSync()`를 `onLayoutReady` 콜백으로 래핑한다.

**작업 항목**:
1. `main.ts:onload()`에서 `_startSync()` 호출을 `this.app.workspace.onLayoutReady(() => { ... })`로 래핑
2. `onLayoutReady` 이후에만 vault 이벤트 리스너가 등록되도록 보장
3. 오프라인 큐 flush도 `onLayoutReady` 이후에 수행되도록 이동
4. 단위 테스트: vault 시작 시 기존 파일에 대한 create 이벤트가 발생하지 않음을 검증

**산출물**: 수정된 `main.ts:onload()`, 통과하는 테스트

### 마일스톤 3: REQ-API-002 fileManager.renameFile 전환 (우선순위: HIGH)

**목표**: `_handleMovedEvent`에서 `write+delete` 대신 `fileManager.renameFile`을 사용한다.

**작업 항목**:
1. VaultAdapter에 `renameFile(oldPath, newPath)` 메서드 추가
2. `_createVaultAdapter()`에서 `app.fileManager.renameFile()`을 호출하도록 구현
3. `sync-engine.ts:_handleMovedEvent()`에서 `vault.write+vault.delete`를 `vault.renameFile`으로 교체
4. 단위 테스트: rename 시 wiki link가 갱신되는지 검증 (mock을 통해)

**산출물**: 확장된 VaultAdapter, 수정된 `_handleMovedEvent`, 테스트

### 마일스톤 4: REQ-API-003 vault.process 원자적 연산 (우선순위: MEDIUM)

**목표**: `_uploadLocalFile`의 read-hash-compare 패턴을 `vault.process`로 원자화한다.

**작업 항목**:
1. VaultAdapter에 `process(path, fn)` 메서드 추가
2. `_createVaultAdapter()`에서 `vault.process(file, fn)`을 호출하도록 구현
3. `_uploadLocalFile`에서 `readIfExists -> computeHash -> compare` 흐름을 `process` 콜백 내부로 이동
4. 단위 테스트: 동시 수정 시나리오에서 데이터 무결성 검증

**산출물**: 수정된 `_uploadLocalFile`, 원자적 연산 테스트

### 마일스톤 5: REQ-API-004 vault.trash 전환 (우선순위: MEDIUM)

**목표**: `vault.delete`를 `vault.trash(file, true)`로 교체한다.

**작업 항목**:
1. VaultAdapter의 `delete` 메서드 구현을 `vault.trash(file, true)`로 변경
2. `sync-engine.ts:_deleteLocalFile()`에서 trash 사용 확인
3. `trash`가 지원되지 않는 환경에서의 폴백 (delete로 강등)
4. 단위 테스트: 삭제된 파일이 휴지통에 있는지 검증

**산출물**: 수정된 VaultAdapter.delete, 복구 가능 삭제 테스트

### 마일스톤 6: REQ-API-005 vault.cachedRead 적용 (우선순위: LOW)

**목표**: `readIfExists`에서 `cachedRead`를 우선 사용한다.

**작업 항목**:
1. VaultAdapter의 `readIfExists`에서 `cachedRead`를 먼저 시도, 실패 시 `read`로 폴백
2. 캐시 무효화 시점에 `read`를 직접 사용하도록 보장
3. 단위 테스트: 캐시 히트/미스 시나리오 검증

**산출물**: 최적화된 `readIfExists`, 캐시 활용 테스트

## 기술 접근 방식

### 핵심 원칙

1. **VaultAdapter 추상화 유지**: 모든 Obsidian API 호출은 `_createVaultAdapter()` 내부에 캡슐화. `sync-engine.ts`는 VaultAdapter 인터페이스만 사용.
2. **점진적 전환**: 각 메서드 전환을 독립적으로 수행. 한 번에 전체를 바꾸지 않음.
3. **하위 호환성**: 새 메서드가 지원되지 않는 환경에서는 기존 동작으로 폴백.

### onLayoutReady 구현 패턴

```
// main.ts onload() 내
if (this._isConfigured()) {
    this.app.workspace.onLayoutReady(() => {
        this._startSync();
        if (restoredQueue.length > 0) {
            this._syncEngine.flushOfflineQueue();
        }
    });
}
```

### fileManager.renameFile 구현 패턴

```
// _createVaultAdapter() 내
async renameFile(oldPath: string, newPath: string): Promise<void> {
    const file = vault.getAbstractFileByPath(oldPath);
    if (file instanceof TFile) {
        await app.fileManager.renameFile(file, newPath);
    }
}
```

### vault.trash 구현 패턴

```
// _createVaultAdapter() 내 delete 메서드
async delete(path: string): Promise<void> {
    const file = vault.getAbstractFileByPath(path);
    if (file) {
        await vault.trash(file as any, true);
    }
}
```

## 위험 및 완화

| 위험 | 완화 전략 |
|------|-----------|
| Obsidian API 변경으로 인한 호환성 문제 | 메서드 존재 여부 확인 후 폴백 |
| 기존 테스트 대량 실패 | 모킹 라이브러리 업데이트를 최우선 수행 |
| `vault.process` 콜백 내 오류 | try-catch 래핑, 실패 시 원본 반환 |
| `cachedRead` 오래된 데이터 | 해시 불일치 시 `read`로 재시도 |

## 검증 기준

모든 마일스톤 완료 후:
- 기존 테스트 전체 통과
- 새로운 요구사항에 대한 테스트 추가
- Obsidian 공식 API 모범 사례 준수
