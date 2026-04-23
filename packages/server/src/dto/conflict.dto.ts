// @MX:NOTE 충돌 관련 DTO 변환 함수

import type { ServiceConflictInfo, ServiceConflictResolveResponse } from "./types.js";

// ─── Outbound: 서비스 → Wire ─────────────────────────────────

export function toWireConflictInfo(conflict: ServiceConflictInfo) {
  const wire: Record<string, unknown> = {
    id: conflict.id,
    conflict_path: conflict.conflictPath,
    created_at: conflict.createdAt instanceof Date ? conflict.createdAt.toISOString() : String(conflict.createdAt),
  };
  if (conflict.originalPath != null) {
    wire.original_path = conflict.originalPath;
  }
  return wire;
}

export function toWireConflictResolveResponse(response: ServiceConflictResolveResponse) {
  return {
    resolution: response.resolution,
    conflict_id: response.conflictId,
    resolved_at: response.resolvedAt,
  };
}
