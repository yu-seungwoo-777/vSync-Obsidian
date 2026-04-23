---
id: SPEC-REF-ANALYSIS-001
version: 3.0.0
status: planned
created: 2026-04-21
updated: 2026-04-22
---

# 인수 기준: Obsidian 참조 플러그인 분석 기반 vSync 개선

## 1. 인수 테스트 시나리오

### AC-001: 이모지 상태 표시줄 (REQ-STATUS-001)

**Given** vSync 플러그인이 활성화되어 있다
**When** 동기화 상태가 변경되면
**Then** 상태 표시줄이 다음과 같이 표시된다:
  - 실시간 연결: `⚡ vSync`
  - 폴링 모드: `🔄 vSync`
  - 동기화 중: `🔄↑ vSync` 또는 `🔄↓ vSync`
  - 오프라인: `📡 vSync`
  - 오류: `⚠ vSync`
  - 설정 필요: `⚙ vSync`

**Given** 동기화가 idle 상태이다
**When** 사용자가 상태 표시줄을 확인하면
**Then** `⚡ vSync` 또는 `✓ vSync`가 표시된다

**참고**: 현재 `updateStatus()` (main.ts:193)는 텍스트 매핑만 사용 (`'vSync: Synced'` 등). `SyncStatus` 타입(types.ts:115)에 'offline', 'polling'이 없으므로 타입 확장 필요.

---

### AC-002: 구조화된 에러 알림 (REQ-NOTICE-001)

**Given** 동기화 중 서버 연결 오류가 발생했다
**When** 에러가 보고되면
**Then** Notice에 다음이 표시된다:
  - 굵은 텍스트로 "vSync Sync Error:" (에러 유형)
  - 줄바꿈 후 에러 메시지 내용
  - "Check console (Ctrl+Shift+I) for details" 안내
  - Notice가 최소 8000ms 동안 표시됨
  - 콘솔에 동일 에러가 `console.error()`로 기록됨

**Given** 성공적으로 파일이 동기화되었다
**When** 동기화가 완료되면
**Then** Notice에 "vSync: File synced successfully"가 최대 5000ms 표시된다

**참고**: `utils/notice.ts` 파일이 현재 존재하지 않음. 신규 생성 후 기존 16개 `new Notice()` 호출부(main.ts:10, settings.ts:5, search-modal.ts:1)를 마이그레이션해야 함.

---

### AC-003: Notice 중복 제거 (REQ-NOTICE-002)

**Given** "Syncing file.md" 상태 메시지가 표시 중이다
**When** 동일한 "Syncing file.md" 메시지가 3초 내에 다시 발생하면
**Then** 새 Notice가 생성되지 않고 기존 Notice의 텍스트가 `(2): Syncing file.md`로 업데이트된다

**Given** 중복 제거된 Notice가 표시 중이다
**When** 5초 동안 동일 key의 새 메시지가 발생하지 않으면
**Then** Notice가 자동으로 숨겨진다

---

### AC-004: 최초 실행 안내 (REQ-ONBOARD-001)

**Given** vSync 플러그인이 처음 설치되었다 (설정이 비어있음)
**When** 플러그인이 로드되면
**Then** "vSync: Configure your server settings to start syncing." Notice가 10000ms 동안 표시된다
**And** 상태 표시줄에 `⚙ vSync`가 표시된다
**And** 자동 동기화가 시작되지 않는다

**Given** vSync 설정이 구성되어 있다
**When** 플러그인이 로드되면
**Then** 환영 메시지가 표시되지 않는다
**And** 자동 동기화가 시작된다

**참고**: `_isConfigured()` (main.ts:344)는 이미 존재하며, else 분기(main.ts:128-130)에서 `updateStatus('not_configured')`를 호출 중. Notice 1줄만 추가하면 완료.

---

### AC-005: onload/onLayoutReady 분리 (REQ-ARCH-001)

**Given** Obsidian이 시작 중이다
**When** 플러그인의 onload()가 호출되면
**Then** 다음이 즉시 등록된다:
  - 뷰 타입 (ConflictQueueView, SyncLogView)
  - 리본 아이콘
  - 상태 표시줄 아이템
  - 명령 팔레트 명령
  - 설정 탭
**And** 상태 표시줄에 "vSync: loading..."이 표시된다

**Given** onload()가 완료되었다
**When** 워크스페이스가 준비되면 (onLayoutReady)
**Then** 다음이 초기화된다:
  - VaultAdapter
  - SyncEngine
  - 오프라인 큐 복원
  - 자동 동기화 시작

**참고**: 부분 구현 상태. `_startSync()`와 `flushOfflineQueue()`는 이미 onLayoutReady에 있음(main.ts:120-127). 그러나 SyncEngine 생성(main.ts:60-70), 콜백 설정(73-95), VaultAdapter/WorkspaceAdapter 생성(46-51)은 아직 onload에 위치.

