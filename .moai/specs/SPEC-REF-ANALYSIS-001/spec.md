---
id: SPEC-REF-ANALYSIS-001
version: 3.0.0
status: planned
created: 2026-04-21
updated: 2026-04-22
author: yu
priority: high
issue_number: ""
---

# SPEC-REF-ANALYSIS-001: Obsidian 참조 플러그인 패턴 분석 및 vSync 권장사항

## HISTORY

| 날짜 | 버전 | 변경 내용 | 작성자 |
|------|------|-----------|--------|
| 2026-04-21 | 1.0.0 | 최초 작성 | yu |
| 2026-04-21 | 2.0.0 | 사용자 시나리오 분석 섹션(§7) 추가 | yu |
| 2026-04-22 | 3.0.0 | 코드베이스 변경 반영 (WorkspaceAdapter, API Gap, RBAC 등), 구현 상태 업데이트 | yu |

---

## 1. 개요

### 1.1 목적

본 SPEC은 옵시디언 생태계에서 널리 사용되는 3개 플러그인(Excalidraw, Templater, obsidian-livesync)을 분석하여 UI, 이벤트, 알림, 에러 처리 패턴의 모범 사례를 도출하고, vSync 플러그인에 적용 가능한 구체적인 권장사항을 제시한다.

### 1.2 분석 대상

| 플러그인 | 버전 | 역할 | vSync와의 관련성 |
|----------|------|------|------------------|
| obsidian-excalidraw-plugin | 2.22.0 | 드로잉/화이트보드 | 복잡한 설정 UI, 다국어, 명령 패턴 참조 |
| Templater | 2.19.1 | 템플릿 엔진 | 간결한 설정 구조, 에러 알림 패턴 참조 |
| obsidian-livesync | 0.25.57 | 실시간 동기화 | **가장 직접적 참조** - 동기화 상태, 온보딩, 에러 통신 |

### 1.3 분석 차원

1. 플러그인 UI 패턴 (설정 탭, 모달, 사이드바, 리본 아이콘)
2. 설치 후 초기화 이벤트 (onload, 최초 실행 경험, 설정 마이그레이션)
3. Toast/Notice 메시지 패턴 (성공, 에러, 경고, 정보)
4. 에러 처리 및 상태 통신 (동기화 오류, 상태 표시줄, 재시도 UX)
5. 아키텍처 패턴 (메인 클래스 구조, 설정 관리, 이벤트 리스너, 정리)

---

## 2. 분석 결과: 플러그인별 상세

### 2.1 Excalidraw (obsidian-excalidraw-plugin)

#### 2.1.1 아키텍처 패턴

**관리자(Manager) 패턴** 채택:
- `PluginFileManager`, `ObserverManager`, `PackageManager`, `CommandManager`, `EventManager`
- 각 관리자가 단일 책임을 가지며, 메인 플러그인 클래스는 조정자 역할
- `onload()`에서 관리자들을 순차적으로 초기화

```
onload() 흐름:
1. registerView() - 뷰 타입 등록
2. registerExtensions() - 파일 확장자 연결
3. addIcon() / addRibbonIcon() - UI 엘리먼트 등록
4. loadSettings() - 설정 로드 (비동기)
5. onloadOnLayoutReady() - 워크스페이스 준비 후 초기화
```

**특징**: `onLayoutReady` 이벤트에서 무거운 초기화를 수행하여 Obsidian 시작 시간에 영향을 최소화

#### 2.1.2 설정 탭 구조 (ExcalidrawSettingTab)

- `display()`에서 전체 설정을 재구성하는 패턴 (컨테이너 empty 후 재빌드)
- `hide()`에서 보류 중인 변경사항 적용 (requestReloadDrawings, requestEmbedUpdate 플래그)
- 설정 검색 기능 내장 (ContentSearcher)
- 다국어 지원: `t("KEY")` 함수로 모든 문자열 현지화
- `applySettingsUpdate()`로 지연 적용(debounced) 패턴 구현

**코드 예시**:
```typescript
async hide() {
  this.plugin.settings.scriptFolderPath = normalizePath(
    this.plugin.settings.scriptFolderPath,
  );
  this.plugin.saveSettings();
  if (this.requestReloadDrawings) {
    const views = getExcalidrawViews(this.app);
    for (const view of views) {
      await view.save(false);
      await view.reload(true);
    }
  }
}
```

#### 2.1.3 Notice 패턴

- **에러 전용 Notice**: 모든 에러가 `try-catch` 블록에서 잡혀 `new Notice("Error...", 6000)`로 표시
- **6초 지속**: 에러 메시지에 일관되게 6000ms 적용
- **이중 로깅**: `new Notice()` + `console.error()` 항상 쌍으로 사용
- **성공 Notice**: 폰트 로드 성공, 스크립트 설치 성공 등에만 사용

#### 2.1.4 릴리즈 노트 / 최초 설치 감지

```typescript
const obsidianJustInstalled = (this.settings.previousRelease === "0.0.0")
  || !this.settings.previousRelease;
if (isVersionNewerThanOther(PLUGIN_VERSION, this.settings.previousRelease ?? "0.0.0")) {
  new ReleaseNotes(this.app, this, obsidianJustInstalled ? null : PLUGIN_VERSION).open();
}
```

- `previousRelease` 필드로 버전 업그레이드 감지
- 최초 설치와 업그레이드를 구분하여 다른 환경 제공

#### 2.1.5 onunload 정리

- 모든 관리자의 `destroy()` 호출
- `MutationObserver.disconnect()` 명시적 호출
- `window` 전역 변수 정리 (`delete window.ExcalidrawAutomate`)
- Map/WeakMap `clear()` 호출
- 액티브 뷰를 Markdown 뷰로 전환하여 정상 종료 보장

---

### 2.2 Templater

#### 2.2.1 아키텍처 패턴

**가장 간결한 구조** - 심플 위임 패턴:

```typescript
async onload(): Promise<void> {
  await this.load_settings();
  this.templater = new Templater(this);
  await this.templater.setup();
  this.editor_handler = new Editor(this);
  await this.editor_handler.setup();
  this.fuzzy_suggester = new FuzzySuggester(this);
  this.event_handler = new EventHandler(this, this.templater, this.settings);
  this.event_handler.setup();
  this.command_handler = new CommandHandler(this);
  this.command_handler.setup();
  this.addRibbonIcon("templater-icon", "Templater", async () => {
    this.fuzzy_suggester.insert_template();
  });
  this.addSettingTab(new TemplaterSettingTab(this));
  this.app.workspace.onLayoutReady(() => {
    this.templater.execute_startup_scripts();
  });
}
```

**특징**:
- `load_settings()`에서 `Object.assign({}, DEFAULT_SETTINGS, await this.loadData())` 패턴
- 외부 설정 변경 감지: `onExternalSettingsChange()` 오버라이드
- 설정 탭에서 조건부 섹션 표시 (toggle 활성화 시에만 하위 설정 표시)

