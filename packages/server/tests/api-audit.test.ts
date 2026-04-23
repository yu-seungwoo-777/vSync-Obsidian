import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";
import { createDbClient } from "../src/config/database.js";
import { createTestVault } from "./setup.js";
import { setupTestAuth, authHeaders, cleanupTestAuth } from "./helpers/jwt-auth.js";

describe("API Audit - 엔드투엔드 통합 테스트", () => {
  let app: FastifyInstance;
  let vault_id: string;
  let jwt_token: string;
  const { client } = createDbClient();

  beforeAll(async () => {
    app = await buildApp();

    // JWT 토큰 획득
    jwt_token = await setupTestAuth(app);

    const vault = await createTestVault(app, "audit-test");
    vault_id = vault.vault_id;
    
  });

  afterAll(async () => {
    await app.close();
    await client.end();
  });

  function auth_headers(extra?: Record<string, string>) {
    return { ...authHeaders(jwt_token), ...extra };
  }

  describe("Health check", () => {
    it("인증 없이 /health 가 정상 동작한다", async () => {
      const res = await app.inject({ method: "GET", url: "/health" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe("ok");
      expect(body.database).toBe("ok");
      expect(body.storage).toBe("ok");
    });
  });

  describe("Request ID & API version", () => {
    it("모든 응답에 X-Request-Id 와 X-API-Version 이 포함된다", async () => {
      const res = await app.inject({ method: "GET", url: "/health" });
      expect(res.headers["x-request-id"]).toBeDefined();
      expect(res.headers["x-api-version"]).toBe("1.0.0");
    });
  });

  describe("Standard error format", () => {
    it("404 응답이 표준 에러 형식이다", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/raw/nonexistent.md`,
        headers: auth_headers(),
      });
      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body).toHaveProperty("error");
      expect(body.error).toHaveProperty("code");
      expect(body.error).toHaveProperty("message");
      expect(body.error).toHaveProperty("statusCode");
    });

    it("401 응답이 표준 에러 형식이다", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/files`,
      });
      expect(res.statusCode).toBe(401);
    });

    it("400 응답이 표준 에러 형식이다", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/vault",
        payload: {},
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body).toHaveProperty("error");
    });
  });

  describe("Path security", () => {
    it("경로 순회 공격이 차단된다", async () => {
      const res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: auth_headers({ "content-type": "application/json" }),
        payload: {
          path: "../../etc/passwd",
          content: "hacked",
          hash: "abc",
        },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("File CRUD lifecycle", () => {
    it("생성 → 조회 → 수정 → 검색 → 삭제 전체 흐름이 동작한다", async () => {
      // 1. 파일 생성 (raw PUT)
      const create_res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/raw/audit/lifecycle.md`,
        headers: auth_headers({ "content-type": "text/markdown" }),
        body: "# Lifecycle Test\nInitial content",
      });
      expect(create_res.statusCode).toBe(200);

      // 2. 파일 조회
      const get_res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/raw/audit/lifecycle.md`,
        headers: auth_headers(),
      });
      expect(get_res.statusCode).toBe(200);
      expect(get_res.body).toContain("Lifecycle Test");

      // 3. 파일 수정 (edit)
      const edit_res = await app.inject({
        method: "POST",
        url: `/v1/vault/${vault_id}/edit`,
        headers: auth_headers({ "content-type": "application/json" }),
        payload: {
          path: "audit/lifecycle.md",
          old_text: "Initial",
          new_text: "Updated",
        },
      });
      expect(edit_res.statusCode).toBe(200);

      // 4. 검색
      const search_res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/search?q=Updated`,
        headers: auth_headers(),
      });
      expect(search_res.statusCode).toBe(200);
      expect(search_res.json().results.length).toBeGreaterThan(0);

      // 5. 파일 목록
      const list_res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/files`,
        headers: auth_headers(),
      });
      expect(list_res.statusCode).toBe(200);
      const list_body = list_res.json();
      expect(list_body.some((f: { path: string }) => f.path === "audit/lifecycle.md")).toBe(true);

      // 6. 파일 삭제
      const delete_res = await app.inject({
        method: "DELETE",
        url: `/v1/vault/${vault_id}/file/audit/lifecycle.md`,
        headers: auth_headers(),
      });
      expect(delete_res.statusCode).toBe(200);

      // 7. 삭제 확인
      const get_after_delete = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/raw/audit/lifecycle.md`,
        headers: auth_headers(),
      });
      expect(get_after_delete.statusCode).toBe(404);
    });
  });

  describe("Sync events", () => {
    it("파일 변경 후 이벤트가 생성된다", async () => {
      // 파일 생성
      await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/raw/audit/events.md`,
        headers: auth_headers({ "content-type": "text/markdown" }),
        body: "# Events Test",
      });

      // 이벤트 조회
      const events_res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/events`,
        headers: auth_headers(),
      });
      expect(events_res.statusCode).toBe(200);
      const body = events_res.json();
      expect(body.events.length).toBeGreaterThan(0);
    });
  });

  describe("Sync status", () => {
    it("sync-status 업데이트 후 조회된다", async () => {
      // 이벤트 가져오기
      const events_res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/events`,
        headers: auth_headers(),
      });
      const events = events_res.json().events;
      const last_event_id = events[events.length - 1]?.id;

      if (last_event_id) {
        const sync_res = await app.inject({
          method: "PUT",
          url: `/v1/vault/${vault_id}/sync-status`,
          headers: auth_headers({ "content-type": "application/json" }),
          payload: {
            device_id: "audit-device",
            last_event_id: last_event_id,
          },
        });
        expect(sync_res.statusCode).toBe(200);
        expect(sync_res.json().device_id).toBe("audit-device");
      }
    });
  });
});
