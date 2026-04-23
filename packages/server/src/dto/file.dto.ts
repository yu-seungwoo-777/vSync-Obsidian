// @MX:NOTE 파일 관련 DTO 변환 함수
// 서비스 계층(camelCase) → API wire format(snake_case) 변환

import type { ServiceUploadResult, ServiceFileInfo, ServiceFileDetail, ServiceFolderEntry, ServiceFileVersion, ServiceEditResponse, ServiceFileUploadRequest } from "./types.js";

// ─── Outbound: 서비스 → Wire ─────────────────────────────────

export function toWireUploadResult(result: ServiceUploadResult) {
  const wire: Record<string, unknown> = {
    id: result.id,
    path: result.path,
    hash: result.hash,
    size_bytes: result.sizeBytes,
    version: result.version,
  };
  if (result.autoMerged !== undefined) {
    wire.auto_merged = result.autoMerged;
  }
  if (result.mergeType !== undefined) {
    wire.merge_type = result.mergeType;
  }
  return wire;
}

export function toWireFileInfo(file: ServiceFileInfo) {
  return {
    id: file.id,
    path: file.path,
    hash: file.hash,
    size_bytes: file.sizeBytes,
    created_at: file.createdAt instanceof Date ? file.createdAt.toISOString() : String(file.createdAt),
    updated_at: file.updatedAt instanceof Date ? file.updatedAt.toISOString() : String(file.updatedAt),
  };
}

export function toWireFileDetail(detail: ServiceFileDetail) {
  return {
    id: detail.id,
    path: detail.path,
    hash: detail.hash,
    size_bytes: detail.sizeBytes,
    content: detail.content,
    ...(detail.fileType && { file_type: detail.fileType }),
    version: detail.version,
  };
}

export function toWireFolderEntry(entry: ServiceFolderEntry) {
  return {
    name: entry.name,
    path: entry.path,
    type: entry.type,
    ...(entry.hash && { hash: entry.hash }),
    ...(entry.sizeBytes !== undefined && { size_bytes: entry.sizeBytes }),
    ...(entry.updatedAt && { updated_at: entry.updatedAt instanceof Date ? entry.updatedAt.toISOString() : String(entry.updatedAt) }),
  };
}

export function toWireFileVersion(version: ServiceFileVersion) {
  return {
    version_num: version.versionNum,
    content_hash: version.contentHash,
    storage_key: version.storageKey,
    created_at: version.createdAt instanceof Date ? version.createdAt.toISOString() : String(version.createdAt),
  };
}

export function toWireEditResponse(response: ServiceEditResponse) {
  return {
    id: response.id,
    path: response.path,
    version: response.version,
    hash: response.hash,
    changes: response.changes,
  };
}

// ─── Inbound: Wire → 서비스 ─────────────────────────────────

export function fromWireFileUploadRequest(wire: Record<string, unknown>): ServiceFileUploadRequest {
  const result: ServiceFileUploadRequest = {
    path: wire.path as string,
    hash: wire.hash as string,
  };
  if (wire.content !== undefined) {
    result.content = wire.content as string;
  }
  if (wire.base_hash !== undefined) {
    result.baseHash = wire.base_hash as string;
  }
  return result;
}
