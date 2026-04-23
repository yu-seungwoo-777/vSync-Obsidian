// @MX:NOTE DTO 변환 계층 타입 정의
// 서비스 계층(camelCase) ↔ API wire format(snake_case) 변환에 사용되는 타입

// ─── 서비스 계층 타입 (camelCase) ─────────────────────────────────

export interface ServiceUploadResult {
  id: string;
  path: string;
  hash: string;
  sizeBytes: number | null;
  version: number;
  autoMerged?: boolean;
  mergeType?: "normal" | "auto";
}

export interface ServiceFileInfo {
  id: string;
  path: string;
  hash: string;
  sizeBytes: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ServiceFileDetail {
  id: string;
  path: string;
  hash: string;
  sizeBytes: number | null;
  content: string | null;
  fileType?: "markdown" | "attachment";
  version: number;
}

export interface ServiceFolderEntry {
  name: string;
  path: string;
  type: "file" | "folder";
  hash?: string;
  sizeBytes?: number | null;
  updatedAt?: Date;
}

export interface ServiceSyncEvent {
  id: string;
  eventType: string;
  filePath: string | null;
  fileType?: string | null;
  deviceId: string;
  sequence?: number | null;
  createdAt: Date;
}

export interface ServiceConflictInfo {
  id: string;
  originalPath: string | null;
  conflictPath: string;
  createdAt: Date;
}

export interface ServiceConflictResolveResponse {
  resolution: string;
  conflictId: string;
  resolvedAt: string;
}

export interface ServiceSyncStatusResponse {
  deviceId: string;
  vaultId: string;
  lastEventId: string;
  lastSyncAt: Date;
}

export interface ServiceFileVersion {
  versionNum: number;
  contentHash: string;
  storageKey: string;
  createdAt: Date;
}

export interface ServiceEditResponse {
  id: string;
  path: string;
  version: number;
  hash: string;
  changes: number;
}

// ─── 인바운드 서비스 타입 (camelCase) ─────────────────────────────────

export interface ServiceFileUploadRequest {
  path: string;
  content?: string;
  hash: string;
  baseHash?: string;
}

export interface ServiceSyncStatusRequest {
  deviceId: string;
  lastEventId: string;
}