#### 2.2.2 설정 탭 구조 (TemplaterSettingTab)

- `display()` 메서드 내에서 조건부 렌더링:
  ```typescript
  if (this.plugin.settings.trigger_on_file_creation) {
    this.add_folder_templates_setting();
    this.add_file_templates_setting();
  }
  ```
- `createDocumentFragment()`로 풍부한 설명 텍스트 구성 (링크, 굵은 텍스트, 코드)
- 설정 변경 시 즉시 `save_settings()` + 필요시 `display()` 재호출

#### 2.2.3 Notice 패턴 - 구조화된 에러 표시

```typescript
export function log_error(e: Error | TemplaterError): void {
  const notice = new Notice("", 8000);
  const messageEl = createFragment((frag) => {
    frag.createEl("b", { text: "Templater Error" });
    frag.createEl("span", { text: ":" });
    frag.createEl("br");
    frag.createEl("span", { text: e.message });
    if (e instanceof TemplaterError && e.console_msg) {
      frag.createEl("br");
      frag.createEl("span", { text: "Check console for more information" });
    }
  });
  notice.noticeEl.appendChild(messageEl);
}
```

**특징**:
- 전용 로그 유틸리티 (`Log.ts`) 분리
- `noticeEl.appendChild()`로 커스텀 HTML 주입
- 에러: 8000ms, 업데이트: 15000ms 지속
- 커스텀 에러 타입 (`TemplaterError`)으로 콘솔 메시지 분리

#### 2.2.4 설정 검증 패턴

- `FileSuggest`, `FolderSuggest` 커스텀 서제스터로 경로 검증
- 중복 검사 (같은 폴더에 두 개 템플릿 불가)
- 설정 변경 후 `display()` 재호출로 UI 즉시 갱신

---

### 2.3 obsidian-livesync

#### 2.3.1 아키텍처 패턴 - 모듈/서비스 허브 아키텍처

**가장 복잡한 구조** - DI(Dependency Injection) 기반 서비스 지향:

```
ObsidianLiveSyncPlugin
└── LiveSyncBaseCore
    ├── ServiceHub (DI 컨테이너)
    │   ├── services.setting
    │   ├── services.database
    │   ├── services.replication
    │   ├── services.conflict
    │   ├── services.UI
    │   └── services.appLifecycle
    ├── Modules (기능 단위)
    │   ├── ModuleObsidianEvents
    │   ├── ModuleObsidianSettingDialogue
    │   ├── ModuleLog
    │   ├── ModuleInteractiveConflictResolver
    │   ├── ModuleMigration
    │   └── SetupManager
    └── Add-ons
        ├── ConfigSync
        ├── HiddenFileSync
        └── LocalDatabaseMaintenance
```

**생명주기 이벤트**:
- `onInitialise` - 플러그인 로드 시작
- `onSettingLoaded` - 설정 로드 완료
- `onLoaded` - 전체 로드 완료
- `onLayoutReady` - UI 준비 완료
- `onBeforeUnload` - 언로드 시작

#### 2.3.2 설정 탭 (ObsidianLiveSyncSettingTab)

**다중 패널 구조**:
```typescript
// 10개 이상의 패널로 분리
paneSetup, paneGeneral, paneRemoteConfig, paneSelector,
paneSyncSettings, paneCustomisationSync, paneHatch,
paneAdvanced, panePowerUsers, panePatches, paneMaintenance
```

- 설정 난이도 레벨: `LEVEL_POWER_USER`, `LEVEL_ADVANCED`, `LEVEL_EDGE_CASE`
- 설정 변경 추적: `initialSettings`와 `editingSettings` 비교
- `applySetting(keys[])`로 선택적 설정 적용
- 커스텀 `LiveSyncSetting` 래퍼로 추가 기능 (마크다운 내보내기 등)

#### 2.3.3 상태 표시줄 - 반응형(Reactive) 상태 시스템

```typescript
const statusBarLabels = reactive(() => {
  const scheduleMessage = this.services.appLifecycle.isReloadingScheduled()
    ? "WARNING! RESTARTING OBSIDIAN IS SCHEDULED!\n" : "";
  const { message } = statusLineLabel();
  // ... 동기화 상태 이모지 조합
  return { message: `${networkActivity}Sync: ${w} ↑ ${sent}${pushLast} ↓ ${arrived}${pullLast}`, status };
});
```

**상태 이모지 체계**:
| 이모지 | 의미 |
|--------|------|
| `⚡` | 연결됨 |
| `📦↑` / `📦↓` | 저널 송수신 |
| `🌀` | 동기화 시작 |
| `💤` | 일시 정지 |
| `⏹` | 중지/완료 |
| `⚠` | 오류 |
| `📲` | 네트워크 활동 |
| `📥` | 복제 결과 |
| `📄` | DB 큐 |
| `💾` | 스토리지 적용 |

#### 2.3.4 Notice 중복 제거 및 수명 관리

```typescript
if (key in this.notifies) {
  const isShown = this.notifies[key].notice.noticeEl?.isShown();
  if (!isShown) {
    this.notifies[key].notice = new Notice(messageContent, 0);
  }
  this.notifies[key].count++;
  this.notifies[key].notice.setMessage(
    `(${this.notifies[key].count}):${messageContent}`
  );
} else {
  const notify = new Notice(messageContent, 0);
  this.notifies[key] = { count: 0, notice: notify };
}
scheduleTask(`notify-${key}`, 5000, () => {
  const notify = this.notifies[key].notice;
  delete this.notifies[key];
  notify.hide();
});
```

**특징**:
- `key` 기반 Notice 중복 제거 (같은 메시지가 여러 번 표시되지 않음)
- 카운트 표시: `(3):Syncing...` 형식
- `duration: 0`으로 수동 수명 관리
- `scheduleTask()`로 5초 후 자동 숨김
- `setMessage()`로 기존 Notice 내용 업데이트

#### 2.3.5 온보딩 / 설정 마법사

**SetupManager**를 통한 단계별 설정:
1. 신규/기존 사용자 구분
2. 설정 방법 선택 (URI / 수동 / QR 코드)
3. CouchDB/MinIO 수동 설정
4. 설정 검증 (Doctor 진단)
5. 설정 적용 및 재시작

```typescript
async startOnBoarding(): Promise<boolean> {
  const isUserNewOrExisting = await this.dialogManager.openWithExplicitCancel(Intro);
  if (isUserNewOrExisting === "new-user") {
    await this.onOnboard(UserMode.NewUser);
  } else if (isUserNewOrExisting === "existing-user") {
    await this.onOnboard(UserMode.ExistingUser);
  }
}
```

#### 2.3.6 설정 마이그레이션 (ModuleMigration)

