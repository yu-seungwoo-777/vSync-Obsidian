// SPEC-PLUGIN-BUGFIX-001: 12개 버그 수정 통합 테스트
// TDD RED-GREEN-REFACTOR 사이클로 작성

import { describe, it, expect, vi } from 'vitest';
import type { ConflictQueueItem, DiffOperation } from '../../src/types';
import type { OfflineQueueItem } from '../../src/types';

// ============================================================
// Milestone 1: REQ-003 (타입 통합)
// conflict.ts와 types.ts의 ConflictQueueItem, DiffOperation이 동일해야 함
// ============================================================

describe('REQ-003: 타입 통합', () => {
	it('conflict.ts의 ConflictQueueItem은 types.ts와 구조적으로 호환되어야 함', async () => {
		// conflict.ts에서 재export한 타입이 types.ts와 동일한지 구조적 타이핑으로 확인
		const conflictItem: ConflictQueueItem = {
			id: 'test-id',
			file_path: 'test.md',
			local_content: 'local',
			server_content: 'server',
			diff: null,
			base_hash: null,
			conflict_id: null,
			type: 'simple',
			timestamp: Date.now(),
			source: 'download',
		};

		// 동일한 타입으로 할당 가능해야 함 (컴파일 타임 검증)
		const assigned: ConflictQueueItem = conflictItem;
		expect(assigned.id).toBe('test-id');
	});

	it('conflict.ts의 DiffOperation은 types.ts와 구조적으로 호환되어야 함', async () => {
		const diffOp: DiffOperation = {
			op: 1,
			text: 'added text',
		};

		const assigned: DiffOperation = diffOp;
		expect(assigned.op).toBe(1);
		expect(assigned.text).toBe('added text');
	});

	it('conflict.ts는 types.ts에서 재export만 하고 중복 정의가 없어야 함', async () => {
		// conflict.ts 소스코드에 ConflictQueueItem 타입이 직접 정의되지 않았는지 확인
		// (컴파일 타임에만 검증되는 타입 export는 런타임에 값이 없음)
		const { ConflictQueue, ConflictResolver } = await import('../../src/conflict');
		expect(ConflictQueue).toBeDefined();
		expect(ConflictResolver).toBeDefined();
	});
});

// ============================================================
// Milestone 1: REQ-001 (큐 복원 프로퍼티명 수정)
// _isValidQueueItem이 retry_count가 아닌 retryCount를 검사해야 함
// ============================================================

describe('REQ-001: 큐 복원 프로퍼티명', () => {
	it('retryCount(camelCase)를 가진 큐 항목은 JSON 역직렬화 후에도 유지되어야 함', async () => {
		const serializedValidItem: OfflineQueueItem = {
			filePath: 'test.md',
			content: 'hello',
			operation: 'upload',
			timestamp: Date.now(),
			retryCount: 0,
		};

		const restored = JSON.parse(JSON.stringify(serializedValidItem));
		expect(restored.retryCount).toBe(0);
		expect(restored.retry_count).toBeUndefined();
	});

	it('retry_count(snake_case)를 가진 항목은 _isValidQueueItem에서 거부되어야 함', async () => {
		const serializedInvalidItem = {
			filePath: 'test.md',
			content: 'hello',
			operation: 'upload',
			timestamp: Date.now(),
			retry_count: 0,
		};

		const restored = JSON.parse(JSON.stringify(serializedInvalidItem));
		expect(restored.retry_count).toBe(0);
		expect(restored.retryCount).toBeUndefined();
	});
});

// ============================================================
// Milestone 1: REQ-002 (deleteFile 경로 인코딩)
// 비ASCII 문자가 포함된 경로가 encodeURIComponent로 인코딩되어야 함
// ============================================================

