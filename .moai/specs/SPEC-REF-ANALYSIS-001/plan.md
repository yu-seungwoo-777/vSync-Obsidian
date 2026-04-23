---
id: SPEC-REF-ANALYSIS-001
version: 3.0.0
status: planned
created: 2026-04-21
updated: 2026-04-22
---

# 구현 계획: Obsidian 참조 플러그인 분석 기반 vSync 개선

## 1. 개요

본 문서는 SPEC-REF-ANALYSIS-001의 분석 결과를 바탕으로 vSync 플러그인에 적용할 구현 계획을 정의한다.

---

## 2. 마일스톤

### Milestone 1: P0 - 즉시 적용 항목

**목표**: 사용자 경험과 에러 가시성 즉시 개선

| 작업 | 설명 | 수정 파일 |
|------|------|-----------|
| M1-T1: 이모지 상태 표시줄 | `updateStatus()` (main.ts:193) 메서드 개선, 상태별 이모지 매핑 추가. 현재는 plain text 매핑만 존재 | `main.ts` |
| M1-T2: 구조화된 에러 알림 | `utils/notice.ts` (신규 파일)에 `logError()`, `logSuccess()` 유틸리티 함수 생성. 기존 16개 `new Notice()` 호출부 마이그레이션: main.ts(10), settings.ts(5), search-modal.ts(1) | `utils/notice.ts` (신규), `main.ts`, `settings.ts`, `search-modal.ts` |
| M1-T3: 최초 실행 안내 Notice | `_isConfigured()`의 else 분기 (main.ts:129)에 환영 Notice 1줄 추가만 필요. 현재 `updateStatus('not_configured')`만 호출 중 | `main.ts` |

**의존성**: 없음 (독립 구현 가능)

### Milestone 2: P1 - 단기 개선

**목표**: 성능 및 알림 품질 향상

| 작업 | 설명 | 수정 파일 |
|------|------|-----------|
| M2-T1: onload/onLayoutReady 분리 | 부분 분리 상태. `_startSync()`는 이미 onLayoutReady에 있으나, SyncEngine 생성(main.ts:60-70), 콜백 설정(73-95), 충돌 큐 초기화(57)도 onLayoutReady로 이동 필요 | `main.ts` |
| M2-T2: Notice 중복 제거 | `utils/notice.ts`에 NoticeManager 클래스 설계. key 기반 중복 관리 + 카운트 누적 + 자동 숨김 타이머 | `utils/notice.ts` |
| M2-T3: 상태 표시줄 클릭 핸들러 | `statusBar.dom.addEventListener('click', () => { ... })` 패턴으로 클릭 시 로그 뷰 또는 설정 탭 열기 | `main.ts` |
| M2-T4: 연결 테스트 피드백 | settings.ts의 Test Connection 버튼에 로딩 상태 UI 추가. `testConnection()` 메서드는 이미 존재(settings.ts:288), 버튼 상태 관리만 추가 | `settings.ts` |

**의존성**: M1-T2 (Notice 유틸리티 필요)

### Milestone 3: P2 - 중기 개선

**목표**: 설정 UI 및 아키텍처 개선

| 작업 | 설명 | 수정 파일 |
|------|------|-----------|
| M3-T1: 설정 섹션 분리 | 연결/동기화/충돌/고급 섹션으로 재구성. 디바이스 관리 섹션(Connected Devices)은 이미 존재하므로 다른 설정과 함께 섹션 구조로 재조직 | `settings.ts` |
| M3-T2: 조건부 렌더링 | 고급 설정 토글 추가 | `settings.ts` |
| M3-T3: 메시지 레벨 분리 | 에러만 Notice, 정보는 로그 패널 | `utils/notice.ts`, `main.ts` |
| M3-T4: 버전 마이그레이션 | previousVersion 필드 + 마이그레이션 로직 | `types.ts`, `main.ts` |
| M3-T5: 체계적 onunload | main.ts:163의 onunload 강화. 현재 `destroy()` + null 할당만 존재. 추가 필요: 오프라인 큐 영속화, 상태 표시줄 텍스트 초기화, 종료 로깅 | `main.ts` |

**의존성**: M2-T1 (onload 분리 선행 필요)

---

## 3. 기술 접근법

### 3.1 Notice 유틸리티 (신규 파일: `utils/notice.ts`)

```
vsyncNotice(type, title, message, options?)
  - type: 'error' | 'warning' | 'success' | 'info'
  - 중복 제거를 위한 key 기반 관리
  - createFragment로 구조화된 HTML
  - 기본 지속 시간: error 8000ms, success 5000ms, info 3000ms
```

