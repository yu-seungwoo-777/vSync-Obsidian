---
id: SPEC-WEB-001
title: Vector 웹 관리 인터페이스 (Web Admin Interface)
version: 1.0.0
status: Planned
created: 2026-04-20
updated: 2026-04-20
author: yu
priority: High
issue_number: null
---

## HISTORY

| 버전 | 날짜 | 변경 내용 |
|------|------|-----------|
| 1.0.0 | 2026-04-20 | 최초 작성 |

---

## 개요 (Overview)

Vector는 자체 호스팅 Obsidian Sync 서버(Node.js 22 + Fastify 5 + Drizzle ORM + PostgreSQL 16 + MinIO)이다.
현재 서버 관리를 위한 웹 인터페이스가 존재하지 않으며, 관리자 인증 체계도 부재하다.

본 SPEC은 관리자가 웹 브라우저를 통해 서버를 관리할 수 있는 SPA(Single Page Application)를 정의한다.
주요 기능: 초기 설정, 관리자 로그인, 볼트 생성/목록 조회, 볼트별 문서 목록 조회.

---

## 요구사항 (Requirements)

### 초기 설정 (Initial Setup)

**REQ-SETUP-001** (Event-Driven)
**When** 관리자가 최초로 웹 인터페이스에 접근하고 `admin_credentials` 테이블에 레코드가 없으면, the system **shall** 초기 설정 페이지를 표시하여 username과 password 입력을 요청한다.

**REQ-SETUP-002** (Event-Driven)
**When** 관리자가 초기 설정 폼을 제출하면, the system **shall** password를 bcrypt로 해싱하여 `admin_credentials` 테이블에 저장하고, 자동으로 로그인 세션을 생성한다.

**REQ-SETUP-003** (State-Driven)
**While** `admin_credentials` 테이블에 레코드가 존재하는 동안, the system **shall** 초기 설정 페이지 접근을 차단하고 로그인 페이지로 리다이렉트한다.

### 관리자 인증 (Admin Authentication)

**REQ-AUTH-001** (Event-Driven)
**When** 관리자가 올바른 username과 password로 로그인을 시도하면, the system **shall** 세션 쿠키를 발급하고 대시보드로 리다이렉트한다.

**REQ-AUTH-002** (Unwanted Behavior)
**If** 인증되지 않은 요청이 `/admin/api/...` 엔드포인트에 접근하면, **then** the system **shall** HTTP 401 Unauthorized를 반환한다.

**REQ-AUTH-003** (Event-Driven)
**When** 관리자가 로그아웃을 요청하면, the system **shall** 서버측 세션을 파기하고 로그인 페이지로 리다이렉트한다.

### 볼트 관리 (Vault Management)

**REQ-VAULT-001** (Event-Driven)
**When** 관리자가 볼트 생성 폼을 제출하면, the system **shall** 새로운 볼트를 생성하고, 생성된 API 키를 모달에 표시하여 복사할 수 있게 한다.

**REQ-VAULT-002** (Event-Driven)
**When** 관리자가 볼트 목록 페이지에 접근하면, the system **shall** 모든 볼트의 이름, 생성일, 마스킹된 API 키 미리보기(마지막 8자)를 목록으로 표시한다.

**REQ-VAULT-003** (Event-Driven)
**When** 관리자가 특정 볼트의 "API 키 재생성" 버튼을 클릭하면, the system **shall** 새로운 API 키를 생성하고, `api_key_hash`와 `api_key_preview`를 갱신한 뒤, 새 키를 모달에 표시한다.

**REQ-VAULT-004** (Ubiquitous)
The system **shall** 볼트 생성 및 API 키 재생성 시 생성된 원본 API 키의 마지막 8자를 `api_key_preview` 컬럼에 저장한다.

### 문서 목록 조회 (File Listing)

**REQ-FILE-001** (Event-Driven)
**When** 관리자가 볼트 목록에서 특정 볼트를 클릭하면, the system **shall** 해당 볼트에 속한 파일 목록(파일명, 크기, 최종 수정일)을 표시한다.