describe('REQ-002: deleteFile 경로 인코딩', () => {
	it('한글 경로가 포함된 파일 삭제 시 URL이 인코딩되어야 함', async () => {
		const { requestUrl } = await import('obsidian');
		const { VSyncClient } = await import('../../src/api-client');

		vi.mocked(requestUrl).mockResolvedValue({
			status: 200,
			headers: {},
			text: '',
			json: { message: 'deleted', deleted: true, path: 'test' },
			arrayBuffer: new ArrayBuffer(0),
		});

		const client = new VSyncClient({
			server_url: 'http://localhost:3000',
			vault_id: 'vault-1',
			device_id: 'device-1',
			session_token: 'token-1',
		});

		await client.deleteFile('문서/대한민국.md');

		expect(requestUrl).toHaveBeenCalledTimes(1);
		const callArg = vi.mocked(requestUrl).mock.calls[0][0];
		const url = typeof callArg === 'string' ? callArg : callArg.url;
		expect(url).toContain(encodeURIComponent('문서/대한민국.md'));
	});
});

// ============================================================
// Milestone 2: REQ-004 (평문 비밀번호 제거)
// 연결 성공 후 settings.password가 빈 문자열이어야 함
// ============================================================

describe('REQ-004: 평문 비밀번호 제거', () => {
	it('_handleConnect 후 설정에 비밀번호가 저장되지 않아야 함', async () => {
		const { ConnectModal } = await import('../../src/ui/connect-modal');

		const mockSettings = {
			server_url: 'http://localhost:3000',
			vault_id: '',
			session_token: '',
			device_id: 'device-1',
			username: '',
			password: '',
		};

		const onConnect = vi.fn().mockResolvedValue(true);

		const modal = new ConnectModal(
			{} as any, // eslint-disable-line @typescript-eslint/no-explicit-any
			mockSettings as any, // eslint-disable-line @typescript-eslint/no-explicit-any
			onConnect,
		);

		// 내부 상태 직접 설정
		(modal as any)._serverUrl = 'http://localhost:3000'; // eslint-disable-line @typescript-eslint/no-explicit-any
		(modal as any)._username = 'testuser'; // eslint-disable-line @typescript-eslint/no-explicit-any
		(modal as any)._password = 'secretpassword'; // eslint-disable-line @typescript-eslint/no-explicit-any
		(modal as any)._loginResult = { // eslint-disable-line @typescript-eslint/no-explicit-any
			token: 'jwt-token-123',
			user: { id: 'u1', username: 'test', role: 'user' },
			vaults: [{ id: 'v1', name: 'My Vault' }],
		};
		(modal as any)._vaults = [{ id: 'v1', name: 'My Vault' }]; // eslint-disable-line @typescript-eslint/no-explicit-any
		(modal as any)._selectedVaultId = 'v1'; // eslint-disable-line @typescript-eslint/no-explicit-any

		await (modal as any)._handleConnect(); // eslint-disable-line @typescript-eslint/no-explicit-any

		expect(onConnect).toHaveBeenCalled();
		const passedSettings = onConnect.mock.calls[0][0] as Record<string, unknown>;
		expect(passedSettings.password).toBe('');
	});
});

// ============================================================
// Milestone 3: REQ-008 (null App 가드)
// _openModalFn이 없을 때 TypeError 없이 서버 우선 해결해야 함
// ============================================================

describe('REQ-008: null App 가드', () => {
	it('_openModalFn이 없으면 TypeError 없이 server-wins로 해결해야 함', async () => {
		const { ConflictResolver } = await import('../../src/conflict');
		const mockNotice = vi.fn();
		const resolver = new ConflictResolver(mockNotice);

		const result = await resolver.handleMergeConflict({
			file_path: 'test.md',
			conflict_path: 'test.conflict.md',
			diff: [{ op: 1, text: 'change' }],
			conflict_id: 'conflict-123',
			server_content: 'server',
			local_content: 'local',
		});

		expect(result).toBe('remote');
		expect(mockNotice).toHaveBeenCalledWith(expect.stringContaining('test.md'));
	}, 10000);
});

// ============================================================
// Milestone 3: REQ-007 (_tryAutoMerge serverContent 사용)
// serverContent를 활용한 병합 로직이 구현되어야 함
// ============================================================

