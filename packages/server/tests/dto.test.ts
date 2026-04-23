import { describe, it, expect } from "vitest";
import {
  toWireUploadResult,
  toWireFileInfo,
  toWireFileDetail,
  toWireFolderEntry,
  toWireSyncEvent,
  toWireConflictInfo,
  toWireConflictResolveResponse,
  toWireSyncStatusResponse,
  toWireFileVersion,
  toWireEditResponse,
  fromWireFileUploadRequest,
  fromWireSyncStatusRequest,
} from "../src/dto/index.js";

// ─── UploadResult 변환 ─────────────────────────────────

describe("toWireUploadResult", () => {
  it("camelCase 서비스 결과를 snake_case wire format으로 변환한다", () => {
    const serviceResult = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      path: "notes/test.md",
      hash: "abc123",
      sizeBytes: 1024,
      version: 3,
    };

    const wire = toWireUploadResult(serviceResult);

    expect(wire).toEqual({
      id: "550e8400-e29b-41d4-a716-446655440000",
      path: "notes/test.md",
      hash: "abc123",
      size_bytes: 1024,
      version: 3,
    });
  });

  it("auto_merged와 merge_type 필드를 포함한다", () => {
    const serviceResult = {
      id: "uuid-1",
      path: "test.md",
      hash: "hash1",
      sizeBytes: null,
      version: 2,
      autoMerged: true,
      mergeType: "auto" as const,
    };

    const wire = toWireUploadResult(serviceResult);

    expect(wire.auto_merged).toBe(true);
    expect(wire.merge_type).toBe("auto");
  });

  it("auto_merged와 merge_type이 없으면 필드를 생략한다", () => {
    const serviceResult = {
      id: "uuid-1",
      path: "test.md",
      hash: "hash1",
      sizeBytes: null,
      version: 2,
    };

    const wire = toWireUploadResult(serviceResult);

    expect(wire).not.toHaveProperty("auto_merged");
    expect(wire).not.toHaveProperty("merge_type");
  });
});

// ─── FileInfo 변환 ─────────────────────────────────

describe("toWireFileInfo", () => {
  it("camelCase FileInfo를 snake_case wire format으로 변환한다", () => {
    const serviceResult = {
      id: "uuid-1",
      path: "notes/hello.md",
      hash: "sha256hash",
      sizeBytes: 512,
      createdAt: new Date("2025-01-15T10:30:00Z"),
      updatedAt: new Date("2025-01-16T12:00:00Z"),
    };

    const wire = toWireFileInfo(serviceResult);

    expect(wire).toEqual({
      id: "uuid-1",
      path: "notes/hello.md",
      hash: "sha256hash",
      size_bytes: 512,
      created_at: "2025-01-15T10:30:00.000Z",
      updated_at: "2025-01-16T12:00:00.000Z",
    });
  });

  it("sizeBytes가 null이면 size_bytes도 null이다", () => {
    const serviceResult = {
      id: "uuid-1",
      path: "test.md",
      hash: "hash",
      sizeBytes: null as number | null,
      createdAt: new Date("2025-01-01T00:00:00Z"),
      updatedAt: new Date("2025-01-01T00:00:00Z"),
    };

    const wire = toWireFileInfo(serviceResult);

    expect(wire.size_bytes).toBeNull();
  });
});

// ─── FileDetail 변환 ─────────────────────────────────

describe("toWireFileDetail", () => {
  it("camelCase FileDetail을 snake_case wire format으로 변환한다", () => {
    const serviceResult = {
      id: "uuid-1",
      path: "doc.md",
      hash: "hash1",
      sizeBytes: 256,
      content: "# Hello",
      fileType: "markdown" as const,
      version: 1,
    };

    const wire = toWireFileDetail(serviceResult);

    expect(wire).toEqual({
      id: "uuid-1",
      path: "doc.md",
      hash: "hash1",
      size_bytes: 256,
      content: "# Hello",
      file_type: "markdown",
      version: 1,
    });
  });

  it("fileType이 없으면 file_type을 생략한다", () => {
    const serviceResult = {
      id: "uuid-1",
      path: "doc.md",
      hash: "hash1",
      sizeBytes: 256,
      content: null,
      version: 1,
    };

    const wire = toWireFileDetail(serviceResult);

    expect(wire).not.toHaveProperty("file_type");
  });
});

// ─── FolderEntry 변환 ─────────────────────────────────

describe("toWireFolderEntry", () => {
  it("camelCase FolderEntry를 snake_case wire format으로 변환한다", () => {
    const serviceResult = {
      name: "hello.md",
      path: "notes/hello.md",
      type: "file" as const,
      hash: "abc",
      sizeBytes: 100,
      updatedAt: new Date("2025-01-01T00:00:00Z"),
    };

    const wire = toWireFolderEntry(serviceResult);

    expect(wire).toEqual({
      name: "hello.md",
      path: "notes/hello.md",
      type: "file",
      hash: "abc",
      size_bytes: 100,
      updated_at: "2025-01-01T00:00:00.000Z",
    });
  });

  it("선택 필드가 없으면 생략한다", () => {
    const serviceResult = {
      name: "notes",
      path: "notes",
      type: "folder" as const,
    };

    const wire = toWireFolderEntry(serviceResult);

    expect(wire).not.toHaveProperty("hash");
    expect(wire).not.toHaveProperty("size_bytes");
    expect(wire).not.toHaveProperty("updated_at");
  });
});

// ─── SyncEvent 변환 ─────────────────────────────────

