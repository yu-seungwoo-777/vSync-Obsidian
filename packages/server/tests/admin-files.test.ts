import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildTestAdminApp } from "./helpers/admin-app.js";
import type { FastifyInstance } from "fastify";
import { createDbClient } from "../src/config/database.js";
import { adminCredentials, vaults } from "../src/db/schemas/index.js";
import { eq } from "drizzle-orm";
import bcrypt from "bcrypt";
import { setupTestAuth, authHeaders, cleanupTestAuth } from "./helpers/jwt-auth.js";

// set-cookie 헤더에서 쿠키 문자열만 추출
function extractCookies(setCookie: string | string[] | undefined): string {
  if (!setCookie) return "";
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
  return cookies.map((c: string) => c.split(";")[0]).join("; ");
}

describe("T-007: File Routes", () => {
  let app: FastifyInstance;
  const { client, db } = createDbClient();
  const adminUsername = `files-admin-${Date.now()}`;
  const adminPassword = "filesadmin12345678";
  let sessionCookies: string;
  let testVaultId: string;
  let jwtToken: string;
  const createdVaultIds: string[] = [];

  beforeAll(async () => {
    app = await buildTestAdminApp();
    // 관리자 계정 생성
    const hash = await bcrypt.hash(adminPassword, 12);
    await db.insert(adminCredentials).values({
      username: adminUsername,
      passwordHash: hash,
      role: "admin",
    });

    // 로그인
    const loginRes = await app.inject({
      method: "POST",
      url: "/admin/api/login",
      payload: { username: adminUsername, password: adminPassword },
    });
    sessionCookies = extractCookies(loginRes.headers["set-cookie"]);

    // JWT 토큰 획득 (device_id 포함)
    const jwtLoginRes = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { username: adminUsername, password: adminPassword, device_id: "test-device-id" },
    });
    jwtToken = jwtLoginRes.json().token;

    // 테스트용 볼트 생성
    const vaultRes = await app.inject({
      method: "POST",
      url: "/admin/api/vaults",
      payload: { name: "files-test-vault" },
      headers: { cookie: sessionCookies },
    });
    testVaultId = vaultRes.json().id;
    createdVaultIds.push(testVaultId);

    // 테스트 파일 업로드 (JWT 토큰 사용)
    await app.inject({
      method: "PUT",
      url: `/v1/vault/${testVaultId}/file`,
      payload: { path: "test-file.md", content: "# Hello", hash: "abc123" },
      headers: authHeaders(jwtToken),
    });
  });

  afterAll(async () => {
    // 볼트 삭제 (cascade로 files, sync_events, device_sync_state도 삭제됨)
    for (const vaultId of createdVaultIds) {
      await db.delete(vaults).where(eq(vaults.id, vaultId));
    }
    await db
      .delete(adminCredentials)
      .where(eq(adminCredentials.username, adminUsername));
    await app.close();
    await client.end();
  });

  describe("GET /admin/api/vaults/:id/files", () => {
    it("볼트의 파일 목록을 반환한다", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/admin/api/vaults/${testVaultId}/files`,
        headers: { cookie: sessionCookies },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThan(0);

      const file = body[0];
      expect(file.path).toBeDefined();
      expect(file.size).toBeDefined();
      expect(file.updated_at).toBeDefined();
    });

    it("빈 볼트에서는 빈 배열을 반환한다", async () => {
      // 새 빈 볼트 생성
      const vaultRes = await app.inject({
        method: "POST",
        url: "/admin/api/vaults",
        payload: { name: "empty-vault" },
        headers: { cookie: sessionCookies },
      });
      const emptyVaultId = vaultRes.json().id;
      createdVaultIds.push(emptyVaultId);

      const res = await app.inject({
        method: "GET",
        url: `/admin/api/vaults/${emptyVaultId}/files`,
        headers: { cookie: sessionCookies },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it("존재하지 않는 볼트면 404를 반환한다", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/admin/api/vaults/00000000-0000-0000-0000-000000000000/files",
        headers: { cookie: sessionCookies },
      });

      expect(res.statusCode).toBe(404);
    });

    it("미인증 상태에서 401을 반환한다", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/admin/api/vaults/${testVaultId}/files`,
      });

      expect(res.statusCode).toBe(401);
    });
  });
});