```typescript
async migrateUsingDoctor(skipRebuild = false, activateReason = "updated") {
  const { shouldRebuild, shouldRebuildLocal, isModified, settings }
    = await performDoctorConsultation(this.core, this.settings, { ... });
  if (isModified) {
    this.settings = settings;
    await this.saveSettings();
  }
  if (shouldRebuild) {
    await this.core.rebuilder.scheduleRebuild();
    this.services.appLifecycle.performRestart();
  }
}
```

**특징**: "Doctor" 진단 시스템으로 설정 호환성 검사 + 자동 복구

#### 2.3.7 명령 등록 패턴

```typescript
// 모듈 내에서 addCommand 사용
this.addCommand({
  id: "view-log",
  name: "Show log",
  callback: () => {
    void this.services.API.showWindow(VIEW_TYPE_LOG);
  },
});
```

- `AbstractModule` 베이스 클래스에서 `addCommand`, `addRibbonIcon` 바인딩 제공
- 명령이 기능 모듈 단위로 분산 등록됨

---

## 3. 비교 매트릭스

### 3.1 아키텍처 비교

| 차원 | Excalidraw | Templater | livesync | vSync (현재) |
|------|-----------|-----------|----------|-------------|
| **복잡도** | 중간 | 낮음 | 매우 높음 | 낮음 |
| **패턴** | Manager 위임 | Simple 위임 | DI/Service Hub | 직접 구현 + 어댑터 인터페이스 |
| **초기화** | onload + onLayoutReady 분리 | onload 일괄 | 다단계 생명주기 | 부분 분리 (`_startSync`만 onLayoutReady) |
| **설정 로드** | `Object.assign({}, DEFAULT, loadData)` | `Object.assign({}, DEFAULT, loadData)` | 별도 SettingService | `{ ...DEFAULT, ...savedData }` |
| **모듈화** | Manager 클래스 | Handler 클래스 | Module/Service | 어댑터 인터페이스 (VaultAdapter, WorkspaceAdapter) |
| **DI** | 없음 | 없음 | ServiceHub | 없음 (인터페이스 기반 추상화만) |

### 3.2 설정 UI 비교

| 차원 | Excalidraw | Templater | livesync | vSync (현재) |
|------|-----------|-----------|----------|-------------|
| **구조** | 단일 탭 + 섹션 | 단일 탭 + 섹션 | 다중 패널 | 단일 탭 평면 + 디바이스 관리 섹션 |
| **조건부 렌더링** | 있음 | 있음 | 있음 | 없음 |
| **설명 풍부도** | HTML 프래그먼트 | HTML 프래그먼트 | i18n + 마크다운 | 단순 텍스트 |
| **검색** | ContentSearcher 내장 | 없음 | 설정별 검색 | 없음 |
| **검증** | 경로 정규화 | 경로 서제스터 | Doctor 진단 | 연결 테스트 버튼 (로딩 상태 없음) |
| **난이도 레벨** | 없음 | 없음 | 3단계 | 없음 |
| **디바이스 관리** | 없음 | 없음 | 없음 | Connected Devices 섹션 (REQ-PA-011/012) |

### 3.3 Notice/알림 비교

| 차원 | Excalidraw | Templater | livesync | vSync (현재) |
|------|-----------|-----------|----------|-------------|
| **에러 지속시간** | 6000ms | 8000ms | 무한 (수동 관리) | 5000ms (모든 Notice 동일) |
| **성공 알림** | 있음 | 없음 | 있음 | 있음 (16개 `new Notice()` 분산) |
| **중복 제거** | 없음 | 없음 | key 기반 | 없음 |
| **커스텀 HTML** | 없음 | createFragment | createFragment | 없음 (plain text만) |
| **카운트 표시** | 없음 | 없음 | `(N):msg` | 없음 |
| **전용 로거** | 없음 | Log.ts | ModuleLog | syncLogger (있으나 Notice와 통합 안됨) |
| **i18n** | t() 함수 | 없음 | $msg() 함수 | 없음 |
| **Notice 유틸** | 없음 | Log.ts | ModuleLog | 없음 (`utils/notice.ts` 미존재) |

### 3.4 상태 통신 비교

| 차원 | Excalidraw | Templater | livesync | vSync (현재) |
|------|-----------|-----------|----------|-------------|
| **상태 표시줄** | 없음 | 없음 | 반응형 이모지 | 텍스트 (`vSync: Synced` 등, 이모지 없음) |
| **상태 이모지** | N/A | N/A | 10+ 이모지 | 없음 |
| **상태 타입** | N/A | N/A | 다양 | `SyncStatus = 'idle' \| 'syncing' \| 'error' \| 'not_configured'` |
| **클릭 핸들러** | N/A | N/A | 로그 뷰 열기 | 없음 |
| **사이드바 패널** | 있음 | 없음 | 있음 (로그) | 있음 (로그, 충돌 큐) |
| **에러 뷰** | 없음 | 없음 | 로그 패널 | 충돌 큐 뷰 |
| **오프라인 표시** | N/A | N/A | 상태 표시줄 | 상태 표시줄 (텍스트만, 'offline' 상태 없음) |

### 3.5 온보딩/초기화 비교

| 차원 | Excalidraw | Templater | livesync | vSync (현재) |
|------|-----------|-----------|----------|-------------|
| **최초 실행 감지** | previousRelease == "0.0.0" | 없음 | 설정 빈값 확인 | `_isConfigured()` 확인 (main.ts:344) |
| **환영 메시지** | ReleaseNotes 모달 | 없음 | SetupManager 마법사 | 없음 (상태만 'not_configured' 설정) |
| **설정 마법사** | 없음 | 없음 | 다단계 마법사 | 없음 |
| **마이그레이션** | onceOff 플래그 | 없음 | Doctor 진단 | 없음 |
| **QR 코드 설정** | 없음 | 없음 | 있음 | 없음 |

---

## 4. EARS 요구사항: vSync 권장사항

### 4.1 UI/설정 개선

#### REQ-UI-001: 설정 탭 섹션 분리

**While** 사용자가 설정 탭을 열고, **when** 설정 항목이 10개 이상 존재하면, 시스템은 **shall** 설정을 논리적 섹션(연결, 동기화, 충돌, 고급)으로 분리하여 표시한다.

**근거**: Excalidraw와 Templater 모두 조건부 섹션 표시를 활용. livesync는 다중 패널로 분리. vSync 현재 설정은 평면 구조.

#### REQ-UI-002: 연결 테스트 시각적 피드백

**When** 사용자가 "Test Connection" 버튼을 클릭하면, 시스템은 **shall** 진행 상태를 표시하고 (로딩 스피너 또는 "Testing..." 텍스트), 성공 시 파일 수를, 실패 시 구체적 에러 원인을 표시한다.

**구현 상태**: 부분 구현. `testConnection()` 메서드는 존재 (settings.ts:288-324)하고 성공/실패 결과를 반환. 그러나 버튼에 로딩 상태("Testing...") 표시가 없고, 버튼 텍스트가 결과에 따라 변경되지 않음. 현재는 `new Notice()`로 결과만 표시.