---

### AC-006: 설정 탭 섹션 분리 (REQ-UI-001)

**Given** 사용자가 vSync 설정 탭을 열었다
**When** 설정 탭이 표시되면
**Then** 다음 섹션이 순서대로 표시된다:
  - "Connection" 섹션 (Server URL, API Key, Vault ID, Test Connection)
  - "Sync" 섹션 (Sync interval, Device ID)
  - "Device" 섹션 (Connected Devices 목록, 기기 제거)
  - "Advanced" 섹션 (접힌 상태, 클릭 시 펼쳐짐)

**참고**: 현재 settings.ts는 평면 나열 구조이나, Connected Devices 섹션(`_renderDeviceSection`, REQ-PA-011/012)은 이미 별도 메서드로 분리되어 있음. 다른 설정 항목들도 섹션으로 묶으면 됨.

---

### AC-007: 연결 테스트 피드백 (REQ-UI-002)

**Given** 사용자가 vSync 설정 탭을 열었다
**When** "Test Connection" 버튼을 클릭하면
**Then** 버튼이 비활성화되고 "Testing..." 텍스트가 표시된다

**Given** 연결 테스트가 성공했다
**When** 결과가 반환되면
**Then** 버튼이 "Connected (X files)"로 변경된다 (X는 파일 수)

**Given** 연결 테스트가 실패했다
**When** 결과가 반환되면
**Then** 버튼이 "Connection failed: [reason]"로 변경된다
**And** 에러 원인이 설정 탭에 표시된다

**참고**: `testConnection()` (settings.ts:288)은 이미 구현되어 있고 성공/실패 결과를 반환함. 현재 버튼 핸들러(settings.ts:118-125)는 `new Notice()`로 결과만 표시. 버튼 자체의 상태 변화("Testing...", "Connected...")만 추가하면 됨.

---

### AC-008: 체계적 onunload (REQ-ARCH-002)

**Given** vSync가 활성화되어 있고 동기화가 진행 중이다
**When** 플러그인이 언로드되면
**Then** 다음 정리가 수행된다:
  - WebSocket 연결 종료
  - 진행 중인 타이머/인터벌 정리
  - 오프라인 큐 영속화
  - 이벤트 리스너 해제
  - 상태 표시줄 텍스트 초기화
**And** 콘솔에 "vSync: Plugin unloaded cleanly" 로그가 기록된다

**참고**: 현재 onunload (main.ts:163-169)는 `syncEngine.destroy()` + null 할당만 수행. 누락: 큐 영속화 호출, 상태 표시줄 초기화, 종료 로깅. `registerInterval`로 등록된 타이머는 Obsidian이 자동 정리함.

---

## 2. 엣지 케이스

### EC-001: Obsidian 시작 중 네트워크 불가

**Given** Obsidian이 시작 중이고 네트워크가 불가능하다
**When** onLayoutReady에서 동기화 엔진 초기화를 시도하면
**Then** 에러가 발생하지 않고 상태가 "offline"으로 설정된다
**And** 오프라인 큐가 정상적으로 복원된다

### EC-002: 동시에 여러 에러 발생

**Given** 동기화 중 3개의 다른 에러가 동시에 발생했다
**When** 에러들이 보고되면
**Then** 각 에러 유형별로 최대 1개의 Notice만 표시된다
**And** 카운트가 누적되어 "(3): Server error" 형태로 표시된다

### EC-003: 설정 탭 열린 상태에서 동기화로 설정 변경

**Given** 설정 탭이 열려 있다
**When** 외부에서 설정이 변경되면 (REQ-ARCH-003)
**Then** `onExternalSettingsChange()`가 호출되어 설정이 갱신된다 (P3 항목)

---

## 3. 품질 게이트

### Definition of Done

- [ ] 모든 P0 항목(AC-001 ~ AC-003)의 인수 테스트가 통과한다
- [ ] 기존 플러그인 기능(동기화, 충돌 해결, 설정)이 회귀 없이 동작한다
- [ ] 새로운 `utils/notice.ts` 모듈에 대한 단위 테스트가 85% 이상 커버리지를 달성한다
- [ ] `updateStatus()` 메서드의 모든 분기에 대한 단위 테스트가 존재한다
- [ ] `onload()`에서 `onLayoutReady()`로 이동한 코드가 여전히 정상 동작한다
- [ ] 모바일 플랫폼에서 이모지가 정상 렌더링된다
- [ ] 설정 탭 변경 후 기존 설정 값이 유지된다
- [ ] 콘솔에 에러/경고 로그가 없다