**참조 패턴**: Templater의 `log_error()` (간결함) + livesync의 key 기반 관리 (중복 제거)

### 3.2 상태 표시줄 이모지 (main.ts 수정)

현재 `updateStatus()` (main.ts:193)는 텍스트 매핑만 사용. 이모지 매핑으로 교체:

```
// 현재 (main.ts:194-201):
const statusTexts: Record<string, string> = {
  idle: 'vSync: Synced',
  syncing: 'vSync: Syncing...',
  ...
};

// 변경 후:
const STATUS_MAP: Record<string, string> = {
  idle:     '⚡ vSync',
  polling:  '🔄 vSync',
  syncing:  '🔄↑ vSync',
  offline:  '📡 vSync',
  error:    '⚠ vSync',
  not_configured: '⚙ vSync',
};
```

참고: `SyncStatus` 타입(types.ts:115)에는 'offline', 'polling'이 없으므로, 타입 확장 또는 `ConnectionMode`와 조합 필요.

**참조 패턴**: livesync의 반응형 상태 표시줄 (간소화 버전)

### 3.3 onload/onLayoutReady 분리

현재 부분 분리 상태. `_startSync()`만 onLayoutReady에 있음.

```
onload() - 현재 유지:
  - loadData() (설정 로드)
  - deviceId 생성 (필요시)
  - addStatusBarItem() (상태 표시줄)
  - registerView() (뷰 등록: ConflictQueueView, SyncLogView)
  - addRibbonIcon() (UI 등록)
  - _registerCommands() (명령 등록)
  - addSettingTab() (설정 탭 + 디바이스 API 주입)

onLayoutReady() - 이동 필요:
  - _createVaultAdapter()
  - _createWorkspaceAdapter()
  - _parseQueueData() + _cleanStaleEntries() (큐 복원)
  - new ConflictQueue()
  - new SyncEngine() + 콜백 설정 (현재 onload:60-95)
  - _startSync() (설정된 경우) -- 이미 onLayoutReady에 있음
  - flushOfflineQueue() -- 이미 onLayoutReady에 있음
```

**참조 패턴**: 3개 플러그인 모두 동일 패턴 사용

### 3.4 설정 탭 섹션 분리

현재 settings.ts는 평면 구조 + 디바이스 관리 섹션(REQ-PA-011/012) 포함.

```
display():
  Section: 연결 (기본)
    - Server URL
    - API Key
    - Vault ID
    - Test Connection 버튼
  Section: 동기화 (기본)
    - Sync interval
    - Device ID (편집 + Generate 버튼)
  Section: 디바이스 관리 (기본) -- 이미 _renderDeviceSection으로 구현됨
    - Connected Devices 목록
    - 기기 제거 버튼
  Section: 고급 (토글)
    - Offline queue 설정
    - Log level
    - Hash cache
```

**참조 패턴**: Templater의 조건부 섹션 + livesync의 난이도 레벨

---

## 4. 리스크 및 완화

| 리스크 | 영향 | 완화 방안 |
|--------|------|-----------|
| onload 분리로 인한 초기화 순서 변경 | 동기화 지연 가능 | onLayoutReady 전까지 "loading..." 상태 표시 |
| Notice 유틸리티 도입으로 기존 Notice 동작 변경 | 사용자 혼란 | 점진적 마이그레이션 (기존 Notice 유지 + 신규 유틸리티 추가) |
| 이모지가 일부 플랫폼에서 렌더링되지 않음 | 상태 표시 불가 | 텍스트 폴백 포함 |
| 설정 탭 재구성으로 기존 설정 위치 변경 | 사용자 혼란 | 설정 값은 유지, UI만 재구성 |

---

## 5. 테스트 전략

### 단위 테스트

- `utils/notice.ts`: Notice 중복 제거, 카운트 누적, 자동 숨김 타이머
- `updateStatus()`: 상태별 이모지 매핑, 알 수 없는 상태 처리
- 설정 마이그레이션: 버전 변경 감지, 기본값 채움(fill)

### 수동 테스트

- 최초 설치 시 환영 메시지 표시 확인
- 동기화 중 동일 에러 반복 시 Notice 중복 제거 확인
- 상태 표시줄 클릭 시 적절한 뷰 열림 확인
- 설정 탭 섹션 전환 확인
- onload 중 에러 발생 시 구조화된 에러 메시지 확인