**REQ-FILE-002** (State-Driven)
**While** 볼트에 파일이 없는 동안, the system **shall** "파일이 없습니다" 빈 상태 메시지를 표시한다.

### 정적 파일 서빙 (Static File Serving)

**REQ-SERVE-001** (Ubiquitous)
The system **shall** `packages/web`의 빌드 결과물을 `/` 경로에서 정적 파일로 서빙하며, SPA 라우팅을 위해 존재하지 않는 경로에 대해 `index.html`을 반환한다.

---

## 비기능 요구사항 (Non-Functional Requirements)

### 보안 (Security)

**REQ-SEC-001** (Ubiquitous)
The system **shall** 관리자 세션 쿠키에 `httpOnly`, `sameSite=strict`, `secure`(HTTPS 시) 속성을 설정한다.

**REQ-SEC-002** (Unwanted Behavior)
**If** 동일 IP에서 5분 이내 5회 이상 로그인 실패가 발생하면, **then** the system **shall** 해당 IP의 로그인 시도를 15분간 차단한다.

**REQ-SEC-003** (Ubiquitous)
The system **shall** password를 bcrypt(cost factor 12)로 해싱하여 저장한다.

### 성능 (Performance)

**REQ-PERF-001** (Ubiquitous)
The system **shall** 관리자 API 응답 시간을 P95 기준 200ms 이내로 유지한다.

**REQ-PERF-002** (Ubiquitous)
The system **shall** 정적 파일 서빙 시 적절한 Cache-Control 헤더를 설정한다 (해시된 에셋: 1년, index.html: no-cache).

---

## 아키텍처 결정 (Architecture Decisions)

### AD-001: 관리자 인증 방식

- **결정**: 세션 기반 인증 (`@fastify/cookie` + `@fastify/session`)
- **근거**: SPA에서의 단순한 인증 흐름, CSRF 방어 용이, httpOnly 쿠키로 XSS 방어

### AD-002: API 키 가시성 문제 해결

- **현상**: 현재 `api_key_hash`만 저장되어 생성 후 원본 키 조회 불가
- **결정**: `vaults` 테이블에 `api_key_preview` 컬럼 추가 (마지막 8자 저장) + "재생성" 기능 제공
- **근거**: 보안(원본 키 저장 불가)과 UX(식별 가능한 미리보기) 간 균형

### AD-003: 프론트엔드 기술 스택

- **결정**: React 19 + Vite + TypeScript (packages/web)
- **근거**: 모노레포 구조 활용, 빠른 빌드, 타입 안전성

### AD-004: API 라우트 접두사

- **결정**: `/admin/api/...` (기존 `/v1/...` 라우트와 분리)
- **근거**: 기존 API 무변경 보장, 역할 기반 접근 제어 용이

### AD-005: 정적 파일 서빙

- **결정**: `@fastify/static`으로 빌드 결과물을 `/`에서 서빙
- **근거**: 별도 웹서버 불필요, 단일 프로세스로 운영 단순화

---

## Exclusions (What NOT to Build) — Phase 1 제외 범위

1. **다중 관리자 계정**: Phase 1에서는 단일 관리자만 지원 (multi-admin 미지원)
2. **볼트 삭제/수정**: 볼트 이름 변경, 삭제 기능 미포함
3. **파일 내용 조회/다운로드**: 파일 목록만 제공, 내용 열람 불가
4. **OAuth / SSO**: 자체 username/password 인증만 지원
5. **다크모드 / 테마**: 기본 라이트 테마만 제공
6. **실시간 알림 / WebSocket**: 폴링 또는 수동 새로고침만 지원
7. **모바일 반응형 최적화**: 데스크톱 우선, 기본적인 반응형만 제공
8. **국제화(i18n)**: 한국어 단일 언어로 UI 제공
9. **감사 로그 (Audit Log)**: 관리자 행동 기록 미포함
10. **2FA / MFA**: Phase 1에서 미지원
