// 서비스 계층(camelCase) → API 응답(wire format snake_case) 직렬화 경계
// OpenAPI 명세의 필드 네이밍 규칙과 일치하도록 변환
// @MX:NOTE 이 파일은 DTO 계층(src/dto)으로 대체됨
// 하위 호환을 위해 기존 serialize 함수를 유지하며, 내부적으로 DTO 사용

import type { components } from "../types/api-types.js";
import type { ServiceFileInfo, ServiceFileDetail, ServiceFolderEntry } from "../dto/types.js";
import {
  toWireUploadResult,
  toWireFileInfo,
  toWireFileDetail,
  toWireFolderEntry,
} from "../dto/index.js";

// Wire format 타입 별칭
export type WireUploadResult = components["schemas"]["UploadResult"];
export type WireFileInfo = components["schemas"]["FileInfo"];
export type WireFileDetail = components["schemas"]["FileDetail"];
export type WireFolderEntry = components["schemas"]["FolderEntry"];

// 서비스 계층 UploadResult 타입 (camelCase, DB select 결과)
interface InternalUploadResult {
  id: string;
  path: string;
  hash: string;
  sizeBytes: number | null;
  version: number;
  autoMerged?: boolean;
  mergeType?: "normal" | "auto";
}

// 서비스 계층 FileInfo 타입 (camelCase, DB select 결과)
interface InternalFileInfo {
  id: string;
  path: string;
  hash: string;
  sizeBytes: number | null;
  createdAt: Date;
  updatedAt: Date;
}

// 서비스 계층 FileDetail 타입 (camelCase, get_file 결과)
interface InternalFileDetail {
  id: string;
  path: string;
  hash: string;
  sizeBytes: number | null;
  content: string | null;
  fileType?: "markdown" | "attachment";
  version: number;
}

// 서비스 계층 FolderEntry 타입 (camelCase, list_folder 결과)
interface InternalFolderEntry {
  name: string;
  path: string;
  type: "file" | "folder";
  hash?: string;
  sizeBytes?: number | null;
  updatedAt?: Date;
}

export function serializeUploadResult(result: InternalUploadResult): WireUploadResult {
  return toWireUploadResult(result) as WireUploadResult;
}

export function serializeFileInfo(file: InternalFileInfo): WireFileInfo {
  return toWireFileInfo(file as ServiceFileInfo) as WireFileInfo;
}

export function serializeFileDetail(detail: InternalFileDetail): WireFileDetail {
  return toWireFileDetail(detail as ServiceFileDetail) as WireFileDetail;
}

export function serializeFolderEntry(entry: InternalFolderEntry): WireFolderEntry {
  return toWireFolderEntry(entry as ServiceFolderEntry) as WireFolderEntry;
}
