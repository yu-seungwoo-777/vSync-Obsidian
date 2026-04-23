# vSync

[Obsidian](https://obsidian.md)용 실시간 파일 동기화 플러그인입니다. 자체 호스팅 **Vector** 서버와 볼트를 동기화합니다.

## 기능

- **실시간 동기화** - WebSocket 또는 주기적 폴링 방식 지원
- **오프라인 지원** - 연결이 끊겨도 변경 사항을 큐에 저장 후 복구 시 동기화
- **3-way 충돌 해결** - 시각적 diff UI로 충돌을 직관적으로 해결
- **바이너리 파일 지원** - 이미지, PDF 등 텍스트 외 파일 동기화
- **다중 기기 동기화** - 기기 식별 및 JWT 세션 관리
- **해시 기반 중복 제거** - 불필요한 전송 최소화
- **충돌 큐 패널** - 충돌 항목을 한눈에 보고 개별 해결
- **동기화 로그 뷰어** - 동기화 활동 실시간 모니터링
- **서버 파일 검색** - 서버에 있는 파일 검색

## 요구사항

- 실행 중인 [Vector](https://github.com/yu-seungwoo-777/vSync) 동기화 서버
- Obsidian 1.0.0 이상

## 설치

### 커뮤니티 플러그인에서 설치 (권장)

1. Obsidian 설정 열기
2. **커뮤니티 플러그인**에서 커뮤니티 플러그인 활성화
3. **vSync** 검색 후 **설치** 클릭

### 수동 설치

1. [최신 릴리스](https://github.com/yu-seungwoo-777/vsync-obsidian/releases)에서 `main.js`, `manifest.json`, `styles.css` 다운로드
2. 볼트의 `.obsidian/plugins/` 디렉토리에 `vsync` 폴더 생성
3. 다운로드한 파일을 해당 폴더에 복사
4. Obsidian 재시작 후 **설정 > 커뮤니티 플러그인**에서 vSync 활성화

## 설정

1. Obsidian 설정에서 **vSync** 항목으로 이동
2. **연결** 버튼 클릭 후 Vector 서버 URL, 사용자 이름, 비밀번호 입력
3. 연결 성공 후 **동기화 활성화** 토글
4. 연결 모드 선택:
   - **실시간**: WebSocket 기반 즉시 동기화 (권장)
   - **폴링**: 설정한 간격으로 주기적 동기화

## 연결 모드

| 모드 | 설명 | 추천 대상 |
|------|-------------|----------|
| 실시간 | WebSocket으로 양방향 즉시 동기화 | 상시 연결 기기, 다중 기기 환경 |
| 폴링 | 설정한 간격으로 HTTP 폴링 | 배터리 제약 기기, 불안정한 네트워크 |

## 충돌 해결

여러 기기에서 동시에 같은 파일을 수정하면 vSync가 충돌을 감지하고:

1. 파일을 **충돌 큐** 패널에 추가
2. 로컬 버전과 서버 버전의 시각적 diff 표시
3. 선택 가능: 로컬 유지, 서버 유지, 수동 병합

리본 아이콘이나 명령 팔레트에서 충돌 큐에 접근할 수 있습니다.

## 개발

### 사전 준비

- Node.js 20+
- npm

### 빌드

```bash
npm install
npm run build
```

### 개발 모드 (핫 리로드)

```bash
npm run dev
```

### 테스트

```bash
npm test
```

### 타입 검사

```bash
npm run typecheck
```

## 아키텍처

```
src/
  main.ts          플러그인 진입점 및 생명주기
  sync-engine.ts   핵심 동기화 엔진
  api-client.ts    서버 API 통신
  conflict.ts      충돌 감지 및 해결
  settings.ts      플러그인 설정 UI
  types.ts         TypeScript 타입 정의
  adapters/        API 추상화 계층
  services/        비즈니스 로직 서비스
  ui/              모달 및 뷰 컴포넌트
  utils/           유틸리티 함수
```

## 라이선스

MIT