**근거**: livesync의 Doctor 진단 패턴과 Templater의 검증 패턴 참조.

#### REQ-UI-003: 설정 탭 조건부 렌더링

**Where** 고급 설정 기능이 존재하면, 시스템은 **shall** 기본 설정만 기본으로 표시하고, "Advanced" 토글 활성화 시에만 고급 설정을 표시한다.

**근거**: livesync의 `LEVEL_POWER_USER` / `LEVEL_ADVANCED` 레벨 분리 패턴.

### 4.2 Notice/알림 개선

#### REQ-NOTICE-001: 에러 알림 표준화

**When** 동기화 에러가 발생하면, 시스템은 **shall** `createFragment`를 사용하여 구조화된 에러 메시지를 표시한다. 메시지는 에러 유형(bold), 상세 내용, 콘솔 확인 안내로 구성되며, 지속 시간은 최소 8000ms이어야 한다.

**근거**: Templater의 `log_error()` 패턴이 가장 간결하면서 효과적. Excalidraw의 6000ms보다 Templater의 8000ms가 에러 인지에 적합.

**코드 예시 (권장 패턴)**:
```typescript
function logError(title: string, e: Error): void {
  const notice = new Notice("", 8000);
  const el = createFragment((frag) => {
    frag.createEl("b", { text: `vSync ${title}` });
    frag.createEl("span", { text: ":" });
    frag.createEl("br");
    frag.createEl("span", { text: e.message });
    frag.createEl("br");
    frag.createEl("span", {
      text: "Check console (Ctrl+Shift+I) for details",
      cls: "vsync-notice-hint"
    });
  });
  notice.noticeEl.appendChild(el);
  console.error(`vSync ${title}:`, e);
}
```

#### REQ-NOTICE-002: Notice 중복 제거

**While** 동기화가 진행 중이고, **when** 동일한 유형의 상태 메시지가 반복 발생하면, 시스템은 **shall** 기존 Notice를 업데이트하고 발생 횟수를 누적 표시한다. 새 Notice를 생성하지 않는다.

**근거**: livesync의 key 기반 Notice 관리가 동기화 플러그인에 가장 적합. 동기화 중 동일 메시지가 수십 번 발생 가능.

#### REQ-NOTICE-003: 상태 메시지 레벨 분리

**If** 메시지가 사용자 조치가 필요한 에러이면, 시스템은 **shall** Notice로 표시한다. **If** 메시지가 정보성 로그이면, 시스템은 **shall** 사이드바 로그 패널에만 기록하고 Notice를 표시하지 않는다.

**근거**: Excalidraw는 모든 에러에 Notice 사용, 성공에는 제한적 사용. livesync는 LOG_LEVEL로 등급 분리.

### 4.3 상태 표시줄 개선

#### REQ-STATUS-001: 이모지 기반 동기화 상태 표시

**While** 플러그인이 활성화되어 있으면, 시스템은 **shall** 상태 표시줄에 이모지로 동기화 상태를 표시한다.

**권장 이모지 체계** (livesync 패턴 간소화):

| 상태 | 이모지 | 텍스트 |
|------|--------|--------|
| 연결됨 (실시간) | `⚡` | vSync |
| 폴링 모드 | `🔄` | vSync |
| 동기화 중 | `🔄↑` / `🔄↓` | vSync |
| 오프라인 | `📡` | vSync |
| 오류 | `⚠` | vSync |
| 설정 필요 | `⚙` | vSync |
| 일지함 | `✓` | vSync |

**근거**: livesync의 반응형 상태 표시줄이 동기화 플러그인의 베스트 프랙티스. 텍스트보다 이모지가 직관적.

#### REQ-STATUS-002: 상태 표시줄 클릭 액션

**When** 사용자가 상태 표시줄을 클릭하면, 시스템은 **shall** 동기화 로그 뷰를 열거나, 설정되지 않은 경우 설정 탭을 연다.

**근거**: livesync는 로그 뷰 열기. Excalidraw는 리본 아이콘으로 새 그리기 생성. vSync는 현재 리본 아이콘만 있고 상태 표시줄 클릭 미구현.

### 4.4 온보딩/초기화 개선

#### REQ-ONBOARD-001: 최초 실행 감지 및 안내

**If** 플러그인이 처음 설치되어 설정이 비어 있으면, 시스템은 **shall** 환영 메시지를 표시하고 서버 URL, API 키, 볼트 ID 설정을 안내한다.

**구현 상태**: 부분 구현. `_isConfigured()` 확인 로직은 존재 (main.ts:119-130)하나, 환영 Notice가 누락됨. `else` 분기에서 `updateStatus('not_configured')`만 호출. 환영 Notice 추가에 단 1줄만 필요.

**근거**: livesync의 SetupManager가 가장 완전한 온보딩 구현. Excalidraw의 ReleaseNotes 모델은 버전 업그레이드에 적합.

**권장 최소 구현**:
```typescript
// main.ts:129 else 분기에 추가
} else {
  this.updateStatus('not_configured');
  new Notice("vSync: Configure your server settings to start syncing.", 10000);  // <-- 이 줄만 추가
}
```

#### REQ-ONBOARD-002: 버전 업그레이드 감지

**When** 플러그인 버전이 변경되면, 시스템은 **shall** 이전 버전에서 새 버전으로의 설정 마이그레이션을 수행하고, 필요한 경우 사용자에게 알린다.

**근거**: Excalidraw의 `previousRelease` + `onceOff*` 플래그 패턴. livesync의 ModuleMigration + Doctor.

### 4.5 아키텍처 개선

#### REQ-ARCH-001: 초기화 분리 (onload vs onLayoutReady)

**When** 플러그인이 로드되면, 시스템은 **shall** 필수 등록(뷰, 명령, 설정 탭)은 `onload()`에서 수행하고, 무거운 초기화(네트워크 연결, 데이터 처리)는 `onLayoutReady()`에서 수행한다.

**구현 상태**: 부분 구현. `_startSync()`는 이미 `onLayoutReady` 내에서 실행됨 (main.ts:120-127). 그러나 SyncEngine 생성, 콜백 설정, 충돌 큐 초기화는 여전히 `onload()`에 위치. 이 부분들도 `onLayoutReady`로 이동 필요.

**근거**: 3개 플러그인 모두 `onLayoutReady` 활용. Obsidian 공식 권장 패턴.

**권장 구조**:
```typescript
async onload() {
  // 1. 즉시 등록 (빠름)
  await this.loadSettings();
  this.registerView(...);
  this.registerCommands();
  this.addSettingTab(...);
  this.addRibbonIcon(...);
  this.addStatusBarItem(...);

  // 2. UI 준비 후 초기화 (무거움)
  this.app.workspace.onLayoutReady(() => {
    this.initSyncEngine();
    if (this._isConfigured()) {
      this._startSync();
    }
  });
}
```

