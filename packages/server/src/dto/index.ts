// @MX:NOTE DTO 변환 계층 통합 내보내기
// 서비스 계층(camelCase) ↔ API wire format(snake_case) 변환

// 타입
export type {
  ServiceUploadResult,
  ServiceFileInfo,
  ServiceFileDetail,
  ServiceFolderEntry,
  ServiceSyncEvent,
  ServiceConflictInfo,
  ServiceConflictResolveResponse,
  ServiceSyncStatusResponse,
  ServiceFileVersion,
  ServiceEditResponse,
  ServiceFileUploadRequest,
  ServiceSyncStatusRequest,
} from "./types.js";

// 파일 관련
export {
  toWireUploadResult,
  toWireFileInfo,
  toWireFileDetail,
  toWireFolderEntry,
  toWireFileVersion,
  toWireEditResponse,
  fromWireFileUploadRequest,
} from "./file.dto.js";

// 동기화 관련
export {
  toWireSyncEvent,
  toWireSyncStatusResponse,
  fromWireSyncStatusRequest,
} from "./sync.dto.js";

// 볼트 관련
export {
  toWireVaultCreateResponse,
} from "./vault.dto.js";

// 충돌 관련
export {
  toWireConflictInfo,
  toWireConflictResolveResponse,
} from "./conflict.dto.js";
