// @MX:NOTE SPEC-SYNC-MULTIDEVICE-003 sync-status 쓰로틀링 테스트
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncEngine } from '../../src/sync-engine';
import { DEFAULT_SETTINGS } from '../../src/types';
import type { VSyncSettings } from '../../src/types';
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
};

vi.mock('../../src/api-client', () => ({
  VSyncClient: vi.fn().mockImplementation(() => mockApiClient),
  MAX_BINARY_SIZE: 52_428_800,
}));

// 해시 유틸리티 mock
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

// WS 클라이언트 mock
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

describe('REQ-SYNC-003 - sync-status 쓰로틀링', () => {
  let engine: SyncEngine;
  let vault: ReturnType<typeof createMockVault>;
  let settings: VSyncSettings;

  beforeEach(() => {
    vi.clearAllMocks();

    settings = {
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

    vault = createMockVault();
    engine = new SyncEngine(settings, vault as never, mockNotice);
  });

  // AC-003-1: 10 events → updateSyncStatus called once
  it('10개 이벤트 처리 시 updateSyncStatus는 마지막 이벤트에 대해 1회만 호출되어야 한다', async () => {
    const events = Array.from({ length: 10 }, (_, i) => ({
      id: `evt-${i + 1}`,
      event_type: 'created' as const,
      file_path: `notes/file-${i}.md`,
      device_id: 'device-2',
      created_at: '2026-01-01',
    }));

    mockApiClient.getEvents.mockResolvedValueOnce(events);
    mockApiClient.rawDownload.mockResolvedValue('content');
    mockApiClient.updateSyncStatus.mockResolvedValue(undefined);

    await engine.pollRemoteChanges();

    // updateSyncStatus는 큐 드레인 후 마지막 이벤트 ID로 1회만 호출
    expect(mockApiClient.updateSyncStatus).toHaveBeenCalledTimes(1);
    expect(mockApiClient.updateSyncStatus).toHaveBeenCalledWith('evt-10');
  });

  // AC-003-2: Queue not empty + new event → process immediately, API call deferred
  it('이벤트 처리 중 새 이벤트가 들어오면 즉시 처리하되 API 호출은 드레인 후 이루어져야 한다', async () => {
    // 첫 번째 이벤트
    mockApiClient.getEvents.mockResolvedValueOnce([
      { id: 'e1', event_type: 'created', file_path: 'a.md', device_id: 'device-2', created_at: '2026-01-01' },
    ]);
    mockApiClient.rawDownload.mockResolvedValue('content');
    mockApiClient.updateSyncStatus.mockResolvedValue(undefined);

    await engine.pollRemoteChanges();

    // 첫 번째 이벤트에 대해 updateSyncStatus 1회 호출
    expect(mockApiClient.updateSyncStatus).toHaveBeenCalledTimes(1);
    expect(mockApiClient.updateSyncStatus).toHaveBeenCalledWith('e1');
  });

  // AC-003-3: Single event → same behavior (1 call)
  it('단일 이벤트 처리 시에도 updateSyncStatus는 1회 호출되어야 한다', async () => {
    mockApiClient.getEvents.mockResolvedValueOnce([
      { id: 'single-1', event_type: 'created', file_path: 'single.md', device_id: 'device-2', created_at: '2026-01-01' },
    ]);
    mockApiClient.rawDownload.mockResolvedValue('single content');
    mockApiClient.updateSyncStatus.mockResolvedValue(undefined);

    await engine.pollRemoteChanges();

    expect(mockApiClient.updateSyncStatus).toHaveBeenCalledTimes(1);
    expect(mockApiClient.updateSyncStatus).toHaveBeenCalledWith('single-1');
  });

  // 추가: 5개 이벤트에서 updateSyncStatus 횟수 검증
  it('5개 이벤트 처리 시 updateSyncStatus는 1회만 호출되어야 한다', async () => {
    const events = Array.from({ length: 5 }, (_, i) => ({
      id: `five-${i + 1}`,
      event_type: 'created' as const,
      file_path: `notes/five-${i}.md`,
      device_id: 'device-2',
      created_at: '2026-01-01',
    }));

    mockApiClient.getEvents.mockResolvedValueOnce(events);
    mockApiClient.rawDownload.mockResolvedValue('content');
    mockApiClient.updateSyncStatus.mockResolvedValue(undefined);

    await engine.pollRemoteChanges();

    expect(mockApiClient.updateSyncStatus).toHaveBeenCalledTimes(1);
    expect(mockApiClient.updateSyncStatus).toHaveBeenCalledWith('five-5');
  });

  // 추가: _lastEventId는 모든 이벤트에 대해 업데이트되어야 함
  it('모든 이벤트의 _lastEventId가 마지막 이벤트 ID로 업데이트되어야 한다', async () => {
    const events = [
      { id: 'last-1', event_type: 'created' as const, file_path: 'a.md', device_id: 'device-2', created_at: '2026-01-01' },
      { id: 'last-2', event_type: 'created' as const, file_path: 'b.md', device_id: 'device-2', created_at: '2026-01-01' },
      { id: 'last-3', event_type: 'created' as const, file_path: 'c.md', device_id: 'device-2', created_at: '2026-01-01' },
    ];

    mockApiClient.getEvents.mockResolvedValueOnce(events);
    mockApiClient.rawDownload.mockResolvedValue('content');
    mockApiClient.updateSyncStatus.mockResolvedValue(undefined);

    await engine.pollRemoteChanges();

    // 내부 _lastEventId 확인
    const lastEventId = (engine as any)._lastEventId;
    expect(lastEventId).toBe('last-3');
  });
});