#### REQ-ARCH-002: 체계적인 onunload 정리

**When** 플러그인이 언로드되면, 시스템은 **shall** 모든 네트워크 연결을 종료하고, 진행 중인 작업을 완료하거나 취소하며, 리소스를 해제한다.

**구현 상태**: 부분 구현. `syncEngine.destroy()` + null 할당은 존재 (main.ts:163-169). 누락 항목: 오프라인 큐 영속화, 상태 표시줄 텍스트 초기화, 종료 로깅.

**근거**: Excalidraw의 상세한 onunload 정리. 현재 vSync는 `syncEngine.destroy()`만 호출.

#### REQ-ARCH-003: 외부 설정 변경 감지

**When** 외부에서 설정이 변경되면 (다른 기기에서 동기화된 설정 등), 시스템은 **shall** 설정을 다시 로드하고 필요한 컴포넌트를 갱신한다.

**근거**: Templater의 `onExternalSettingsChange()` 오버라이드. 다중 기기 동기화에서 설정 충돌 가능.

---

## 5. 우선순위 권장사항

### P0 (즉시 적용)

| ID | 항목 | 근거 플러그인 | 예상 효과 | 현재 파일 위치 |
|----|------|-------------|----------|---------------|
| REQ-STATUS-001 | 이모지 상태 표시줄 | livesync | 사용자 경험 즉시 개선 | `main.ts:193` updateStatus() |
| REQ-NOTICE-001 | 구조화된 에러 알림 | Templater | 에러 원인 파악 용이 | `utils/notice.ts` (신규 생성 필요), 16개 Notice 호출부 마이그레이션 |
| REQ-ONBOARD-001 | 최초 실행 안내 | livesync | 신규 사용자 이탈 방지 | `main.ts:129` (1줄 추가만 필요) |

### P1 (단기 개선)

| ID | 항목 | 근거 플러그인 | 예상 효과 |
|----|------|-------------|----------|
| REQ-ARCH-001 | 초기화 분리 | 3개 모두 | 시작 성능 개선 |
| REQ-NOTICE-002 | Notice 중복 제거 | livesync | 알림 피로도 감소 |
| REQ-STATUS-002 | 상태 표시줄 클릭 | livesync | 빠른 접근성 |
| REQ-UI-002 | 연결 테스트 피드백 | livesync | 설정 신뢰도 향상 |

### P2 (중기 개선)

| ID | 항목 | 근거 플러그인 | 예상 효과 |
|----|------|-------------|----------|
| REQ-UI-001 | 설정 섹션 분리 | Templater/livesync | 설정 관리성 향상 |
| REQ-UI-003 | 조건부 렌더링 | livesync | 설정 UI 간결화 |
| REQ-NOTICE-003 | 메시지 레벨 분리 | livesync | 노이즈 감소 |
| REQ-ONBOARD-002 | 버전 마이그레이션 | Excalidraw | 업그레이드 안정성 |
| REQ-ARCH-002 | 체계적 정리 | Excalidraw | 리소스 누수 방지 |

### P3 (장기 고려)

| ID | 항목 | 근거 플러그인 | 예상 효과 |
|----|------|-------------|----------|
| REQ-ARCH-003 | 외부 설정 변경 | Templater | 다기기 설정 일관성 |

---

## 6. 제외 항목 (What NOT to Build)

- **DI/ServiceHub 아키텍처**: livesync의 패턴은 과도하게 복잡함. vSync 규모에 Manager 패턴이 적합
- **다국어(i18n) 시스템**: 현재 한국어 코멘트 기반이므로 i18n 도입은 과도한 엔지니어링
- **QR 코드 설정**: livesync 기능이나 vSync는 서버 URL 기반이므로 불필요
- **CouchDB/MinIO 설정 UI**: vSync는 자체 서버 스택이므로 다른 DB 백엔드 설정 불필요
- **의존성 주입 컨테이너**: vSync 규모에서는 Manager 패턴으로 충분
- **설정 마크다운 내보내기**: livesync 기능이나 vSync 설정이 충분히 단순함

---

## 7. 사용자 시나리오 분석

사용자 관점에서 각 플러그인의 동작을 시나리오별로 추적한 분석. 코드 경로와 사용자가 실제로 경험하는 UI 흐름을 매핑한다.

### 7.1 Excalidraw — 사용자 시나리오

#### 시나리오 A: 플러그인 활성화 직후

```
사용자: 커뮤니티 플러그인에서 Excalidraw 활성화
         ↓
내부:    constructor() → filesMaster 초기화, loadTimestamp 기록
         ↓
내부:    onload() → registerView(ExcalidrawView, ExcalidrawLoading, SidepanelView)
         ↓
내부:    onload() → addIcon(3종) + addRibbonIcon(새 그리기)
         ↓
내부:    loadSettings() → DEFAULT_SETTINGS 적용 + 저장된 설정 병합
         ↓
내부:    onLayoutReady() → 무거운 초기화 (이미지 캐시, 압축 워커, 스크립트 엔진)
         ↓
사용자:  왼쪽 리본에 Excalidraw 아이콘 표시
         상태 표시줄 변화 없음
         알림 없음 (조용함)
```

**최초 실행 감지**: `previousRelease === "0.0.0"` 또는 undefined
- 최초 설치 시: `ReleaseNotes` 모달이 `FIRST_RUN` 메시지와 함께 표시됨
- 설정 `showReleaseNotes === true`인 경우에만 동작

**vSync 인사이트**:
- Excalidraw는 최초 설치 시 아무 알림 없이 조용히 시작 → 사용자가 "뭐가 바뀌었지?" 혼란 가능
- 반면 ReleaseNotes 모달은 업데이트 시에만 동작하므로 최초 온보딩과 업데이트가 분리되어 있음
- vSync는 최초 설정이 필수이므로 최소한의 안내 Notice 필요

#### 시나리오 B: 첫 설정

```
사용자:  설정 → 플러그인 → Excalidraw 클릭
         ↓
내부:    ExcalidrawSettingTab.display() → 컨테이너 empty 후 전체 재빌드
         ↓
사용자:  섹션 구조: 기본 | 저장 | AI | 표시 | 연결 및 포함 | 내보내기 | 스크립트
         각 섹션은 <details>/<summary>로 접히고 펼쳐짐
         ↓
사용자:  템플릿 폴더 경로 입력 (기본값: "Excalidraw")
         ↓
내부:    hide() → normalizePath() 적용, "/" 또는 ""이면 "Excalidraw/Scripts"로 자동 설정
         requestReloadDrawings, requestEmbedUpdate 플래그 처리
         ↓
사용자:  설정 닫으면 자동 저장 (별도 Save 버튼 없음)
```

