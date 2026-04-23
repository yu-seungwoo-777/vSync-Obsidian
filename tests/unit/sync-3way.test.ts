// SPEC-SYNC-DELETE-001: 3-Way 판정 함수 테스트
// _determineFileAction(inBase, inServer, inLocal) → FileAction
//
// 8가지 상태 조합에 대한 판정 행렬 검증 + EC-001 엣지 케이스
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncEngine } from '../../src/sync-engine';
import type { VSyncSettings } from '../../src/types';
import { DEFAULT_SETTINGS } from '../../src/types';
import { createMockVault } from '../mocks/vault';

// API 클라이언트 mock
const mockApiClient = {
	rawUpload: vi.fn(),
	rawDownload: vi.fn(),
	deleteFile: vi.fn(),
	listFiles: vi.fn(),
	getEvents: vi.fn(),
	updateSyncStatus: vi.fn(),
	testConnection: vi.fn(),
	setOnAuthFailure: vi.fn(),
	getQueueSize: vi.fn().mockReturnValue(0),
	flushQueue: vi.fn(),
	enqueue: vi.fn(),
	uploadAttachment: vi.fn(),
	downloadAttachment: vi.fn(),
	batchOperations: vi.fn(),
	moveFile: vi.fn(),
	getDevices: vi.fn(),
	removeDevice: vi.fn(),
	searchFiles: vi.fn(),
	getConflicts: vi.fn(),
	resolveConflict: vi.fn(),
	mergeResolve: vi.fn(),
};

vi.mock('../../src/api-client', () => ({
	VSyncClient: vi.fn().mockImplementation(() => mockApiClient),
	MAX_BINARY_SIZE: 52_428_800,
}));

vi.mock('../../src/utils/hash', () => ({
	computeHash: vi.fn().mockResolvedValue('mock-hash'),
}));

const mockNotice = vi.fn();
vi.mock('obsidian', () => ({
	requestUrl: vi.fn(),
	Notice: vi.fn().mockImplementation((msg: string) => mockNotice(msg)),
	Platform: { isDesktop: true, isMobile: false },
	normalizePath: vi.fn((path: string): string => {
		if (!path) return '';
		return path
			.replace(/\\/g, '/')
			.replace(/\/+/g, '/')
			.replace(/^\//, '');
	}),
}));

vi.mock('../../src/services/ws-client', () => ({
	WSClient: vi.fn().mockImplementation(() => ({
		connect: vi.fn(),
		close: vi.fn(),
		on: vi.fn(),
		isConnected: false,
		reconnectAttempts: 0,
		buildWSUrl: vi.fn().mockReturnValue('ws://localhost/ws/sync/vault-1?token=test-token'),
	})),
	calculateReconnectDelay: vi.fn().mockReturnValue(1000),
}));

describe('SyncEngine._determineFileAction — 3-Way 판정 행렬 (SPEC-SYNC-DELETE-001)', () => {
	let engine: SyncEngine;

	beforeEach(() => {
		vi.clearAllMocks();

		const settings: VSyncSettings = {
			...DEFAULT_SETTINGS,
			server_url: 'https://sync.example.com',
			username: 'testuser',
			password: '',
			session_token: 'test-token',
			sync_enabled: true,
			vault_id: 'vault-1',
			device_id: 'device-1',
			sync_interval: 30,
		};

		const vault = createMockVault();
		engine = new SyncEngine(settings, vault as never, mockNotice);
	});

	// ============================================================
	// Case 1: base=T, server=F, local=T → 'delete-local' (REQ-001)
	// 서버에서 삭제됨 → 로컬도 삭제
	// ============================================================
	it('base=T, server=F, local=T → delete-local (서버에서 삭제됨, REQ-001)', () => {
		const result = (engine as any)._determineFileAction(true, false, true);
		expect(result).toBe('delete-local');
	});

	// ============================================================
	// Case 2: base=T, server=T, local=F → 'delete-server' (REQ-002)
	// 로컬에서 삭제됨 → 서버도 삭제
	// ============================================================
	it('base=T, server=T, local=F → delete-server (로컬에서 삭제됨, REQ-002)', () => {
		const result = (engine as any)._determineFileAction(true, true, false);
		expect(result).toBe('delete-server');
	});

	// ============================================================
	// Case 3: base=T, server=F, local=F → 'skip'
	// 양쪽 모두 삭제됨 → 아무 작업 없음
	// ============================================================
	it('base=T, server=F, local=F → skip (양쪽 모두 삭제됨)', () => {
		const result = (engine as any)._determineFileAction(true, false, false);
		expect(result).toBe('skip');
	});

	// ============================================================
	// Case 4: base=T, server=T, local=T → 'compare-hash'
	// 세 곳 모두 존재 → 해시 비교로 변경 여부 판단
	// ============================================================
	it('base=T, server=T, local=T → compare-hash (기존 파일 해시 비교)', () => {
		const result = (engine as any)._determineFileAction(true, true, true);
		expect(result).toBe('compare-hash');
	});

	// ============================================================
	// Case 5: base=F, server=T, local=T → 'compare-hash'
	// 새 파일이 양쪽에 생김 → 해시 비교로 충돌 여부 판단
	// ============================================================
	it('base=F, server=T, local=T → compare-hash (새 파일 양쪽 존재)', () => {
		const result = (engine as any)._determineFileAction(false, true, true);
		expect(result).toBe('compare-hash');
	});

	// ============================================================
	// Case 6: base=F, server=T, local=F → 'download'
	// 서버에만 존재 → 다운로드
	// ============================================================
	it('base=F, server=T, local=F → download (서버에서만 존재)', () => {
		const result = (engine as any)._determineFileAction(false, true, false);
		expect(result).toBe('download');
	});

	// ============================================================
	// Case 7: base=F, server=F, local=T → 'upload'
	// 로컬에만 존재 → 업로드
	// ============================================================
	it('base=F, server=F, local=T → upload (로컬에서만 존재)', () => {
		const result = (engine as any)._determineFileAction(false, false, true);
		expect(result).toBe('upload');
	});

	// ============================================================
	// Case 8: base=F, server=F, local=F → 'skip'
	// 불가능한 상태 → 아무 작업 없음
	// ============================================================
	it('base=F, server=F, local=F → skip (불가능한 상태)', () => {
		const result = (engine as any)._determineFileAction(false, false, false);
		expect(result).toBe('skip');
	});

	// ============================================================
	// EC-001: LRU eviction — base info missing → 2-way fallback
	// hash_cache 엔트리가 LRU eviction으로 유실된 경우,
	// delete-local/delete-server가 반환되지 않아야 함 (안전한 2-way 폴백)
	// ============================================================
	it('EC-001: inBase=false일 때 delete-local/delete-server가 반환되지 않아야 한다', () => {
		const deleteActions = ['delete-local', 'delete-server'];
		const cases = [
			{ inBase: false, inServer: true,  inLocal: true  },
			{ inBase: false, inServer: true,  inLocal: false },
			{ inBase: false, inServer: false, inLocal: true  },
			{ inBase: false, inServer: false, inLocal: false },
		];

		for (const { inBase, inServer, inLocal } of cases) {
			const result = (engine as any)._determineFileAction(inBase, inServer, inLocal);
			expect(deleteActions).not.toContain(result);
		}
	});
});
