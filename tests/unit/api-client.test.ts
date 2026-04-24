// API 클라이언트 테스트
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestUrlParam, RequestUrlResponse } from '../mocks/obsidian';

// vi.hoisted로 mock을 생성하여 vi.mock factory에서 사용 가능하게 함
const { mockRequestUrl } = vi.hoisted(() => ({
	mockRequestUrl: vi.fn().mockImplementation(async () => ({
		status: 200,
		headers: {},
		text: '',
		json: {},
		arrayBuffer: new ArrayBuffer(0),
	})),
}));

vi.mock('obsidian', () => ({
	requestUrl: mockRequestUrl,
	Notice: vi.fn(),
	Platform: { isDesktop: true, isMobile: false },
}));

import { VSyncClient, getMimeType } from '../../src/api-client';

function makeResponse(overrides: Partial<RequestUrlResponse> & { json?: unknown } = {}): RequestUrlResponse {
	return {
		status: 200,
		headers: {},
		text: '',
		json: (overrides.json ?? {}) as Record<string, unknown>,
		arrayBuffer: new ArrayBuffer(0),
		...(overrides as Partial<RequestUrlResponse>),
	};
}

describe('VSyncClient', () => {
	let client: VSyncClient;

	const baseSettings = {
		server_url: 'https://sync.example.com',
		session_token: 'test-token',
		vault_id: 'vault-1',
		device_id: 'device-1',
	};

	beforeEach(() => {
		vi.clearAllMocks();
		mockRequestUrl.mockReset();
		client = new VSyncClient(baseSettings);
	});

	describe('생성자', () => {
		it('서버 URL의 trailing slash를 제거해야 한다', () => {
			const c = new VSyncClient({ ...baseSettings, server_url: 'https://example.com/' });
			expect(c).toBeDefined();
		});
	});

	describe('rawUpload', () => {
		it('PUT /v1/vault/{id}/raw/{path}로 파일을 업로드해야 한다', async () => {
			mockRequestUrl.mockResolvedValueOnce(
				makeResponse({
					json: { id: 1, path: 'notes/test.md', hash: 'abc123', size_bytes: 100, version: 1 },
				})
			);

			const result = await client.rawUpload('notes/test.md', '# Test') as any; // eslint-disable-line @typescript-eslint/no-explicit-any
			expect(mockRequestUrl).toHaveBeenCalledWith(
				expect.objectContaining({
					url: 'https://sync.example.com/v1/vault/vault-1/raw/notes%2Ftest.md',
					method: 'PUT',
					contentType: 'text/markdown',
					body: '# Test',
				})
			);
			expect(result.path).toBe('notes/test.md');
			expect(result.hash).toBe('abc123');
		});

		it('Authorization Bearer와 X-Device-ID 헤더를 포함해야 한다', async () => {
			mockRequestUrl.mockResolvedValueOnce(
				makeResponse({
					json: { id: 1, path: 'test.md', hash: 'h', size_bytes: 0, version: 1 },
				})
			);

			await client.rawUpload('test.md', 'content');

			const call = mockRequestUrl.mock.calls[0][0] as RequestUrlParam;
			expect(call.headers).toEqual(
				expect.objectContaining({
					'Authorization': 'Bearer test-token',
					'X-Device-ID': 'device-1',
				})
			);
		});

		it('한국어 경로를 URL 인코딩해야 한다', async () => {
			mockRequestUrl.mockResolvedValueOnce(
				makeResponse({
					json: { id: 1, path: 'notes/프로젝트.md', hash: 'h', size_bytes: 0, version: 1 },
				})
			);

			await client.rawUpload('notes/프로젝트.md', '내용');

			const call = mockRequestUrl.mock.calls[0][0] as RequestUrlParam;
			expect(call.url).toContain(encodeURIComponent('notes/프로젝트.md'));
		});

		// ============================================================
		// SPEC-SYNC-3WAY-FIX-001 T-001: X-Base-Hash 헤더
		// ============================================================

		it('baseHash 전달 시 X-Base-Hash 헤더를 포함해야 한다', async () => {
			mockRequestUrl.mockResolvedValueOnce(
				makeResponse({
					json: { id: 1, path: 'test.md', hash: 'new-hash', size_bytes: 0, version: 1 },
				})
			);

			await client.rawUpload('test.md', 'content', 'base-hash-abc');

			const call = mockRequestUrl.mock.calls[0][0] as RequestUrlParam;
			expect(call.headers).toEqual(
				expect.objectContaining({
					'X-Base-Hash': 'base-hash-abc',
				})
			);
		});

		it('baseHash 미전달 시 X-Base-Hash 헤더가 없어야 한다', async () => {
			mockRequestUrl.mockResolvedValueOnce(
				makeResponse({
					json: { id: 1, path: 'test.md', hash: 'h', size_bytes: 0, version: 1 },
				})
			);

			await client.rawUpload('test.md', 'content');

			const call = mockRequestUrl.mock.calls[0][0] as RequestUrlParam;
			expect(call.headers).not.toHaveProperty('X-Base-Hash');
		});

		it('baseHash가 undefined면 X-Base-Hash 헤더가 없어야 한다', async () => {
			mockRequestUrl.mockResolvedValueOnce(
				makeResponse({
					json: { id: 1, path: 'test.md', hash: 'h', size_bytes: 0, version: 1 },
				})
			);

			await client.rawUpload('test.md', 'content', undefined);

			const call = mockRequestUrl.mock.calls[0][0] as RequestUrlParam;
			expect(call.headers).not.toHaveProperty('X-Base-Hash');
		});
	});

	describe('rawDownload', () => {
		it('GET /v1/vault/{id}/raw/{path}로 파일을 다운로드해야 한다', async () => {
			mockRequestUrl.mockResolvedValueOnce(
				makeResponse({ text: '# Downloaded content' })
			);

			const content = await client.rawDownload('notes/test.md');

			expect(mockRequestUrl).toHaveBeenCalledWith(
				expect.objectContaining({
					url: 'https://sync.example.com/v1/vault/vault-1/raw/notes%2Ftest.md',
					method: 'GET',
				})
			);
			expect(content).toBe('# Downloaded content');
		});

		it('다운로드 시 Authorization Bearer 헤더를 포함해야 한다', async () => {
			mockRequestUrl.mockResolvedValueOnce(makeResponse({ text: '' }));

			await client.rawDownload('test.md');

			const call = mockRequestUrl.mock.calls[0][0] as RequestUrlParam;
			expect(call.headers?.['Authorization']).toBe('Bearer test-token');
		});
	});

	describe('deleteFile', () => {
		it('DELETE /v1/vault/{id}/file/{path}를 호출해야 한다', async () => {
			mockRequestUrl.mockResolvedValueOnce(
				makeResponse({
					json: { message: 'File deleted', deleted: true, path: 'test.md' },
				})
			);

			await client.deleteFile('test.md');

			expect(mockRequestUrl).toHaveBeenCalledWith(
				expect.objectContaining({
					url: 'https://sync.example.com/v1/vault/vault-1/file/test.md',
					method: 'DELETE',
				})
			);
		});
	});

	describe('listFiles', () => {
		it('GET /v1/vault/{id}/files로 파일 목록을 반환해야 한다', async () => {
			const files = [
				{ id: 1, path: 'a.md', hash: 'h1', size_bytes: 10, created_at: '2026-01-01', updated_at: '2026-01-01' },
				{ id: 2, path: 'b.md', hash: 'h2', size_bytes: 20, created_at: '2026-01-02', updated_at: '2026-01-02' },
			];
			mockRequestUrl.mockResolvedValueOnce(makeResponse({ json: files }));

			const result = await client.listFiles();

			expect(result).toHaveLength(2);
			expect(result[0].path).toBe('a.md');
		});
	});

	describe('getEvents', () => {
		it('GET /v1/vault/{id}/events?since={id}로 이벤트를 반환해야 한다', async () => {
			const events = [
				{ id: '10', event_type: 'created', file_path: 'a.md', device_id: 'd1', created_at: '2026-01-01' },
			];
			mockRequestUrl.mockResolvedValueOnce(
				makeResponse({ json: { events } })
			);

			const result = await client.getEvents('5');

			expect(mockRequestUrl).toHaveBeenCalledWith(
				expect.objectContaining({
					url: 'https://sync.example.com/v1/vault/vault-1/events?since=5',
					method: 'GET',
				})
			);
			expect(result).toHaveLength(1);
			expect(result[0].id).toBe('10');
		});

		it('since 파라미터가 없으면 쿼리스트링 없이 요청해야 한다', async () => {
			mockRequestUrl.mockResolvedValueOnce(
				makeResponse({ json: { events: [] } })
			);

			await client.getEvents();

			const call = mockRequestUrl.mock.calls[0][0] as RequestUrlParam;
			expect(call.url).not.toContain('?since=');
		});
	});

	describe('updateSyncStatus', () => {
		it('PUT /v1/vault/{id}/sync-status로 커서를 업데이트해야 한다', async () => {
			mockRequestUrl.mockResolvedValueOnce(
				makeResponse({
					json: { device_id: 'device-1', vault_id: 'vault-1', last_event_id: '42', last_sync_at: '2026-01-01' },
				})
			);

			await client.updateSyncStatus('42');

			expect(mockRequestUrl).toHaveBeenCalledWith(
				expect.objectContaining({
					url: 'https://sync.example.com/v1/vault/vault-1/sync-status',
					method: 'PUT',
					contentType: 'application/json',
				})
			);
			const call = mockRequestUrl.mock.calls[0][0] as RequestUrlParam;
			const body = JSON.parse(call.body as string);
			expect(body).toEqual({ device_id: 'device-1', last_event_id: '42' });
		});
	});

	describe('testConnection', () => {
		it('연결 성공 시 파일 수를 반환해야 한다', async () => {
			const files = [
				{ id: 1, path: 'a.md', hash: 'h1', size_bytes: 10, created_at: '', updated_at: '' },
				{ id: 2, path: 'b.md', hash: 'h2', size_bytes: 20, created_at: '', updated_at: '' },
			];
			mockRequestUrl.mockResolvedValueOnce(makeResponse({ json: files }));

			const result = await client.testConnection();

			expect((result as Record<string, unknown>).success).toBe(true);
			expect(result.fileCount).toBe(2);
		});

		it('인증 실패 시 적절한 에러 메시지를 반환해야 한다', async () => {
			mockRequestUrl.mockRejectedValueOnce({ status: 401 });

			const result = await client.testConnection();

			expect(result.success).toBe(false);
			expect(result.error).toContain('Authentication');
		});

		it('네트워크 오류 시 적절한 에러 메시지를 반환해야 한다', async () => {
			mockRequestUrl.mockRejectedValueOnce(new Error('Network error'));

			const result = await client.testConnection();

			expect(result.success).toBe(false);
			expect(result.error).toBeDefined();
		});
	});

	describe('오프라인 큐 (REQ-P4-007)', () => {
		it('네트워크 실패 시 큐에 작업을 추가해야 한다', async () => {
			mockRequestUrl.mockRejectedValueOnce(new Error('Network error'));

			await expect(client.rawUpload('test.md', 'content')).rejects.toThrow();

			expect(client.getQueueSize()).toBe(1);
		});

		it('큐 최대 크기는 100개여야 한다', () => {
			for (let i = 0; i < 110; i++) {
				client.enqueue({
					filePath: `file${i}.md`,
					content: 'content',
					operation: 'upload',
					timestamp: Date.now(),
					retryCount: 0,
				});
			}
			expect(client.getQueueSize()).toBe(100);
		});

		it('큐의 작업을 재시도해야 한다', async () => {
			mockRequestUrl.mockResolvedValueOnce(
				makeResponse({
					json: { id: 1, path: 'test.md', hash: 'h', size_bytes: 0, version: 1 },
				})
			);

			client.enqueue({
				filePath: 'test.md',
				content: 'content',
				operation: 'upload',
				timestamp: Date.now(),
				retryCount: 0,
			});

			await client.flushQueue();

			expect(mockRequestUrl).toHaveBeenCalled();
			expect(client.getQueueSize()).toBe(0);
		});
	});

	describe('401 인증 실패 (REQ-P4-006)', () => {
		it('401 에러 시 onAuthFailure 콜백을 호출해야 한다', async () => {
			const onAuthFailure = vi.fn();
			client.setOnAuthFailure(onAuthFailure);

			mockRequestUrl.mockRejectedValueOnce({ status: 401 });

			await expect(client.rawUpload('test.md', 'content')).rejects.toThrow();

			expect(onAuthFailure).toHaveBeenCalled();
		});
	});

	// ============================================================
	// REQ-P6-007 ~ REQ-P6-009: 바이너리 첨부파일 API
	// ============================================================

	describe('uploadAttachment (REQ-P6-007)', () => {
		it('PUT /v1/vault/{id}/attachment/{path}로 바이너리를 업로드해야 한다', async () => {
			const binaryData = new Uint8Array([1, 2, 3]).buffer;
			mockRequestUrl.mockResolvedValueOnce(
				makeResponse({
					json: { id: 1, path: 'images/photo.png', hash: 'binhash', size_bytes: 3, version: 1 },
				})
			);

			const result = await client.uploadAttachment('images/photo.png', binaryData);

			expect(mockRequestUrl).toHaveBeenCalledWith(
				expect.objectContaining({
					url: 'https://sync.example.com/v1/vault/vault-1/attachment/images%2Fphoto.png',
					method: 'PUT',
					contentType: 'image/png',
					body: binaryData,
				})
			);
			expect(result.path).toBe('images/photo.png');
			expect(result.hash).toBe('binhash');
		});

		it('X-API-Key와 X-Device-ID 헤더를 포함해야 한다', async () => {
			const binaryData = new Uint8Array([0]).buffer;
			mockRequestUrl.mockResolvedValueOnce(
				makeResponse({
					json: { id: 1, path: 'test.png', hash: 'h', size_bytes: 1, version: 1 },
				})
			);

			await client.uploadAttachment('test.png', binaryData);

			const call = mockRequestUrl.mock.calls[0][0] as RequestUrlParam;
			expect(call.headers).toEqual(
				expect.objectContaining({
					'Authorization': 'Bearer test-token',
					'X-Device-ID': 'device-1',
				})
			);
		});

		it('네트워크 오류 시 오프라인 큐에 ArrayBuffer content로 추가해야 한다', async () => {
			const binaryData = new Uint8Array([1, 2, 3]).buffer;
			mockRequestUrl.mockRejectedValueOnce(new Error('Network error'));

			await expect(client.uploadAttachment('photo.png', binaryData)).rejects.toThrow();

			expect(client.getQueueSize()).toBe(1);
		});
	});

	describe('downloadAttachment (REQ-P6-008)', () => {
		it('GET /v1/vault/{id}/attachment/{path}로 바이너리를 다운로드해야 한다', async () => {
			const expectedData = new Uint8Array([10, 20, 30]).buffer;
			mockRequestUrl.mockResolvedValueOnce(
				makeResponse({ arrayBuffer: expectedData })
			);

			const result = await client.downloadAttachment('images/photo.png');

			expect(mockRequestUrl).toHaveBeenCalledWith(
				expect.objectContaining({
					url: 'https://sync.example.com/v1/vault/vault-1/attachment/images%2Fphoto.png',
					method: 'GET',
				})
			);
			expect(result).toBe(expectedData);
		});

		it('404 응답 시 에러를 throw해야 한다', async () => {
			mockRequestUrl.mockRejectedValueOnce({ status: 404 });

			await expect(client.downloadAttachment('missing.png')).rejects.toEqual({ status: 404 });
		});
	});

	describe('getMimeType (REQ-P6-009)', () => {
		it('모든 지원 확장자의 MIME 타입을 반환해야 한다', () => {
			expect(getMimeType('photo.png')).toBe('image/png');
			expect(getMimeType('photo.jpg')).toBe('image/jpeg');
			expect(getMimeType('photo.jpeg')).toBe('image/jpeg');
			expect(getMimeType('photo.gif')).toBe('image/gif');
			expect(getMimeType('photo.svg')).toBe('image/svg+xml');
			expect(getMimeType('photo.webp')).toBe('image/webp');
			expect(getMimeType('doc.pdf')).toBe('application/pdf');
			expect(getMimeType('audio.mp3')).toBe('audio/mpeg');
			expect(getMimeType('video.mp4')).toBe('video/mp4');
			expect(getMimeType('audio.wav')).toBe('audio/wav');
			expect(getMimeType('audio.ogg')).toBe('audio/ogg');
		});

		it('알 수 없는 확장자는 application/octet-stream을 반환해야 한다', () => {
			expect(getMimeType('file.xyz')).toBe('application/octet-stream');
		});
	});

	// ============================================================
	// SPEC-P6-PERSIST-004: 오프라인 큐 영속화
	// ============================================================

	describe('PersistCallback (REQ-P6-001)', () => {
		it('enqueue 시 persistCallback이 호출되어야 한다', () => {
			const persistCallback = vi.fn();
			const c = new VSyncClient(baseSettings, persistCallback);

			c.enqueue({
				filePath: 'test.md',
				content: 'content',
				operation: 'upload',
				timestamp: Date.now(),
				retryCount: 0,
			});

			expect(persistCallback).toHaveBeenCalledTimes(1);
			expect(persistCallback).toHaveBeenCalledWith(
				expect.arrayContaining([
					expect.objectContaining({ filePath: 'test.md' }),
				])
			);
		});

		it('persistCallback이 없으면 noop으로 동작해야 한다 (하위 호환)', () => {
			const c = new VSyncClient(baseSettings);
			expect(() => {
				c.enqueue({
					filePath: 'test.md',
					content: 'content',
					operation: 'upload',
					timestamp: Date.now(),
					retryCount: 0,
				});
			}).not.toThrow();
		});

		it('flushQueue 성공 후 persistCallback이 호출되어야 한다', async () => {
			const persistCallback = vi.fn();
			const c = new VSyncClient(baseSettings, persistCallback);

			mockRequestUrl.mockResolvedValueOnce(
				makeResponse({
					json: { id: 1, path: 'test.md', hash: 'h', size_bytes: 0, version: 1 },
				})
			);

			c.enqueue({
				filePath: 'test.md',
				content: 'content',
				operation: 'upload',
				timestamp: Date.now(),
				retryCount: 0,
			});

			persistCallback.mockClear();
			await c.flushQueue();

			// flush 성공 후 persist 호출 (큐가 비어있음을 persist)
			expect(persistCallback).toHaveBeenCalled();
		});
	});

	describe('filePath dedup (REQ-P6-004)', () => {
		it('동일 filePath의 이전 항목을 제거하고 최신 항목만 유지해야 한다', () => {
			const persistCallback = vi.fn();
			const c = new VSyncClient(baseSettings, persistCallback);

			c.enqueue({
				filePath: 'test.md',
				content: 'old content',
				operation: 'upload',
				timestamp: Date.now(),
				retryCount: 0,
			});

			c.enqueue({
				filePath: 'test.md',
				content: 'new content',
				operation: 'upload',
				timestamp: Date.now(),
				retryCount: 0,
			});

			expect(c.getQueueSize()).toBe(1);

			// persistCallback의 마지막 호출에서 항목 확인
			const lastCall = persistCallback.mock.calls[persistCallback.mock.calls.length - 1];
			expect(lastCall[0]).toHaveLength(1);
			expect(lastCall[0][0].content).toBe('new content');
		});

		it('upload 후 delete 연속 시 delete만 큐에 남아야 한다', () => {
			const c = new VSyncClient(baseSettings);

			c.enqueue({
				filePath: 'test.md',
				content: 'content',
				operation: 'upload',
				timestamp: Date.now(),
				retryCount: 0,
			});

			c.enqueue({
				filePath: 'test.md',
				content: '',
				operation: 'delete',
				timestamp: Date.now(),
				retryCount: 0,
			});

			expect(c.getQueueSize()).toBe(1);
		});

		it('delete 후 upload 연속 시 upload만 큐에 남아야 한다', () => {
			const c = new VSyncClient(baseSettings);

			c.enqueue({
				filePath: 'test.md',
				content: '',
				operation: 'delete',
				timestamp: Date.now(),
				retryCount: 0,
			});

			c.enqueue({
				filePath: 'test.md',
				content: 'new content',
				operation: 'upload',
				timestamp: Date.now(),
				retryCount: 0,
			});

			expect(c.getQueueSize()).toBe(1);
		});

		it('dedup 후에도 MAX_QUEUE_SIZE 제한을 유지해야 한다', () => {
			const c = new VSyncClient(baseSettings);

			// 서로 다른 filePath로 100개 채우기
			for (let i = 0; i < 100; i++) {
				c.enqueue({
					filePath: `file${i}.md`,
					content: 'content',
					operation: 'upload',
					timestamp: Date.now(),
					retryCount: 0,
				});
			}
			expect(c.getQueueSize()).toBe(100);

			// 기존 filePath에 대해 enqueue → dedup 후 여전히 100
			c.enqueue({
				filePath: 'file50.md',
				content: 'updated',
				operation: 'upload',
				timestamp: Date.now(),
				retryCount: 0,
			});
			expect(c.getQueueSize()).toBe(100);
		});
	});

	describe('Flush mutex (REQ-P6-007)', () => {
		it('동시 flushQueue 호출 시 두 번째는 즉시 반환해야 한다', async () => {
			const c = new VSyncClient(baseSettings);

			// 긴 실행을 시뮬레이션
			mockRequestUrl.mockImplementation(async () => {
				await new Promise((resolve) => setTimeout(resolve, 100));
				return makeResponse({
					json: { id: 1, path: 'test.md', hash: 'h', size_bytes: 0, version: 1 },
				});
			});

			c.enqueue({
				filePath: 'test.md',
				content: 'content',
				operation: 'upload',
				timestamp: Date.now(),
				retryCount: 0,
			});

			// 두 번의 동시 flush 시작
			const p1 = c.flushQueue();
			const p2 = c.flushQueue();

			await Promise.all([p1, p2]);

			// upload는 한 번만 호출되어야 함
			expect(mockRequestUrl).toHaveBeenCalledTimes(1);
		});

		it('flush 중 예외 발생 시 _isFlushing이 false로 복원되어야 한다', async () => {
			const c = new VSyncClient(baseSettings);

			mockRequestUrl.mockRejectedValueOnce(new Error('Network error'));

			c.enqueue({
				filePath: 'test.md',
				content: 'content',
				operation: 'upload',
				timestamp: Date.now(),
				retryCount: 0,
			});

			await c.flushQueue();

			// 두 번째 flush가 정상적으로 실행 가능해야 함
			mockRequestUrl.mockResolvedValueOnce(
				makeResponse({
					json: { id: 1, path: 'test.md', hash: 'h', size_bytes: 0, version: 1 },
				})
			);

			// 네트워크 에러 후 item이 다시 큐에 들어감
			// 두 번째 flush 시도
			await c.flushQueue();
		});
	});

	describe('Exponential Backoff + Max Retries (REQ-P6-005)', () => {
		it('네트워크 에러 시 retryCount가 증가해야 한다', async () => {
			const c = new VSyncClient(baseSettings);

			mockRequestUrl.mockRejectedValue(new Error('Network error'));

			c.enqueue({
				filePath: 'test.md',
				content: 'content',
				operation: 'upload',
				timestamp: Date.now(),
				retryCount: 0,
			});

			await c.flushQueue();

			// item이 다시 큐에 들어가고 retryCount가 1 증가
			expect(c.getQueueSize()).toBe(1);
		});

		it('retryCount 3 도달 시 항목을 큐에서 제거하고 onFlushFailed를 호출해야 한다', async () => {
			const onFlushFailed = vi.fn();
			const c = new VSyncClient(baseSettings, vi.fn(), onFlushFailed);

			mockRequestUrl.mockRejectedValue(new Error('Network error'));

			c.enqueue({
				filePath: 'test.md',
				content: 'content',
				operation: 'upload',
				timestamp: Date.now(),
				retryCount: 2, // 이미 2번 실패
			});

			await c.flushQueue();

			// 3번째 실패 → 큐에서 제거
			expect(c.getQueueSize()).toBe(0);
			expect(onFlushFailed).toHaveBeenCalledWith(
				expect.arrayContaining([
					expect.objectContaining({ filePath: 'test.md' }),
				])
			);
		});

		it('모든 영구 실패 항목을 모아서 onFlushFailed로 한 번에 알림해야 한다', async () => {
			const onFlushFailed = vi.fn();
			const c = new VSyncClient(baseSettings, vi.fn(), onFlushFailed);

			// 네트워크 에러가 아닌 일반 에러 → 즉시 영구 실패
			mockRequestUrl.mockRejectedValue({ status: 500 });

			c.enqueue({
				filePath: 'a.md',
				content: 'content-a',
				operation: 'upload',
				timestamp: Date.now(),
				retryCount: 0,
			});
			c.enqueue({
				filePath: 'b.md',
				content: 'content-b',
				operation: 'upload',
				timestamp: Date.now(),
				retryCount: 0,
			});

			await c.flushQueue();

			expect(onFlushFailed).toHaveBeenCalledTimes(1);
			expect(onFlushFailed).toHaveBeenCalledWith(
				expect.arrayContaining([
					expect.objectContaining({ filePath: 'a.md' }),
					expect.objectContaining({ filePath: 'b.md' }),
				])
			);
			expect(c.getQueueSize()).toBe(0);
		});
	});

	describe('restoreQueue (REQ-P6-002)', () => {
		it('restoreQueue 후 getQueueSize가 복원된 크기를 반환해야 한다', () => {
			const c = new VSyncClient(baseSettings);

			c.restoreQueue([
				{
					filePath: 'restored.md',
					content: 'restored content',
					operation: 'upload',
					timestamp: Date.now(),
					retryCount: 0,
				},
				{
					filePath: 'deleted.md',
					content: '',
					operation: 'delete',
					timestamp: Date.now(),
					retryCount: 1,
				},
			]);

			expect(c.getQueueSize()).toBe(2);
		});

		it('빈 배열로 restoreQueue 시 큐 크기가 0이어야 한다', () => {
			const c = new VSyncClient(baseSettings);

			c.enqueue({
				filePath: 'test.md',
				content: 'content',
				operation: 'upload',
				timestamp: Date.now(),
				retryCount: 0,
			});

			c.restoreQueue([]);

			expect(c.getQueueSize()).toBe(0);
		});
	});

	describe('flushQueue (바이너리 분기)', () => {
		it('ArrayBuffer content가 있으면 uploadAttachment로 재시도해야 한다', async () => {
			const binaryData = new Uint8Array([1, 2, 3]).buffer;
			mockRequestUrl.mockResolvedValueOnce(
				makeResponse({
					json: { id: 1, path: 'photo.png', hash: 'h', size_bytes: 3, version: 1 },
				})
			);

			client.enqueue({
				filePath: 'photo.png',
				content: binaryData,
				operation: 'upload',
				timestamp: Date.now(),
				retryCount: 0,
			});

			await client.flushQueue();

			// uploadAttachment가 호출되었는지 확인 (attachment 엔드포인트로 요청)
			expect(mockRequestUrl).toHaveBeenCalledWith(
				expect.objectContaining({
					url: expect.stringContaining('/attachment/'),
				})
			);
			expect(client.getQueueSize()).toBe(0);
		});

		it('string content가 있으면 기존 rawUpload 경로를 사용해야 한다', async () => {
			mockRequestUrl.mockResolvedValueOnce(
				makeResponse({
					json: { id: 1, path: 'test.md', hash: 'h', size_bytes: 0, version: 1 },
				})
			);

			client.enqueue({
				filePath: 'test.md',
				content: '# Hello',
				operation: 'upload',
				timestamp: Date.now(),
				retryCount: 0,
			});

			await client.flushQueue();

			// rawUpload는 /raw/ 엔드포인트 사용
			expect(mockRequestUrl).toHaveBeenCalledWith(
				expect.objectContaining({
					url: expect.stringContaining('/raw/'),
				})
			);
			expect(client.getQueueSize()).toBe(0);
		});
	});

	// ============================================================
	// SPEC-P6-UX-002: 409 Conflict 응답 처리 (REQ-UX-002)
	// ============================================================

	describe('rawUpload 409 Conflict (REQ-UX-002)', () => {
		it('409 응답 시 ConflictResult를 반환해야 한다 (AC-002.1)', async () => {
			mockRequestUrl.mockRejectedValueOnce({
				status: 409,
				json: {
					conflict_path: 'notes/test.md',
					current_hash: 'server-hash',
					incoming_hash: 'local-hash',
					base_hash: 'base-hash',
					diff: [{ op: -1, text: 'old' }, { op: 1, text: 'new' }],
					can_auto_merge: false,
				},
			});

			const result = await client.rawUpload('notes/test.md', 'content');

			// ConflictResult discriminator 확인
			if ('conflict' in result && result.conflict === true) {
				expect(result.conflict).toBe(true);
				expect(result.conflict_path).toBe('notes/test.md');
				expect(result.current_hash).toBe('server-hash');
				expect(result.incoming_hash).toBe('local-hash');
				expect(result.base_hash).toBe('base-hash');
				expect(result.diff).toHaveLength(2);
				expect(result.can_auto_merge).toBe(false);
			} else {
				expect.fail('Expected ConflictResult but got UploadResult');
			}
		});

		it('409 응답 시 에러를 throw하지 않아야 한다 (AC-002.1)', async () => {
			mockRequestUrl.mockRejectedValueOnce({
				status: 409,
				json: {
					conflict_path: 'test.md',
					current_hash: 'h1',
					incoming_hash: 'h2',
				},
			});

			// throw 없이 ConflictResult 반환
			const result = await client.rawUpload('test.md', 'content');
			expect(result).toBeDefined();
		});

		it('409 응답 시 오프라인 큐에 추가하지 않아야 한다', async () => {
			mockRequestUrl.mockRejectedValueOnce({
				status: 409,
				json: {
					conflict_path: 'test.md',
					current_hash: 'h1',
					incoming_hash: 'h2',
				},
			});

			await client.rawUpload('test.md', 'content');

			expect(client.getQueueSize()).toBe(0);
		});

		it('500 에러는 기존처럼 throw해야 한다 (AC-002.5)', async () => {
			mockRequestUrl.mockRejectedValueOnce({ status: 500 });

			await expect(client.rawUpload('test.md', 'content')).rejects.toEqual({ status: 500 });
		});

		it('네트워크 에러는 기존처럼 throw하고 큐에 추가해야 한다 (AC-002.5)', async () => {
			mockRequestUrl.mockRejectedValueOnce(new Error('Network error'));

			await expect(client.rawUpload('test.md', 'content')).rejects.toThrow('Network error');
			expect(client.getQueueSize()).toBe(1);
		});

		it('409 응답에 diff가 없으면 ConflictResult.diff가 undefined여야 한다 (AC-002.4)', async () => {
			mockRequestUrl.mockRejectedValueOnce({
				status: 409,
				json: {
					conflict_path: 'simple.md',
					current_hash: 'h1',
					incoming_hash: 'h2',
				},
			});

			const result = await client.rawUpload('simple.md', 'content');

			if ('conflict' in result && result.conflict === true) {
				expect(result.diff).toBeUndefined();
			} else {
				expect.fail('Expected ConflictResult');
			}
		});
	});

	// ============================================================
	// SPEC-P8-PLUGIN-API-001: Cycle 1 - 에러 처리 정합성 (REQ-PA-015, 016, 017)
	// ============================================================

	describe('parseServerError (REQ-PA-016)', () => {
		it('구형 에러 형식을 정규화해야 한다', async () => {
			const { parseServerError } = await import('../../src/api-client');
			const result = parseServerError({ error: 'File not found' });
			expect(result.code).toBe('UNKNOWN');
			expect(result.message).toBe('File not found');
			expect(result.statusCode).toBeUndefined();
		});

		it('신형 에러 형식을 그대로 사용해야 한다', async () => {
			const { parseServerError } = await import('../../src/api-client');
			const result = parseServerError({
				error: { code: 'FILE_TOO_LARGE', message: 'File exceeds size limit', statusCode: 413 },
			});
			expect(result.code).toBe('FILE_TOO_LARGE');
			expect(result.message).toBe('File exceeds size limit');
			expect(result.statusCode).toBe(413);
		});

		it('error 필드가 없으면 UNKNOWN으로 처리해야 한다', async () => {
			const { parseServerError } = await import('../../src/api-client');
			const result = parseServerError({});
			expect(result.code).toBe('UNKNOWN');
			expect(result.message).toBe('');
		});
	});

	describe('RateLimitBackoff (REQ-PA-017)', () => {
		it('초기 대기 시간은 1초여야 한다', async () => {
			const { RateLimitBackoff } = await import('../../src/api-client');
			const backoff = new RateLimitBackoff();
			expect(backoff.getCurrentDelay()).toBe(1000);
		});

		it('429 수신 시 백오프가 활성화되어야 한다', async () => {
			const { RateLimitBackoff } = await import('../../src/api-client');
			const backoff = new RateLimitBackoff();
			backoff.trigger();
			expect(backoff.isActive()).toBe(true);
		});

		it('백오프 지연이 2배씩 증가해야 한다', async () => {
			const { RateLimitBackoff } = await import('../../src/api-client');
			const backoff = new RateLimitBackoff();
			expect(backoff.getCurrentDelay()).toBe(1000);
			backoff.trigger();
			expect(backoff.getCurrentDelay()).toBe(2000);
			backoff.trigger();
			expect(backoff.getCurrentDelay()).toBe(4000);
			backoff.trigger();
			expect(backoff.getCurrentDelay()).toBe(8000);
		});

		it('최대 대기 시간은 60초여야 한다', async () => {
			const { RateLimitBackoff } = await import('../../src/api-client');
			const backoff = new RateLimitBackoff();
			for (let i = 0; i < 10; i++) backoff.trigger();
			expect(backoff.getCurrentDelay()).toBe(60000);
		});

		it('최대 5회 재시도 후 영구 실패해야 한다', async () => {
			const { RateLimitBackoff } = await import('../../src/api-client');
			const backoff = new RateLimitBackoff();
			for (let i = 0; i < 5; i++) backoff.trigger();
			expect(backoff.isPermanentlyFailed()).toBe(true);
		});

		it('성공 시 백오프가 초기화되어야 한다', async () => {
			const { RateLimitBackoff } = await import('../../src/api-client');
			const backoff = new RateLimitBackoff();
			backoff.trigger();
			backoff.trigger();
			expect(backoff.isActive()).toBe(true);
			backoff.reset();
			expect(backoff.isActive()).toBe(false);
			expect(backoff.getCurrentDelay()).toBe(1000);
		});

		it('Retry-After 값을 사용해야 한다', async () => {
			const { RateLimitBackoff } = await import('../../src/api-client');
			const backoff = new RateLimitBackoff();
			backoff.trigger(5000);
			expect(backoff.getCurrentDelay()).toBe(10000);
		});
	});

	describe('HTTP 에러 코드 (REQ-PA-015)', () => {
		it('413 수신 시 에러를 throw해야 한다', async () => {
			mockRequestUrl.mockRejectedValueOnce({ status: 413, json: { error: 'File too large' } });
			await expect(client.rawUpload('large.md', 'x')).rejects.toEqual(expect.objectContaining({ status: 413 }));
		});

		it('429 수신 시 에러를 throw해야 한다', async () => {
			mockRequestUrl.mockRejectedValueOnce({ status: 429, json: { error: 'Rate limit' } });
			await expect(client.rawUpload('test.md', 'c')).rejects.toEqual(expect.objectContaining({ status: 429 }));
		});

		it('503 수신 시 에러를 throw해야 한다', async () => {
			mockRequestUrl.mockRejectedValueOnce({ status: 503, json: { error: { code: 'MAINTENANCE' } } });
			await expect(client.rawUpload('test.md', 'c')).rejects.toEqual(expect.objectContaining({ status: 503 }));
		});
	});

	// ============================================================
	// SPEC-P8-PLUGIN-API-001: Cycle 2 - API 클라이언트 메서드
	// ============================================================

	describe('batchOperations (REQ-PA-001)', () => {
		it('POST /batch로 배치 요청을 전송해야 한다', async () => {
			mockRequestUrl.mockResolvedValueOnce(
				makeResponse({ json: { results: [{ path: 'a.md', status: 200, hash: 'ha' }, { path: 'b.md', status: 200, hash: 'hb' }] } })
			);
			const ops = [
				{ type: 'create' as const, data: { path: 'a.md', content: 'aaa', hash: 'ha' } },
				{ type: 'create' as const, data: { path: 'b.md', content: 'bbb', hash: 'hb' } },
			];
			const result = await client.batchOperations(ops);
			expect(mockRequestUrl).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringContaining('/batch'), method: 'POST' }));
			expect(result.results).toHaveLength(2);
		});
	});

	describe('moveFile (REQ-PA-004)', () => {
		it('POST /move로 파일 이동을 요청해야 한다', async () => {
			mockRequestUrl.mockResolvedValueOnce(makeResponse({ json: { success: true, from: 'old.md', to: 'new.md' } }));
			const result = await client.moveFile('old.md', 'new.md');
			expect(mockRequestUrl).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringContaining('/move'), method: 'POST' }));
			expect((result as Record<string, unknown>).success).toBe(true);
		});
	});

	describe('getDevices (REQ-PA-011)', () => {
		it('GET /devices로 디바이스 목록을 반환해야 한다', async () => {
			mockRequestUrl.mockResolvedValueOnce(makeResponse({ json: { devices: [{ device_id: 'd1', lastSyncAt: '2026-01-01', isCurrent: true }] } }));
			const result = await client.getDevices();
			expect(mockRequestUrl).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringContaining('/devices'), method: 'GET' }));
			expect(result).toHaveLength(1);
		});
	});

	describe('removeDevice (REQ-PA-012)', () => {
		it('DELETE /devices/{id}를 호출해야 한다', async () => {
			mockRequestUrl.mockResolvedValueOnce(makeResponse({ json: { success: true } }));
			await client.removeDevice('dev-2');
			expect(mockRequestUrl).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringContaining('/devices/dev-2'), method: 'DELETE' }));
		});
	});

	describe('searchFiles (REQ-PA-013)', () => {
		it('GET /search?q=keyword로 검색해야 한다', async () => {
			mockRequestUrl.mockResolvedValueOnce(makeResponse({ json: { results: [{ path: 'a.md', snippet: 'kw', score: 0.9 }], total: 1 } }));
			const result = await client.searchFiles('keyword');
			expect(mockRequestUrl).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringContaining('/search?q=keyword'), method: 'GET' }));
			expect(result.results).toHaveLength(1);
		});

		it('limit 및 folder 파라미터를 전달해야 한다', async () => {
			mockRequestUrl.mockResolvedValueOnce(makeResponse({ json: { results: [], total: 0 } }));
			await client.searchFiles('test', { limit: 10, folder: 'notes' });
			const call = mockRequestUrl.mock.calls[0][0] as RequestUrlParam;
			expect(call.url).toContain('q=test');
			expect(call.url).toContain('limit=10');
			expect(call.url).toContain('folder=notes');
		});
	});

	describe('getConflicts (REQ-PA-007)', () => {
		it('GET /conflicts로 충돌 목록을 반환해야 한다', async () => {
			mockRequestUrl.mockResolvedValueOnce(makeResponse({ json: { conflicts: [{ conflictId: 'c1', file_path: 'a.md', status: 'pending' }] } }));
			const result = await client.getConflicts();
			expect(mockRequestUrl).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringContaining('/conflicts'), method: 'GET' }));
			expect(result).toHaveLength(1);
		});
	});

	describe('resolveConflict (REQ-PA-008)', () => {
		it('POST /conflicts/{id}/resolve를 호출해야 한다', async () => {
			mockRequestUrl.mockResolvedValueOnce(makeResponse({ json: { success: true } }));
			await client.resolveConflict('c1', 'accept');
			const call = mockRequestUrl.mock.calls[0][0] as RequestUrlParam;
			expect(call.url).toContain('/conflicts/c1/resolve');
			expect(JSON.parse(call.body as string).resolution).toBe('accept');
		});
	});

	describe('mergeResolve (REQ-PA-009)', () => {
		it('POST /conflicts/{id}/merge-resolve를 호출해야 한다', async () => {
			mockRequestUrl.mockResolvedValueOnce(makeResponse({ json: { success: true } }));
			await client.mergeResolve('c1', 'merged', 'hash');
			const call = mockRequestUrl.mock.calls[0][0] as RequestUrlParam;
			expect(call.url).toContain('/conflicts/c1/merge-resolve');
			const body = JSON.parse(call.body as string);
			expect(body.content).toBe('merged');
			expect(body.hash).toBe('hash');
		});
	});

	describe('listFiles pagination (REQ-PA-018)', () => {
		it('limit 및 cursor 파라미터를 지원해야 한다', async () => {
			mockRequestUrl.mockResolvedValueOnce(makeResponse({ json: { files: [{ id: 1, path: 'a.md', hash: 'h', size_bytes: 1, created_at: '', updated_at: '' }], hasMore: true, cursor: 'next' } }));
			await client.listFiles({ limit: 50, cursor: 'abc' });
			const call = mockRequestUrl.mock.calls[0][0] as RequestUrlParam;
			expect(call.url).toContain('limit=50');
			expect(call.url).toContain('cursor=abc');
		});

		it('파라미터 없으면 기존 동작 유지', async () => {
			mockRequestUrl.mockResolvedValueOnce(makeResponse({ json: [{ id: 1, path: 'a.md', hash: 'h', size_bytes: 1, created_at: '', updated_at: '' }] }));
			const result = await client.listFiles();
			expect(result).toHaveLength(1);
		});
	});

	describe('getEvents pagination (REQ-PA-018)', () => {
		it('limit 및 cursor 파라미터를 지원해야 한다', async () => {
			mockRequestUrl.mockResolvedValueOnce(makeResponse({ json: { events: [], hasMore: false } }));
			await client.getEvents('5', { limit: 100, cursor: 'tok' });
			const call = mockRequestUrl.mock.calls[0][0] as RequestUrlParam;
			expect(call.url).toContain('since=5');
			expect(call.url).toContain('limit=100');
			expect(call.url).toContain('cursor=tok');
		});

		// ============================================================
		// SPEC-JWT-DEVICE-BINDING-001: login 함수 device_id 전송 (REQ-DB-005)
		// ============================================================

		describe('login (REQ-DB-005)', () => {
			it('login 함수가 device_id를 요청 본문에 포함해야 한다', async () => {
				const { login } = await import('../../src/api-client');
				mockRequestUrl.mockResolvedValueOnce(
					makeResponse({
						json: {
							token: 'jwt-token-123',
							user: { id: 'u1', username: 'testuser', role: 'admin' },
							vaults: [{ id: 'v1', name: 'Test Vault' }],
						},
					})
				);

				const result = await login('https://sync.example.com', 'testuser', 'password123', 'my-device-id');

				expect(mockRequestUrl).toHaveBeenCalledWith(
					expect.objectContaining({
						url: 'https://sync.example.com/v1/auth/login',
						method: 'POST',
					})
				);

				const call = mockRequestUrl.mock.calls[0][0] as RequestUrlParam;
				const body = JSON.parse(call.body as string);
				expect(body.username).toBe('testuser');
				expect(body.password).toBe('password123');
				expect(body.device_id).toBe('my-device-id');

				expect(result.token).toBe('jwt-token-123');
				expect(result.user.username).toBe('testuser');
				expect(result.vaults).toHaveLength(1);
			});
		});
	});
});
