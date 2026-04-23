// @MX:NOTE 동기화 관련 DTO 변환 함수

import type { ServiceSyncEvent, ServiceSyncStatusResponse, ServiceSyncStatusRequest } from "./types.js";

// ─── Outbound: 서비스 → Wire ─────────────────────────────────

export function toWireSyncEvent(event: ServiceSyncEvent) {
  const wire: Record<string, unknown> = {
    id: event.id,
    event_type: event.eventType,
    file_path: event.filePath,
    device_id: event.deviceId,
    created_at: event.createdAt instanceof Date ? event.createdAt.toISOString() : String(event.createdAt),
  };
  if (event.fileType !== undefined) {
    wire.file_type = event.fileType;
  }
  if (event.sequence !== undefined) {
    wire.sequence = event.sequence;
  }
  return wire;
}

export function toWireSyncStatusResponse(response: ServiceSyncStatusResponse) {
  return {
    device_id: response.deviceId,
    vault_id: response.vaultId,
    last_event_id: response.lastEventId,
    last_sync_at: response.lastSyncAt instanceof Date ? response.lastSyncAt.toISOString() : String(response.lastSyncAt),
  };
}

// ─── Inbound: Wire → 서비스 ─────────────────────────────────

export function fromWireSyncStatusRequest(wire: Record<string, unknown>): ServiceSyncStatusRequest {
  return {
    deviceId: wire.device_id as string,
    lastEventId: wire.last_event_id as string,
  };
}