**vSync 인사이트**:
- `<details>/<summary>` 패턴으로 설정 섹션 접기/펼치기 → vSync 설정이 늘어나면 도입 검토
- `hide()`에서 보류 중 변경사항 적용 → Obsidian 관례 패턴
- `display()`에서 컨테이너 전체 재빌드 → Obsidian 설정 탭의 일반적 패턴

#### 시나리오 C: 에러 발생

```
사용자:  드로잉 중 이미지 다운로드 실패
         ↓
내부:    catch 블록 → new Notice("Failed. Could not download image!", 6000)
         ↓
사용자:  6초간 에러 알림 표시
         상태 표시줄 변화 없음
         ↓
사용자:  콘솔 확인 (Ctrl+Shift+I) → console.error() 상세 정보
         또는 이미지 캐시 지우기 버튼 클릭 → 재시도
```

**에러 Notice 패턴**:
- 일반 에러: `new Notice(msg, 4000-6000)` (4~6초)
- 중요 에러: `new Notice(msg, 60000)` (60초, 수동 닫기)
- 콘솔: `console.error()`로 상세 스택 트레이스

**vSync 인사이트**:
- 동기화 에러는 네트워크 문제일 가능성이 높으므로 8초 이상 표시 권장
- Templater의 `createFragment` 패턴이 단순 텍스트보다 가독성 좋음

#### 시나리오 D: 플러그인 업데이트

```
내부:    onload() → isVersionNewerThanOther(PLUGIN_VERSION, settings.previousRelease)
         ↓
내부:    새 버전 감지 → ReleaseNotes 모달 열기
         ↓
사용자:  릴리즈 노트 모달 표시 (버전별 변경사항)
         ↓
내부:    onceOff 플래그 처리 (onceOffCompressFlagReset, onceOffGPTVersionReset 등)
         ↓
사용자:  모달 닫기 → 정상 사용
```

**vSync 인사이트**:
- `previousRelease` 필드로 버전 업그레이드 감지 → vSync에 즉시 도입 권장
- `onceOff*` 플래그로 일회성 마이그레이션 관리 → 패턴 참조

#### 시나리오 E: 플러그인 비활성화

```
내부:    onunload() 호출
         ↓
내부:    사이드패널 정리 → ExcalidrawSidepanelView.onPluginUnload()
         ↓
내부:    열린 모든 Excalidraw 뷰를 Markdown 뷰로 전환
         ↓
내부:    타이머 정리 (versionUpdateCheckTimer)
         ↓
내부:    스크립트 엔진 → scriptEngine.destroy()
         이미지 캐시 → imageCache.destroy()
         스타일 매니저 → stylesManager.destroy()
         ↓
내부:    관찰자 연결 해제 → observerManager.destroy()
         ↓
내부:    메모리 정리 → filesMaster.clear(), equationsMaster.clear(), mermaidsMaster.clear()
```

**vSync 인사이트**:
- Excalidraw는 체계적인 리소스 정리 → vSync도 `syncEngine.destroy()` 외에 타이머, 이벤트 리스너 정리 필요

---

### 7.2 Templater — 사용자 시나리오

#### 시나리오 A: 플러그인 활성화 직후

```
사용자: 커뮤니티 플러그인에서 Templater 활성화
         ↓
내부:    onload() → load_settings() (DEFAULT_SETTINGS + 저장된 설정 병합)
         ↓
내부:    new Templater(this) → 템플릿 엔진 생성
         ↓
내부:    templater.setup() → 함수 생성기, 모듈 로더 초기화
         ↓
내부:    new Editor(this) → 에디터 핸들러
         ↓
내부:    editor_handler.setup() → 인텔리센스 설정
         ↓
내부:    new FuzzySuggester(this) → 템플릿 선택기
         ↓
내부:    addIcon("templater-icon") + addRibbonIcon → 리본에 템플릿 아이콘
         ↓
내부:    addSettingTab(new TemplaterSettingTab(this))
         ↓
사용자:  왼쪽 리본에 Templater 아이콘 표시
         상태 표시줄 변화 없음
         알림 없음 (완전 조용함)
```

**최초 실행 감지**: 없음
- DEFAULT_SETTINGS만 적용되고 별도 온보딩 없음
- 템플릿 폴더가 ""이면 루트 폴더가 기본

**vSync 인사이트**:
- Templater는 설정 없이도 바로 사용 가능한 구조 → vSync는 서버 연결 필수이므로 다름
- 최소한의 "서버 설정이 필요합니다" 안내가 필요

#### 시나리오 B: 첫 설정

```
사용자:  설정 → 플러그인 → Templater
         ↓
내부:    TemplaterSettingTab.display() → 순차적 섹션 추가
         ↓
사용자:  설정 항목 나열:
         - 템플릿 폴더 위치
         - 내부 변수/함수 (접히는 섹션)
         - 문법 강조 (데스크톱/모바일)
         - 커서 자동 이동
         - 파일 생성 시 트리거 (토글)
         - 폴더 템플릿
         - 파일 정규식 템플릿
         - 템플릿 단축키
         - 시작 템플릿
         - 사용자 스크립트 (고급)
         - 시스템 명령 (고급)
         ↓
사용자:  템플릿 폴더 경로 입력 (예: "Templates")
         ↓
내부:    save_settings() → this.saveData(settings) + 인텔리센스 업데이트
         ↓
사용자:  설정 닫으면 자동 저장
```

**vSync 인사이트**:
- Templater는 모든 설정이 한 페이지에 평면 배치 → 설정이 적을 때는 OK
- 고급 기능(시스템 명령, 스크립트)은 섹션 구분 없이 아래에 배치
- vSync가 설정 항목이 늘어나면 섹션 분리 필요 (REQ-UI-001)

#### 시나리오 C: 에러 발생

```
사용자:  템플릿 적용 중 JavaScript 실행 에러
         ↓
내부:    catch 블록 → log_error(new TemplaterError("에러 메시지"))
         ↓
내부:    log_error() (Log.ts 라인 15-31):
         const notice = new Notice("", 8000);
         const el = createFragment((frag) => {
           frag.createEl("b", { text: "Templater Error" });
           frag.createEl("span", { text: ":" });
           frag.createEl("br");
           frag.createEl("span", { text: e.message });
         });
         notice.noticeEl.appendChild(el);
         console.error("Templater Error:", e.console_msg || e.message);
         ↓
사용자:  8초간 구조화된 에러 알림 표시:
         ┌────────────────────────────┐
         │ Templater Error:           │
         │ <에러 메시지>              │
         └────────────────────────────┘
```

**에러 처리 특징**:
- `TemplaterError` 커스텀 에러 클래스 → `console_msg` 분리 (사용자용 vs 개발자용)
- `createFragment`로 HTML 구조화 → 가독성 우수
- 8초 지속 → 에러 인지에 충분한 시간
- 자동 재시도 없음 → 사용자가 직접 재시도

