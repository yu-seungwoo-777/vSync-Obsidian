import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";
import { createDbClient } from "../src/config/database.js";
import { eq, and } from "drizzle-orm";
import { files, deviceSyncState } from "../src/db/schemas/index.js";
import {
  createSyncEvent,
  getEventsSince,
  updateDeviceSyncState,
} from "../src/services/sync-event.js";
import { createTestVault } from "./setup.js";
import { setupTestAuth, authHeaders, cleanupTestAuth } from "./helpers/jwt-auth.js";

describe("Sync Event Service", () => {
  let app: FastifyInstance;
  let vault_id: string;
  let jwt_token: string;
  const { client, db } = createDbClient();

  beforeAll(async () => {
    app = await buildApp();

    // JWT 토큰 획득
    jwt_token = await setupTestAuth(app);

    // 테스트용 볼트 생성
    const vault = await createTestVault(app, "sync-event-test-vault");
    vault_id = vault.vault_id;
    
  });

  afterAll(async () => {
    await app.close();
    await client.end();
  });

  const auth_headers = () => authHeaders(jwt_token);

  describe("createSyncEvent", () => {
    it("파일 생성 이벤트를 sync_events에 기록한다", async () => {
      // 파일 업로드
      const file_res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers(),
        payload: {
          path: "notes/sync-test.md",
          content: "# Sync Test",
          hash: "synctest123",
        },
      });

      const file_body = file_res.json();
      const file_id = file_body.id;

      // 이벤트 생성
      const event = await createSyncEvent(
        db,
        vault_id,
        file_id,
        "created",
        "device-test-1",
      );

      expect(event).toBeDefined();
      expect(event.vaultId).toBe(vault_id);
      expect(event.fileId).toBe(file_id);
      expect(event.eventType).toBe("created");
      expect(event.deviceId).toBe("device-test-1");
      expect(event.id).toBeDefined();
      expect(event.createdAt).toBeDefined();
    });

    it("파일 수정 이벤트를 기록한다", async () => {
      // 파일 조회
      const file_rows = await db
        .select()
        .from(files)
        .where(
          and(eq(files.vaultId, vault_id), eq(files.path, "notes/sync-test.md")),
        );
      const file_id = file_rows[0].id;

      const event = await createSyncEvent(
        db,
        vault_id,
        file_id,
        "updated",
        "device-test-2",
      );

      expect(event.eventType).toBe("updated");
      expect(event.deviceId).toBe("device-test-2");
    });

    it("파일 삭제 이벤트를 기록한다", async () => {
      const file_rows = await db
        .select()
        .from(files)
        .where(
          and(eq(files.vaultId, vault_id), eq(files.path, "notes/sync-test.md")),
        );
      const file_id = file_rows[0].id;

      const event = await createSyncEvent(
        db,
        vault_id,
        file_id,
        "deleted",
        "device-test-1",
      );

      expect(event.eventType).toBe("deleted");
    });
  });

  describe("getEventsSince", () => {
    it("since 파라미터 없이 호출하면 최근 이벤트를 반환한다", async () => {
      const events = await getEventsSince(db, vault_id);

      expect(Array.isArray(events)).toBe(true);
      expect(events.length).toBeGreaterThan(0);
      // 각 이벤트는 file_path를 포함해야 함
      expect(events[0].file_path).toBeDefined();
      expect(events[0].event_type).toBeDefined();
      expect(events[0].device_id).toBeDefined();
      expect(events[0].id).toBeDefined();
    });

    it("since 파라미터로 특정 이벤트 이후만 조회한다", async () => {
      // 새 이벤트를 시간 간격을 두고 생성하여 since 테스트
      const file_rows = await db
        .select()
        .from(files)
        .where(
          and(eq(files.vaultId, vault_id), eq(files.path, "notes/sync-test.md")),
        );
      const file_id = file_rows[0].id;

      // 첫 번째 이벤트
      const event1 = await createSyncEvent(db, vault_id, file_id, "updated", "since-test");

      // 충분한 지연 후 두 번째 이벤트 (timestamp 해상도 보장)
      await new Promise((r) => setTimeout(r, 50));
      const event2 = await createSyncEvent(db, vault_id, file_id, "updated", "since-test");

      // event1 이후 조회 → event2는 포함, event1은 미포함
      const later_events = await getEventsSince(db, vault_id, event1.id);

      expect(later_events.length).toBeGreaterThanOrEqual(1);
      const ids = later_events.map((e) => e.id);
      // event2는 결과에 포함되어야 함
      expect(ids).toContain(event2.id);
    });

    it("limit 파라미터로 결과 개수를 제한한다", async () => {
      const events = await getEventsSince(db, vault_id, undefined, 2);

      expect(events.length).toBeLessThanOrEqual(2);
    });

    it("존재하지 않는 since ID면 빈 배열을 반환한다", async () => {
      const events = await getEventsSince(
        db,
        vault_id,
        "00000000-0000-0000-0000-000000000000",
      );

      expect(events).toEqual([]);
    });

    it("이벤트가 created_at 오름차순으로 정렬된다", async () => {
      const events = await getEventsSince(db, vault_id);

      for (let i = 1; i < events.length; i++) {
        const prev = new Date(events[i - 1].created_at).getTime();
        const curr = new Date(events[i].created_at).getTime();
        expect(curr).toBeGreaterThanOrEqual(prev);
      }
    });

    it("이벤트 응답에 file_type이 포함된다 (SPEC-P1-STORAGE-002 REQ-010)", async () => {
      const events = await getEventsSince(db, vault_id);

      expect(events.length).toBeGreaterThan(0);
      expect(events[0].file_type).toBeDefined();
      expect(events[0].file_type).toBe("markdown");
    });

    // ============================================================
    // SPEC-P6-EVENT-007: sequence 기반 쿼리
    // ============================================================

    it("이벤트 응답에 sequence 필드가 포함되어야 한다 (REQ-EVT-003)", async () => {
      const events = await getEventsSince(db, vault_id);

      expect(events.length).toBeGreaterThan(0);
      // sequence는 bigint 또는 number로 반환
      expect(events[0].sequence).toBeDefined();
    });

    it("같은 타임스탬프의 이벤트도 sequence 기준으로 모두 반환해야 한다 (REQ-EVT-003)", async () => {
      const file_rows = await db
        .select()
        .from(files)
        .where(
          and(eq(files.vaultId, vault_id), eq(files.path, "notes/sync-test.md")),
        );
      const file_id = file_rows[0].id;

      // 빠르게 두 이벤트 생성 (같은 타임스탬프 가능성)
      const event1 = await createSyncEvent(db, vault_id, file_id, "updated", "seq-test");
      const event2 = await createSyncEvent(db, vault_id, file_id, "updated", "seq-test");

      // event1 이후 조회
      const later_events = await getEventsSince(db, vault_id, event1.id);

      const ids = later_events.map((e) => e.id);
      expect(ids).toContain(event2.id);
      // event1은 미포함 (since 이후이므로)
      expect(ids).not.toContain(event1.id);
    });
  });

  describe("updateDeviceSyncState", () => {
    it("디바이스 동기화 상태를 생성한다", async () => {
      const all_events = await getEventsSince(db, vault_id);
      const last_event_id = all_events[all_events.length - 1].id;

      const state = await updateDeviceSyncState(
        db,
        "device-sync-1",
        vault_id,
        last_event_id,
      );

      expect(state).toBeDefined();
      expect(state.deviceId).toBe("device-sync-1");
      expect(state.vaultId).toBe(vault_id);
      expect(state.lastEventId).toBe(last_event_id);
    });

    it("동일한 디바이스+볼트 조합은 upsert된다", async () => {
      const all_events = await getEventsSince(db, vault_id);
      const new_last_event_id = all_events[0].id;

      const state = await updateDeviceSyncState(
        db,
        "device-sync-1",
        vault_id,
        new_last_event_id,
      );

      expect(state.lastEventId).toBe(new_last_event_id);

      // DB에 레코드가 1개만 있는지 확인
      const rows = await db
        .select()
        .from(deviceSyncState)
        .where(
          and(
            eq(deviceSyncState.deviceId, "device-sync-1"),
            eq(deviceSyncState.vaultId, vault_id),
          ),
        );

      expect(rows.length).toBe(1);
    });
  });
});