describe("toWireSyncEvent", () => {
  it("camelCase SyncEvent를 snake_case wire format으로 변환한다", () => {
    const serviceResult = {
      id: "uuid-event",
      eventType: "updated",
      filePath: "notes/test.md",
      fileType: "markdown",
      deviceId: "device-1",
      sequence: 42,
      createdAt: new Date("2025-01-20T15:00:00Z"),
    };

    const wire = toWireSyncEvent(serviceResult);

    expect(wire).toEqual({
      id: "uuid-event",
      event_type: "updated",
      file_path: "notes/test.md",
      file_type: "markdown",
      device_id: "device-1",
      sequence: 42,
      created_at: "2025-01-20T15:00:00.000Z",
    });
  });

  it("filePath가 null이면 null로 유지한다", () => {
    const serviceResult = {
      id: "uuid-event",
      eventType: "deleted",
      filePath: null,
      fileType: null,
      deviceId: "device-1",
      createdAt: new Date("2025-01-20T15:00:00Z"),
    };

    const wire = toWireSyncEvent(serviceResult);

    expect(wire.file_path).toBeNull();
  });
});

// ─── ConflictInfo 변환 ─────────────────────────────────

describe("toWireConflictInfo", () => {
  it("camelCase ConflictInfo를 snake_case wire format으로 변환한다", () => {
    const serviceResult = {
      id: "uuid-conflict",
      originalPath: "notes/test.md",
      conflictPath: "notes/test.sync-conflict-20250101120000.md",
      createdAt: new Date("2025-01-01T12:00:00Z"),
    };

    const wire = toWireConflictInfo(serviceResult);

    expect(wire).toEqual({
      id: "uuid-conflict",
      original_path: "notes/test.md",
      conflict_path: "notes/test.sync-conflict-20250101120000.md",
      created_at: "2025-01-01T12:00:00.000Z",
    });
  });

  it("originalPath가 null이면 undefined로 처리한다", () => {
    const serviceResult = {
      id: "uuid-conflict",
      originalPath: null,
      conflictPath: "notes/copy.md",
      createdAt: new Date("2025-01-01T00:00:00Z"),
    };

    const wire = toWireConflictInfo(serviceResult);

    expect(wire.original_path).toBeUndefined();
  });
});

// ─── ConflictResolveResponse 변환 ─────────────────────────────────

describe("toWireConflictResolveResponse", () => {
  it("camelCase 응답을 snake_case wire format으로 변환한다", () => {
    const wire = toWireConflictResolveResponse({
      resolution: "accept",
      conflictId: "uuid-conflict",
      resolvedAt: "2025-01-01T12:00:00.000Z",
    });

    expect(wire).toEqual({
      resolution: "accept",
      conflict_id: "uuid-conflict",
      resolved_at: "2025-01-01T12:00:00.000Z",
    });
  });
});

// ─── SyncStatusResponse 변환 ─────────────────────────────────

describe("toWireSyncStatusResponse", () => {
  it("camelCase 응답을 snake_case wire format으로 변환한다", () => {
    const serviceResult = {
      deviceId: "device-1",
      vaultId: "uuid-vault",
      lastEventId: "uuid-event",
      lastSyncAt: new Date("2025-01-01T12:00:00Z"),
    };

    const wire = toWireSyncStatusResponse(serviceResult);

    expect(wire).toEqual({
      device_id: "device-1",
      vault_id: "uuid-vault",
      last_event_id: "uuid-event",
      last_sync_at: "2025-01-01T12:00:00.000Z",
    });
  });
});

// ─── FileVersion 변환 ─────────────────────────────────

describe("toWireFileVersion", () => {
  it("camelCase FileVersion을 snake_case wire format으로 변환한다", () => {
    const serviceResult = {
      versionNum: 3,
      contentHash: "hash3",
      storageKey: "vault/file/3",
      createdAt: new Date("2025-01-01T00:00:00Z"),
    };

    const wire = toWireFileVersion(serviceResult);

    expect(wire).toEqual({
      version_num: 3,
      content_hash: "hash3",
      storage_key: "vault/file/3",
      created_at: "2025-01-01T00:00:00.000Z",
    });
  });
});

// ─── EditResponse 변환 ─────────────────────────────────

describe("toWireEditResponse", () => {
  it("camelCase EditResponse를 wire format으로 변환한다", () => {
    const wire = toWireEditResponse({
      id: "uuid-1",
      path: "test.md",
      version: 2,
      hash: "hash2",
      changes: 3,
    });

    // EditResponse는 wire format에서도 camelCase가 아닌 필드가 없으므로 그대로 전달
    expect(wire).toEqual({
      id: "uuid-1",
      path: "test.md",
      version: 2,
      hash: "hash2",
      changes: 3,
    });
  });
});

// ─── Inbound 변환 (wire → service) ─────────────────────────────────

describe("fromWireFileUploadRequest", () => {
  it("snake_case wire request를 camelCase 서비스 형식으로 변환한다", () => {
    const wireRequest = {
      path: "notes/test.md",
      content: "# Hello",
      hash: "sha256hash",
      base_hash: "base123",
    };

    const service = fromWireFileUploadRequest(wireRequest);

    expect(service).toEqual({
      path: "notes/test.md",
      content: "# Hello",
      hash: "sha256hash",
      baseHash: "base123",
    });
  });

  it("base_hash가 없으면 baseHash를 생략한다", () => {
    const wireRequest = {
      path: "test.md",
      hash: "hash",
    };

    const service = fromWireFileUploadRequest(wireRequest);

    expect(service).not.toHaveProperty("baseHash");
  });
});

describe("fromWireSyncStatusRequest", () => {
  it("snake_case wire request를 camelCase로 변환한다", () => {
    const wireRequest = {
      device_id: "device-1",
      last_event_id: "uuid-event",
    };

    const service = fromWireSyncStatusRequest(wireRequest);

    expect(service).toEqual({
      deviceId: "device-1",
      lastEventId: "uuid-event",
    });
  });
});