**vSync 인사이트**:
- `createFragment` 에러 패턴 → REQ-NOTICE-001로 즉시 도입 권장
- 에러 클래스 분리 (사용자 메시지 vs 개발자 메시지) → vSync에도 유용

#### 시나리오 D: 정상 사용

```
사용자:  리본 아이콘 클릭 또는 Alt+E
         ↓
내부:    fuzzy_suggester.insert_template()
         ↓
사용자:  템플릿 선택 모달 (FuzzySuggester) 열림
         ↓
사용자:  템플릿 선택
         ↓
내부:    템플릿 파싱 → 변수 치환 → 커서 배치
         ↓
사용자:  성공: 아무 알림 없음 (조용함)
         에러: 8초간 구조화된 에러 Notice
```

**vSync 인사이트**:
- 성공 시 알림 없음 → 사용자가 결과를 직접 확인하는 플러그인은 OK
- vSync(동기화)는 성공 여부를 직접 확인하기 어려우므로 상태 표시줄로 피드백 필요

#### 시나리오 E: 플러그인 비활성화

```
내부:    onunload() 호출
         ↓
내부:    templater.functions_generator.teardown()
         ↓
완료.   (매우 간결한 정리)
```

**vSync 인사이트**:
- Templater는 상태 비저장 플러그인이라 정리가 최소 → vSync는 연결/큐/타이머 정리 필요

---

### 7.3 obsidian-livesync — 사용자 시나리오

#### 시나리오 A: 플러그인 활성화 직후 (최초 설치)

```
사용자: 커뮤니티 플러그인에서 Self-hosted LiveSync 활성화
         ↓
내부:    onload() → _startUp() 호출
         ↓
내부:    core.services.control.onLoad() → 모듈 초기화
         ↓
내부:    ModuleMigration._everyOnFirstInitialize()
         ↓
내부:    settings.isConfigured === false 감지
         ↓
내부:    initialMessage() → SetupManager.startOnBoarding()
         ↓
사용자:  ┌─────────────────────────────────────────┐
         │  Self-hosted LiveSync 설정               │
         │                                          │
         │  처음 사용하시나요?                        │
         │  [새 사용자]  [기존 사용자]                │
         └─────────────────────────────────────────┘
         ↓
사용자:  [새 사용자] 선택
         ↓
         ┌─────────────────────────────────────────┐
         │  설정 방법을 선택하세요                    │
         │  [Setup URI 사용]  [수동 설정]             │
         └─────────────────────────────────────────┘
```

**최초 실행 감지**: `settings.isConfigured === false`
- 신규 설치 시: SetupManager 온보딩 마법사 자동 시작
- 기존 사용자: URI 가져오기 또는 수동 설정 선택

**vSync 인사이트**:
- livesync는 **적극적 온보딩** → 설정 없이는 아무것도 할 수 없으므로 마법사가 필수
- vSync도 서버 URL/API 키 없이는 동작 불가 → 유사한 접근 권장
- 최소 구현: 설정이 비어 있으면 "vSync: 서버 설정을 완료해주세요" Notice + 설정 탭 열기

#### 시나리오 B: 설정 마법사 (SetupManager)

```
사용자:  [수동 설정] 선택
         ↓
         ┌─────────────────────────────────────────┐
         │  서버 설정                                │
         │  URI: [________________]                  │
         │  사용자명: [__________]                   │
         │  비밀번호: [__________]                   │
         │  데이터베이스명: [_________]              │
         │                                          │
         │  [Test]  [Save]  [Cancel]                │
         └─────────────────────────────────────────┘
         ↓
사용자:  [Test] 클릭 → 연결 테스트
         ↓
내부:    isOnlineAndCanReplicate() → 네트워크 확인
         ↓
사용자:  성공: "Connection OK" 확인
         실패: 에러 메시지 표시
         ↓
사용자:  [Save] 클릭
         ↓
내부:    신규 사용자 → scheduleRebuild() (로컬 DB 구축)
         기존 사용자 → scheduleFetch() (원격에서 가져오기)
```

**vSync 인사이트**:
- Test 버튼 → 필수. 연결 확인 없이 저장하면 사용자가 잘못된 설정으로 진행
- 신규/기존 사용자 분기 → vSync도 초기 풀 동기화 vs 증분 동기화 분기 필요 가능

#### 시나리오 C: 정상 동작 — 상태 표시줄

```
         ┌──────────────────────────────────────────────────────────┐
상태바:  │ ⚡Sync: ✓ ↑3 ↓5  │
         └──────────────────────────────────────────────────────────┘
         ↑        ↑   ↑  ↑
         │        │   │  └── 수신된 건수
         │        │   └───── 전송된 건수
         │        └───────── 동기화 상태
         └────────────────── 연결 상태 (이모지)
```

**상태 이모지 변화**:

| 상황 | 이모지 | 설명 |
|------|--------|------|
| 연결됨 (실시간) | ⚡ | 실시간 동기화 활성 |
| 폴링 모드 | 🔄 | 주기적 확인 |
| 전송 중 | 📦↑ | 파일 업로드 중 |
| 수신 중 | 📦↓ | 파일 다운로드 중 |
| 오프라인 | 📡 | 네트워크 끊김 |
| 오류 | ⚠ | 동기화 실패 |
| 대기 | 🛫 | 처리 대기 중 |
| 일시정지 | 💤 | 동기화 일시정지 |

**vSync 인사이트**:
- 이모지 기반 상태 표시는 직관적이고 글로벌 → REQ-STATUS-001 즉시 도입
- 전송/수신 카운트 표시 → 사용자가 동기화 진행 상황을 즉시 파악

#### 시나리오 D: 파일 변경 시 동기화 흐름

```
사용자:  노트 편집 후 저장 (Ctrl+S)
         ↓
내부:    EVENT_FILE_SAVED 발생
         ↓
내부:    settings.syncOnSave === true 확인
         ↓
내부:    scheduleTask("perform-replicate-after-save", 250ms, replicateByEvent)
         ↓  (250ms 디바운스)
내부:    replicateByEvent() → 변경사항 감지 → 원격 전송
         ↓
상태바:  ⚡ → 📦↑ (전송 중)
         ↓
내부:    전송 완료
         ↓
상태바:  📦↑ → ⚡ (연결됨)
```

**vSync 인사이트**:
- 250ms 디바운스 → 빠른 연속 저장 시 중복 동기화 방지
- 상태 표시줄 실시간 업데이트 → 사용자가 동기화 진행을 "느낌"
- vSync도 파일 변경 감지 후 디바운스 적용 + 상태 표시줄 업데이트 권장

#### 시나리오 E: 네트워크 오류

```
내부:    동기화 중 네트워크 끊김 감지
         ↓
내부:    isOnlineAndCanReplicate() → false
         ↓
내부:    errorManager.showError("Network is offline", LOG_LEVEL_NOTICE)
         ↓
상태바:  ⚡ → 📡 (오프라인)
         ↓
내부:    window "online" 이벤트 대기
         ↓
사용자:  네트워크 복구
         ↓
내부:    "online" 이벤트 → 자동 재연결
         ↓
상태바:  📡 → ⚡ (연결됨)
         ↓
내부:    자동 동기화 재개
```

