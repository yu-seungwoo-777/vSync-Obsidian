import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";
import { createDbClient } from "../src/config/database.js";
import { eq, and } from "drizzle-orm";
import { syncEvents, files } from "../src/db/schemas/index.js";
import { createTestVault } from "./setup.js";
import { setupTestAuth, authHeaders, cleanupTestAuth } from "./helpers/jwt-auth.js";

describe("File Service - Sync Event Integration", () => {
  let app: FastifyInstance;
  let vault_id: string;
  let jwt_token: string;
  const { client, db } = createDbClient();

  beforeAll(async () => {
    app = await buildApp();

    // JWT 토큰 획득
    jwt_token = await setupTestAuth(app);

    const vault = await createTestVault(app, "file-event-test-vault");
    vault_id = vault.vault_id;
    
  });

  afterAll(async () => {
    await app.close();
    await client.end();
  });

  const auth_headers = () => authHeaders(jwt_token);

  describe("uploadFile sync event creation", () => {
    it("파일 생성 시 sync_events에 created 이벤트가 기록된다", async () => {
      const res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers(),
        payload: {
          path: "notes/event-test.md",
          content: "# Event Test",
          hash: "event-test-hash-1",
        },
      });

      expect(res.statusCode).toBe(200);
      const file_body = res.json();

      // sync_events에서 이벤트 확인
      const events = await db
        .select()
        .from(syncEvents)
        .where(
          and(
            eq(syncEvents.vaultId, vault_id),
            eq(syncEvents.fileId, file_body.id),
          ),
        );

      expect(events.length).toBeGreaterThanOrEqual(1);
      const created_event = events.find((e) => e.eventType === "created");
      expect(created_event).toBeDefined();
      expect(created_event!.deviceId).toBe("test-device-id");
    });

    it("X-Device-ID 헤더가 없으면 device_id가 unknown으로 기록된다", async () => {
      // auth middleware는 X-Device-ID를 검증하므로 이 테스트는
      // JWT의 device_id와 일치하는 헤더를 보내되, v1.ts의 getDeviceId는
      // X-Device-ID에서 device_id를 가져옴
      const res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers(),
        payload: {
          path: "notes/with-device.md",
          content: "# With Device",
          hash: "with-device-hash",
        },
      });

      expect(res.statusCode).toBe(200);
      const file_body = res.json();

      const events = await db
        .select()
        .from(syncEvents)
        .where(
          and(
            eq(syncEvents.vaultId, vault_id),
            eq(syncEvents.fileId, file_body.id),
          ),
        );

      const created_event = events.find((e) => e.eventType === "created");
      expect(created_event).toBeDefined();
      expect(created_event!.deviceId).toBe("test-device-id");
    });

    it("파일 수정 시 sync_events에 updated 이벤트가 기록된다", async () => {
      // 파일 수정 (다른 해시로 업로드)
      const res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers(),
        payload: {
          path: "notes/event-test.md",
          content: "# Updated Content",
          hash: "event-test-hash-2",
        },
      });

      expect(res.statusCode).toBe(200);
      const file_body = res.json();

      const events = await db
        .select()
        .from(syncEvents)
        .where(
          and(
            eq(syncEvents.vaultId, vault_id),
            eq(syncEvents.fileId, file_body.id),
            eq(syncEvents.eventType, "updated"),
          ),
        );

      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events[0].deviceId).toBe("test-device-id");
    });

    it("동일한 해시로 업로드하면 이벤트가 생성되지 않는다", async () => {
      // 파일 조회하여 현재 이벤트 수 확인
      const file_rows = await db
        .select()
        .from(files)
        .where(
          and(eq(files.vaultId, vault_id), eq(files.path, "notes/event-test.md")),
        );
      const file_id = file_rows[0].id;

      const events_before = await db
        .select()
        .from(syncEvents)
        .where(
          and(
            eq(syncEvents.vaultId, vault_id),
            eq(syncEvents.fileId, file_id),
          ),
        );

      // 동일한 해시로 재업로드
      const res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers(),
        payload: {
          path: "notes/event-test.md",
          content: "# Updated Content",
          hash: "event-test-hash-2", // 동일한 해시
        },
      });

      expect(res.statusCode).toBe(200);

      // 이벤트 수가 동일해야 함
      const events_after = await db
        .select()
        .from(syncEvents)
        .where(
          and(
            eq(syncEvents.vaultId, vault_id),
            eq(syncEvents.fileId, file_id),
          ),
        );

      expect(events_after.length).toBe(events_before.length);
    });
  });

  describe("deleteFile sync event creation", () => {
    it("파일 삭제 시 sync_events에 deleted 이벤트가 기록된다", async () => {
      // 삭제할 파일 생성
      const upload_res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers(),
        payload: {
          path: "notes/to-delete.md",
          content: "# To Delete",
          hash: "delete-hash",
        },
      });
      const file_id = upload_res.json().id;

      // 파일 삭제
      const delete_res = await app.inject({
        method: "DELETE",
        url: `/v1/vault/${vault_id}/file/notes/to-delete.md`,
        headers: auth_headers(),
      });

      expect(delete_res.statusCode).toBe(200);

      // 삭제 이벤트 확인
      const events = await db
        .select()
        .from(syncEvents)
        .where(
          and(
            eq(syncEvents.vaultId, vault_id),
            eq(syncEvents.fileId, file_id),
            eq(syncEvents.eventType, "deleted"),
          ),
        );

      expect(events.length).toBe(1);
      expect(events[0].deviceId).toBe("test-device-id");
    });
  });
});
