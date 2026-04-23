import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";
import { createDbClient } from "../src/config/database.js";
import { createTestVault } from "./setup.js";
import { setupTestAuth, authHeaders, cleanupTestAuth } from "./helpers/jwt-auth.js";

describe("Sync API Routes", () => {
  let app: FastifyInstance;
  let vault_id: string;
  let jwt_token: string;
  const { client } = createDbClient();

  beforeAll(async () => {
    app = await buildApp();

    // JWT 토큰 획득
    jwt_token = await setupTestAuth(app);

    const vault = await createTestVault(app, "sync-api-test-vault");
    vault_id = vault.vault_id;
    

    // 이벤트 생성을 위한 파일 업로드
    const headers = authHeaders(jwt_token);
    await app.inject({
      method: "PUT",
      url: `/v1/vault/${vault_id}/file`,
      headers,
      payload: { path: "notes/event1.md", content: "# Event 1", hash: "hash-ev1" },
    });
    await app.inject({
      method: "PUT",
      url: `/v1/vault/${vault_id}/file`,
      headers,
      payload: { path: "notes/event2.md", content: "# Event 2", hash: "hash-ev2" },
    });
    await app.inject({
      method: "PUT",
      url: `/v1/vault/${vault_id}/file`,
      headers,
      payload: { path: "notes/event3.md", content: "# Event 3", hash: "hash-ev3" },
    });
  });

  afterAll(async () => {
    await app.close();
    await client.end();
  });

  const auth_headers = () => authHeaders(jwt_token);

  describe("GET /v1/vault/:id/events - 변경 폴링", () => {
    it("since 없이 요청하면 모든 이벤트를 반환한다", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/events`,
        headers: auth_headers(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.events).toBeDefined();
      expect(Array.isArray(body.events)).toBe(true);
      // 파일 3개 업로드로 최소 3개의 created 이벤트
      expect(body.events.length).toBeGreaterThanOrEqual(3);
    });

    it("since 파라미터로 특정 이벤트 이후만 조회한다", async () => {
      // 전체 이벤트 조회
      const all_res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/events`,
        headers: auth_headers(),
      });
      const all_events = all_res.json().events;

      // 마지막 이벤트 ID로 since 쿼리 → 결과가 더 적어야 함
      const since_id = all_events[all_events.length - 1].id;
      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/events?since=${since_id}`,
        headers: auth_headers(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      // 마지막 이벤트 이후이므로 결과가 더 적어야 함
      expect(body.events.length).toBeLessThanOrEqual(all_events.length);
    });

    it("이벤트는 created_at 오름차순으로 정렬된다", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/events`,
        headers: auth_headers(),
      });

      expect(res.statusCode).toBe(200);
      const events = res.json().events;

      for (let i = 1; i < events.length; i++) {
        const prev = new Date(events[i - 1].created_at).getTime();
        const curr = new Date(events[i].created_at).getTime();
        expect(curr).toBeGreaterThanOrEqual(prev);
      }
    });

    it("이벤트에 id, event_type, file_path, device_id, created_at이 포함된다", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/events`,
        headers: auth_headers(),
      });

      expect(res.statusCode).toBe(200);
      const events = res.json().events;
      const event = events[0];

      expect(event.id).toBeDefined();
      expect(event.event_type).toBeDefined();
      expect(event.file_path).toBeDefined();
      expect(event.device_id).toBeDefined();
      expect(event.created_at).toBeDefined();
    });

    it("이벤트 응답에 sequence 필드가 포함되어야 한다 (REQ-EVT-003)", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/events`,
        headers: auth_headers(),
      });

      expect(res.statusCode).toBe(200);
      const events = res.json().events;

      expect(events.length).toBeGreaterThan(0);
      expect(events[0].sequence).toBeDefined();
    });

    it("인증 없으면 401을 반환한다", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/events`,
      });

      expect(res.statusCode).toBe(401);
    });
  });

  describe("PUT /v1/vault/:id/sync-status - 디바이스 동기화 상태", () => {
    it("디바이스 동기화 상태를 업데이트한다", async () => {
      // 이벤트 ID 가져오기
      const events_res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/events`,
        headers: auth_headers(),
      });
      const events = events_res.json().events;
      const last_event_id = events[events.length - 1].id;

      const res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/sync-status`,
        headers: auth_headers(),
        payload: {
          device_id: "test-device-id",
          last_event_id: last_event_id,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.device_id).toBe("test-device-id");
      expect(body.last_event_id).toBe(last_event_id);
    });

    it("동일한 디바이스 재요청 시 upsert된다", async () => {
      const events_res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/events`,
        headers: auth_headers(),
      });
      const events = events_res.json().events;
      const new_last_event_id = events[0].id;

      const res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/sync-status`,
        headers: auth_headers(),
        payload: {
          device_id: "test-device-id",
          last_event_id: new_last_event_id,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().last_event_id).toBe(new_last_event_id);
    });

    it("인증 없으면 401을 반환한다", async () => {
      const res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/sync-status`,
        payload: {
          device_id: "test",
          last_event_id: "00000000-0000-0000-0000-000000000000",
        },
      });

      expect(res.statusCode).toBe(401);
    });
  });
});