**Notice 중복 제거 패턴** (ModuleLog.ts 라인 494-504):

```typescript
if (!this.notifies[key]) {
    this.notifies[key] = { notice: null, count: 0 };
}
if (this.notifies[key].notice) {
    this.notifies[key].notice.hide();  // 기존 Notice 숨기기
}
this.notifies[key].count++;            // 카운트 누적
const notify = new Notice(messageContent, 0);  // 0 = 수동 닫기
this.notifies[key].notice = notify;
```

**vSync 인사이트**:
- key 기반 Notice 관리 → 동일 에러 반복 시 Notice 스팸 방지 (REQ-NOTICE-002)
- 오프라인/온라인 자동 전환 → vSync도 `window "online"/"offline"` 이벤트 활용
- 상태 표시줄 이모지 변화 → 에러 상황을 시각적으로 즉시 전달

#### 시나리오 F: 원격 잠금 충돌

```
내부:    복제 시도 → remoteLockedAndDeviceNotAccepted === true
         ↓
내부:    ModuleReplicator.onReplicationFailed()
         ↓
사용자:  ┌─────────────────────────────────────────┐
         │  원격 저장소가 잠겨 있습니다.              │
         │                                          │
         │  [가져오기(Fetch)]  [잠금 해제]  [닫기]   │
         └─────────────────────────────────────────┘
         ↓
사용자:  선택에 따라:
         - Fetch → scheduleFetch() + 재시작
         - 잠금 해제 → markRemoteResolved()
         - 닫기 → 무시
```

**vSync 인사이트**:
- 다중 기기 동기화에서 잠금/충돌은 필수 이슈
- 선택형 대화상자로 사용자가 해결 방법 선택 → vSync 충돌 해결 UX 개선 참조

#### 시나리오 G: 플러그인 업데이트

```
내부:    onload() → ModuleMigration._everyOnFirstInitialize()
         ↓
내부:    settings.isConfigured === true → hasCompromisedChunks() 확인
         ↓
내부:    hasIncompleteDocs() 확인
         ↓
내부:    migrateUsingDoctor(false, "updated")
         ↓
내부:    performDoctorConsultation() → 설정 비교, 청크 무결성 확인
         ↓
사용자:  마이그레이션 필요 시: Doctor 진단 결과 표시
         자동 수정 가능: 자동 적용
         수동 개입 필요: 사용자에게 안내
```

**마이그레이션 예시** (ModuleMigration.ts):
```typescript
async migrateDisableBulkSend() {
    if (this.settings.sendChunksBulk) {
        this._log("Bulk send 설정이 손상되어 비활성화합니다.", LOG_LEVEL_NOTICE);
        this.settings.sendChunksBulk = false;
        this.settings.sendChunksBulkMaxSize = 1;
        await this.saveSettings();
    }
}
```

**vSync 인사이트**:
- Doctor 진단 → 설정 무결성 검사 패턴. vSync 규모에는 과도하지만 개념 참조
- 일회성 마이그레이션 메서드 → 버전별 설정 변경을 체계적으로 관리

#### 시나리오 H: 플러그인 비활성화

```
내부:    onunload() → core.services.control.onUnload()
         ↓
내부:    복제 중단 → 진행 중인 동기화 취소
         ↓
내부:    이벤트 허브 정리
         ↓
내부:    상태 표시줄 제거 → document.querySelectorAll('.livesync-status').remove()
         ↓
내부:    Notice 정리 → 모든 활성 Notice 숨기기
         ↓
완료.
```

**vSync 인사이트**:
- DOM에서 직접 상태 표시줄 요소 제거 → 깔끔한 정리
- 활성 Notice 정리 → 비활성화 후에도 Notice가 남지 않음
- vSync도 동기화 큐 persist 후 안전한 종료 보장 필요

---

### 7.4 시나리오 비교 매트릭스

| 시나리오 | Excalidraw | Templater | livesync | vSync (현재) | vSync (권장) |
|----------|-----------|-----------|----------|-------------|-------------|
| **활성화 직후** | ReleaseNotes 모달 (업데이트 시) | 조용함 | SetupManager 마법사 | 조용함 | 설정 미완료 시 안내 Notice |
| **최초 설정** | `<details>` 섹션 + 자동 저장 | 평면 나열 + 자동 저장 | 마법사 + Test 버튼 | 평면 나열 | Test 버튼 + 자동 저장 |
| **에러 Notice** | 텍스트 4~6초 | `createFragment` 8초 | key 기반 중복 제거 | 텍스트 | `createFragment` 8초 + key 중복 제거 |
| **상태 표시줄** | 없음 | 없음 | 이모지 실시간 | 텍스트 | 이모지 실시간 |
| **오프라인** | N/A | N/A | 📡 + 자동 재연결 | "vSync: Error" | 📡 + 자동 재연결 |
| **업데이트** | ReleaseNotes + onceOff 마이그레이션 | 없음 | Doctor 진단 | 없음 | 버전 감지 + 안내 |
| **비활성화** | 체계적 리소스 정리 | 최소 정리 | 상태바/Notice 정리 | destroy()만 | 타이머+이벤트+Notice 정리 |

### 7.5 시나리오 기반 vSync 개선 로드맵

#### 1순위: 사용자 경험 기본 (사용자가 "살아있는" 플러그인을 느끼게)

| 시나리오 | 개선 항목 | 참고 플러그인 |
|----------|----------|-------------|
| 활성화 직후 | 이모지 상태 표시줄 (⚡/📡/⚠/⚙) | livesync |
| 에러 발생 | `createFragment` 구조화 에러 (8초) | Templater |
| 설정 미완료 | "서버 설정이 필요합니다" 안내 | livesync |

#### 2순위: 신뢰도 구축 (사용자가 동기화를 "신뢰"하게)

| 시나리오 | 개선 항목 | 참고 플러그인 |
|----------|----------|-------------|
| 오프라인 전환 | 📡 이모지 + 자동 재연결 | livesync |
| 동기화 진행 | 📦↑/📦↓ 전송 카운트 | livesync |
| 동기화 완료 | ✓ 완료 표시 (5초 후 복귀) | livesync |

#### 3순위: 완성도 (사용자가 "프로페셔널"하다고 느끼게)

| 시나리오 | 개선 항목 | 참고 플러그인 |
|----------|----------|-------------|
| 플러그인 업데이트 | 버전 감지 + 마이그레이션 | Excalidraw |
| 설정 | Test Connection 버튼 | livesync |
| Notice 스팸 | key 기반 중복 제거 | livesync |
| 비활성화 | 타이머+이벤트+Notice 체계 정리 | Excalidraw |