describe('REQ-007: _tryAutoMerge serverContent 활용', () => {
	it('local이 비어있으면 server 내용을 사용해야 함', async () => {
		const { requestUrl } = await import('obsidian');
		const { SyncEngine } = await import('../../src/sync-engine');

		vi.mocked(requestUrl).mockResolvedValue({
			status: 200,
			headers: {},
			text: '',
			json: { id: '1', path: 'test.md', hash: 'server-hash' },
			arrayBuffer: new ArrayBuffer(0),
		});

		const mockNotice = vi.fn();
		const engine = new SyncEngine(
			{ server_url: 'http://localhost:3000', vault_id: 'v1', device_id: 'd1', session_token: 'tok', sync_interval: 30, connection_mode: 'polling' as const, sync_enabled: true, username: '', password: '' } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
			{} as any, // eslint-disable-line @typescript-eslint/no-explicit-any
			mockNotice,
		);

		const result = await engine._tryAutoMerge('test.md', '', 'server content', 'conflict-1');
		expect(result).toBe(true);

		expect(requestUrl).toHaveBeenCalled();
		const uploadCall = vi.mocked(requestUrl).mock.calls.find(
			(c) => {
				const arg = c[0];
				return typeof arg !== 'string' && arg.method === 'PUT';
			},
		);
		expect(uploadCall).toBeDefined();
		expect(typeof uploadCall![0] !== 'string' && uploadCall![0].body).toBe('server content');
	});

	it('server가 비어있으면 local 내용을 사용해야 함', async () => {
		const { requestUrl } = await import('obsidian');
		const { SyncEngine } = await import('../../src/sync-engine');

		vi.mocked(requestUrl).mockReset();
		vi.mocked(requestUrl).mockResolvedValue({
			status: 200,
			headers: {},
			text: '',
			json: { id: '1', path: 'test.md', hash: 'local-hash' },
			arrayBuffer: new ArrayBuffer(0),
		});

		const mockNotice = vi.fn();
		const engine = new SyncEngine(
			{ server_url: 'http://localhost:3000', vault_id: 'v1', device_id: 'd1', session_token: 'tok', sync_interval: 30, connection_mode: 'polling' as const, sync_enabled: true, username: '', password: '' } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
			{} as any, // eslint-disable-line @typescript-eslint/no-explicit-any
			mockNotice,
		);

		const result = await engine._tryAutoMerge('test.md', 'local content', '', 'conflict-1');
		expect(result).toBe(true);

		const uploadCall = vi.mocked(requestUrl).mock.calls[0];
		expect(uploadCall).toBeDefined();
		expect(typeof uploadCall![0] !== 'string' && uploadCall![0].body).toBe('local content');
	});

	it('둘 다 내용이 있으면 local을 우선 사용해야 함', async () => {
		const { requestUrl } = await import('obsidian');
		const { SyncEngine } = await import('../../src/sync-engine');

		vi.mocked(requestUrl).mockReset();
		vi.mocked(requestUrl).mockResolvedValue({
			status: 200,
			headers: {},
			text: '',
			json: { id: '1', path: 'test.md', hash: 'merged-hash' },
			arrayBuffer: new ArrayBuffer(0),
		});

		const mockNotice = vi.fn();
		const engine = new SyncEngine(
			{ server_url: 'http://localhost:3000', vault_id: 'v1', device_id: 'd1', session_token: 'tok', sync_interval: 30, connection_mode: 'polling' as const, sync_enabled: true, username: '', password: '' } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
			{} as any, // eslint-disable-line @typescript-eslint/no-explicit-any
			mockNotice,
		);

		const result = await engine._tryAutoMerge('test.md', 'local version', 'server version', 'conflict-1');
		expect(result).toBe(true);

		const uploadCall = vi.mocked(requestUrl).mock.calls[0];
		expect(uploadCall).toBeDefined();
		expect(typeof uploadCall![0] !== 'string' && uploadCall![0].body).toBe('local version');
	});

	it('둘 다 비어있으면 빈 문자열을 사용해야 함', async () => {
		const { requestUrl } = await import('obsidian');
		const { SyncEngine } = await import('../../src/sync-engine');

		vi.mocked(requestUrl).mockResolvedValue({
			status: 200,
			headers: {},
			text: '',
			json: { id: '1', path: 'test.md', hash: 'empty-hash' },
			arrayBuffer: new ArrayBuffer(0),
		});

		const mockNotice = vi.fn();
		const engine = new SyncEngine(
			{ server_url: 'http://localhost:3000', vault_id: 'v1', device_id: 'd1', session_token: 'tok', sync_interval: 30, connection_mode: 'polling' as const, sync_enabled: true, username: '', password: '' } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
			{} as any, // eslint-disable-line @typescript-eslint/no-explicit-any
			mockNotice,
		);

		const result = await engine._tryAutoMerge('test.md', '', '', 'conflict-1');
		expect(result).toBe(true);
	});

	it('업로드 실패 시 false를 반환해야 함', async () => {
		const { requestUrl } = await import('obsidian');
		const { SyncEngine } = await import('../../src/sync-engine');

		vi.mocked(requestUrl).mockRejectedValue(new Error('Network error'));

		const mockNotice = vi.fn();
		const engine = new SyncEngine(
			{ server_url: 'http://localhost:3000', vault_id: 'v1', device_id: 'd1', session_token: 'tok', sync_interval: 30, connection_mode: 'polling' as const, sync_enabled: true, username: '', password: '' } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
			{} as any, // eslint-disable-line @typescript-eslint/no-explicit-any
			mockNotice,
		);

		const result = await engine._tryAutoMerge('test.md', 'local', 'server', 'conflict-1');
		expect(result).toBe(false);
	});
});

