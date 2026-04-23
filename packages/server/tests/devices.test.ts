import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";
import { createDbClient } from "../src/config/database.js";
import { createTestVault } from "./setup.js";
import { setupTestAuth, authHeaders, cleanupTestAuth } from "./helpers/jwt-auth.js";

describe("Devices 엔드포인트", () => {
  let app: FastifyInstance;
  let vault_id: string;
  let jwt_token: string;
  const { client } = createDbClient();

  beforeAll(async () => {
    app = await buildApp();

    // JWT 토큰 획득
    jwt_token = await setupTestAuth(app);

    const vault = await createTestVault(app, "devices-test");
    vault_id = vault.vault_id;
    
  });

  afterAll(async () => {
    await app.close();
    await client.end();
  });

  function auth_headers() {
    return { ...authHeaders(jwt_token) };
  }

  describe("GET /vault/:id/devices - 디바이스 목록", () => {
    it("인증 없이 접근하면 401 을 반환한다", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/devices`,
      });

      expect(res.statusCode).toBe(401);
    });

    it("빈 디바이스 목록을 반환한다", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/devices`,
        headers: auth_headers(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty("devices");
      expect(Array.isArray(body.devices)).toBe(true);
    });

    it("sync-status 업데이트 후 디바이스가 목록에 나타난다", async () => {
      // sync-status 업데이트로 디바이스 등록
      const file_res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/raw/device-test.md`,
        headers: {
          ...auth_headers(),
          "content-type": "text/markdown",
        },
        body: "test",
      });
      expect(file_res.statusCode).toBe(200);

      // 이벤트 가져오기
      const events_res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/events`,
        headers: auth_headers(),
      });
      const events_body = events_res.json();
      const last_event_id = events_body.events[events_body.events.length - 1]?.id;

      if (last_event_id) {
        // sync-status 업데이트
        await app.inject({
          method: "PUT",
          url: `/v1/vault/${vault_id}/sync-status`,
          headers: { ...auth_headers(), "content-type": "application/json" },
          payload: {
            device_id: "test-device-001",
            last_event_id: last_event_id,
          },
        });

        // 디바이스 목록 확인
        const devices_res = await app.inject({
          method: "GET",
          url: `/v1/vault/${vault_id}/devices`,
          headers: auth_headers(),
        });

        expect(devices_res.statusCode).toBe(200);
        const body = devices_res.json();
        expect(body.devices.length).toBeGreaterThan(0);
        expect(body.devices[0]).toHaveProperty("device_id");
      }
    });
  });

  describe("DELETE /vault/:id/devices/:deviceId - 디바이스 삭제", () => {
    it("인증 없이 접근하면 401 을 반환한다", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: `/v1/vault/${vault_id}/devices/test-device-001`,
      });

      expect(res.statusCode).toBe(401);
    });

    it("존재하는 디바이스를 삭제하면 200 을 반환한다", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: `/v1/vault/${vault_id}/devices/test-device-001`,
        headers: auth_headers(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty("message");
    });

    it("삭제 후 디바이스 목록에서 사라진다", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/devices`,
        headers: auth_headers(),
      });

      const body = res.json();
      const found = body.devices.find(
        (d: { device_id: string }) => d.device_id === "test-device-001",
      );
      expect(found).toBeUndefined();
    });
  });
});
