import { eq, and, gt, asc } from "drizzle-orm";
import { syncEvents, deviceSyncState, files } from "../db/schemas/index.js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "../db/schemas/index.js";
import type Sql from "postgres";

type DbType = PostgresJsDatabase<typeof schema>;

// @MX:NOTE 글로벌 NOTIFY 클라이언트: 서버 시작 시 설정, createSyncEvent에서 자동 사용
let notifyClient: Sql.Sql | null = null;

/** 글로벌 NOTIFY 클라이언트 설정 (app.ts 서버 시작 시 호출) */
export function setNotifyClient(client: Sql.Sql | null): void {
  notifyClient = client;
}

/** 현재 NOTIFY 클라이언트 반환 */
export function getNotifyClient(): Sql.Sql | null {
  return notifyClient;
}

// @MX:NOTE NOTIFY 페이로드 빌드: 이벤트 정보를 JSON으로 직렬화
function buildNotifyPayload(
  eventId: string,
  eventType: string,
  filePath: string | null,
  fileType: string | null,
  deviceId: string,
  timestamp: Date,
): string {
  return JSON.stringify({
    event_id: eventId,
    event_type: eventType,
    file_path: filePath ?? "",
    file_type: fileType ?? "",
    device_id: deviceId,
    timestamp: timestamp.toISOString(),
  });
}

// @MX:NOTE 동기화 이벤트 생성: 파일 변경 시 이벤트 로그 기록 + NOTIFY 발행
export async function createSyncEvent(
  db: DbType,
  vaultId: string,
  fileId: string,
  eventType: string,
  deviceId: string,
  fromPath?: string,
) {
  const result = await db
    .insert(syncEvents)
    .values({
      vaultId,
      fileId,
      eventType,
      deviceId,
      fromPath,
    })
    .returning();

  const event = result[0];

  // NOTIFY 발행 (글로벌 클라이언트가 설정된 경우 자동)
  if (notifyClient) {
    try {
      // 파일 정보 조회 (path, fileType)
      const fileRows = await db
        .select({ path: files.path, fileType: files.fileType })
        .from(files)
        .where(eq(files.id, fileId))
        .limit(1);

      const fileInfo = fileRows[0];
      const payload = buildNotifyPayload(
        event.id,
        eventType,
        fileInfo?.path ?? null,
        fileInfo?.fileType ?? null,
        deviceId,
        event.createdAt,
      );

      const channel = `vault_sync_${vaultId}`;
      await notifyClient.notify(channel, payload);
    } catch (error) {
      // NOTIFY 실패는 이벤트 생성에 영향을 주지 않음 (fire-and-forget)
      console.error("[NOTIFY] Failed to send notification:", error);
    }
  }

  return event;
}

// @MX:NOTE 이벤트 폴링: since 이후 이벤트를 files 조인으로 경로 추출
export async function getEventsSince(
  db: DbType,
  vaultId: string,
  sinceEventId?: string,
  limit: number = 100,
) {
  // 공통 select 컬럼 정의
  const eventColumns = {
    id: syncEvents.id,
    event_type: syncEvents.eventType,
    file_path: files.path,
    file_type: files.fileType,
    device_id: syncEvents.deviceId,
    // @MX:NOTE from_path: moved 이벤트의 원본 경로
    from_path: syncEvents.fromPath,
    // @MX:NOTE sequence: 동일 타임스탬프 이벤트 구분 (REQ-EVT-003)
    sequence: syncEvents.sequence,
    created_at: syncEvents.createdAt,
  };

  if (sinceEventId) {
    const sinceEvent = await db
      .select({ created_at: syncEvents.createdAt, sequence: syncEvents.sequence })
      .from(syncEvents)
      .where(eq(syncEvents.id, sinceEventId))
      .limit(1);

    if (sinceEvent.length === 0) {
      return [];
    }

    // sequence 기반 쿼리 (REQ-EVT-003): 같은 타임스탬프 이벤트도 누락 없이 조회
    if (sinceEvent[0].sequence != null) {
      return db
        .select(eventColumns)
        .from(syncEvents)
        .leftJoin(files, eq(syncEvents.fileId, files.id))
        .where(
          and(
            eq(syncEvents.vaultId, vaultId),
            gt(syncEvents.sequence, sinceEvent[0].sequence),
          ),
        )
        .orderBy(asc(syncEvents.sequence))
        .limit(limit);
    }

    // 하위 호환: sequence가 없으면 timestamp 기반
    return db
      .select(eventColumns)
      .from(syncEvents)
      .leftJoin(files, eq(syncEvents.fileId, files.id))
      .where(
        and(
          eq(syncEvents.vaultId, vaultId),
          gt(syncEvents.createdAt, sinceEvent[0].created_at),
        ),
      )
      .orderBy(asc(syncEvents.createdAt))
      .limit(limit);
  }

  return db
    .select(eventColumns)
    .from(syncEvents)
    .leftJoin(files, eq(syncEvents.fileId, files.id))
    .where(eq(syncEvents.vaultId, vaultId))
    .orderBy(asc(syncEvents.createdAt))
    .limit(limit);
}

// @MX:NOTE 디바이스 동기화 상태 upsert: 마지막 동기화 커서 업데이트
export async function updateDeviceSyncState(
  db: DbType,
  deviceId: string,
  vaultId: string,
  lastEventId: string,
) {
  // 기존 상태 조회
  const existing = await db
    .select()
    .from(deviceSyncState)
    .where(
      and(
        eq(deviceSyncState.deviceId, deviceId),
        eq(deviceSyncState.vaultId, vaultId),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    const updated = await db
      .update(deviceSyncState)
      .set({
        lastEventId,
        lastSyncAt: new Date(),
      })
      .where(
        and(
          eq(deviceSyncState.deviceId, deviceId),
          eq(deviceSyncState.vaultId, vaultId),
        ),
      )
      .returning();

    return updated[0];
  }

  const result = await db
    .insert(deviceSyncState)
    .values({
      deviceId,
      vaultId,
      lastEventId,
    })
    .returning();

  return result[0];
}