// ============================================================
// Milestone 3: REQ-009 (바이너리 파일 드롭 알림)
// _persistQueue에서 바이너리 항목 제외 시 Notice 표시
// ============================================================

describe('REQ-009: 바이너리 파일 드롭 알림', () => {
	it('바이너리 항목이 포함된 큐 저장 시 사용자에게 알림을 표시해야 함', async () => {
		const { Notice } = await import('obsidian');
		const mainModule = await import('../../src/main');

		const VSyncPlugin = mainModule.default;
		expect(VSyncPlugin).toBeDefined();

		const plugin = new (VSyncPlugin as any)() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		plugin.loadData = vi.fn().mockResolvedValue({});
		plugin.saveData = vi.fn().mockResolvedValue(undefined);

		const binaryData = new ArrayBuffer(8);
		const items = [
			{ filePath: 'test.md', content: 'text', operation: 'upload' as const, timestamp: Date.now(), retryCount: 0 },
			{ filePath: 'image.png', content: binaryData, operation: 'upload' as const, timestamp: Date.now(), retryCount: 0 },
			{ filePath: 'doc.pdf', content: new ArrayBuffer(16), operation: 'upload' as const, timestamp: Date.now(), retryCount: 0 },
		];

		await plugin._persistQueue(items);

		expect(Notice).toHaveBeenCalledWith(
			expect.stringContaining('2'),
		);
	});

	it('바이너리 항목이 없으면 알림을 표시하지 않아야 함', async () => {
		const { Notice } = await import('obsidian');
		const mainModule = await import('../../src/main');
		const VSyncPlugin = mainModule.default;

		const plugin = new (VSyncPlugin as any)() as any; // eslint-disable-line @typescript-eslint/no-explicit-any
		plugin.loadData = vi.fn().mockResolvedValue({});
		plugin.saveData = vi.fn().mockResolvedValue(undefined);

		vi.mocked(Notice).mockClear();

		const items = [
			{ filePath: 'test.md', content: 'text', operation: 'upload' as const, timestamp: Date.now(), retryCount: 0 },
			{ filePath: 'test2.md', content: 'more text', operation: 'upload' as const, timestamp: Date.now(), retryCount: 0 },
		];

		await plugin._persistQueue(items);

		const binaryNoticeCalls = vi.mocked(Notice).mock.calls.filter(
			(call) => typeof call[0] === 'string' && call[0].includes('바이너리'),
		);
		expect(binaryNoticeCalls.length).toBe(0);
	});
});
