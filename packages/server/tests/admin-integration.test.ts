import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildTestAdminApp } from "./helpers/admin-app.js";
import type { FastifyInstance } from "fastify";
import { createDbClient } from "../src/config/database.js";
import { adminCredentials, vaults } from "../src/db/schemas/index.js";
import { eq } from "drizzle-orm";
import { createAdminVault, createTestVault } from "./setup.js";

// set-cookie 헤더에서 쿠키 문자열만 추출
function extractCookies(setCookie: string | string[] | undefined): string {
  if (!setCookie) return "";
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
  return cookies.map((c: string) => c.split(";")[0]).join("; ");
}

describe("T-010: Admin Integration - Full Flow", () => {
  let app: FastifyInstance;
  const { client, db } = createDbClient();
  const testAdminUsername = `integ-admin-${Date.now()}`;
  const createdVaultIds: string[] = [];

  beforeAll(async () => {
    app = await buildTestAdminApp();
  });

  afterAll(async () => {
    // 볼트를 먼저 삭제 (외래 키 제약: vaults.created_by → admin_credentials)
    for (const vaultId of createdVaultIds) {
      try {
        await db.delete(vaults).where(eq(vaults.id, vaultId));
      } catch {
        // 이미 삭제된 경우 무시
      }
    }
    // 이 테스트에서 생성한 계정 정리
    await db
      .delete(adminCredentials)
      .where(eq(adminCredentials.username, testAdminUsername));
    await app.close();
    await client.end();
  });

  it("전체 플로우: setup -> login -> create vault -> list vaults -> list files -> logout", async () => {
    // Step 1: 초기 상태 확인
    const statusRes = await app.inject({
      method: "GET",
      url: "/admin/api/status",
    });
    expect(statusRes.statusCode).toBe(200);
    // 다른 테스트가 초기화했을 수 있으므로 initialized 필드 존재만 확인
    expect(statusRes.json()).toHaveProperty("initialized");

    // Step 2: 초기 설정 (다른 테스트가 이미 초기화한 경우 403이 예상됨)
    const setupRes = await app.inject({
      method: "POST",
      url: "/admin/api/setup",
      payload: { username: testAdminUsername, password: "integration12345" },
    });

    // 이미 초기화된 경우 setup 단계 스킵, 직접 로그인
    if (setupRes.statusCode === 403) {
      // 다른 테스트가 이미 관리자를 생성함
      // 이 테스트의 관리자를 직접 DB에 삽입
      const bcrypt = await import("bcrypt");
      const hash = await bcrypt.default.hash("integration12345", 12);
      try {
        await db.insert(adminCredentials).values({
          username: testAdminUsername,
          passwordHash: hash,
          role: "admin",
        });
      } catch {
        // 이미 존재하는 경우 무시
      }
    }

    // Step 5: 로그인
    const loginRes = await app.inject({
      method: "POST",
      url: "/admin/api/login",
      payload: { username: testAdminUsername, password: "integration12345" },
    });
    expect(loginRes.statusCode).toBe(200);
    const loginCookies = extractCookies(loginRes.headers["set-cookie"]);

    // Step 6: 사용자 정보 확인
    const meRes = await app.inject({
      method: "GET",
      url: "/admin/api/me",
      headers: { cookie: loginCookies },
    });
    expect(meRes.statusCode).toBe(200);
    expect(meRes.json().username).toBe(testAdminUsername);

    // JWT 토큰 획득 (v1 API 접근용, device_id 포함)
    const jwtLoginRes = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { username: testAdminUsername, password: "integration12345", device_id: "test-device-id" },
    });
    expect(jwtLoginRes.statusCode).toBe(200);
    const jwtToken = jwtLoginRes.json().token;

    // Step 7: 볼트 생성
    const vaultData = await createAdminVault(app, "integration-test-vault", loginCookies);
    // API key는 더 이상 반환하지 않음
    expect(vaultData.id).toBeDefined();
    createdVaultIds.push(vaultData.id);

    // Step 8: 볼트 목록 조회
    const listVaultsRes = await app.inject({
      method: "GET",
      url: "/admin/api/vaults",
      headers: { cookie: loginCookies },
    });
    expect(listVaultsRes.statusCode).toBe(200);
    const vaultList = listVaultsRes.json();
    expect(vaultList.length).toBeGreaterThanOrEqual(1);
    const listedVault = vaultList.find((v: { id: string }) => v.id === vaultData.id);
    expect(listedVault).toBeDefined();

    // Step 9: 파일 목록 (빈 볼트)
    const filesRes = await app.inject({
      method: "GET",
      url: `/admin/api/vaults/${vaultData.id}/files`,
      headers: { cookie: loginCookies },
    });
    expect(filesRes.statusCode).toBe(200);
    expect(filesRes.json()).toEqual([]);

    // Step 10: v1 API로 파일 업로드 (JWT 토큰 + device_id 사용)
    const uploadRes = await app.inject({
      method: "PUT",
      url: `/v1/vault/${vaultData.id}/file`,
      payload: { path: "test.md", content: "# Test", hash: "testhash123" },
      headers: { authorization: `Bearer ${jwtToken}`, "x-device-id": "test-device-id" },
    });
    expect(uploadRes.statusCode).toBe(200);

    // Step 11: 관리자 API로 파일 목록 다시 확인
    const filesRes2 = await app.inject({
      method: "GET",
      url: `/admin/api/vaults/${vaultData.id}/files`,
      headers: { cookie: loginCookies },
    });
    expect(filesRes2.statusCode).toBe(200);
    expect(filesRes2.json().length).toBe(1);
    expect(filesRes2.json()[0].path).toBe("test.md");

    // Step 12: 로그아웃
    const logoutRes = await app.inject({
      method: "POST",
      url: "/admin/api/logout",
      headers: { cookie: loginCookies },
    });
    expect(logoutRes.statusCode).toBe(200);

    // Step 13: 로그아웃 후 보호된 엔드포인트 접근 불가
    const meRes2 = await app.inject({
      method: "GET",
      url: "/admin/api/me",
      headers: { cookie: loginCookies },
    });
    expect(meRes2.statusCode).toBe(401);
  });

  it("/v1/ 기존 라우트가 정상 작동한다 (회귀 테스트)", async () => {
    // 관리자 계정으로 JWT 토큰 획득 (device_id 포함)
    const jwtLoginRes = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { username: testAdminUsername, password: "integration12345", device_id: "test-device-id" },
    });
    const jwtToken = jwtLoginRes.json().token;

    // 볼트 생성 (v1)
    const { vault_id } = await createTestVault(app, "regression-vault");
    createdVaultIds.push(vault_id);

    // 파일 목록 조회 (v1, JWT 인증 + device_id)
    const filesRes = await app.inject({
      method: "GET",
      url: `/v1/vault/${vault_id}/files`,
      headers: { authorization: `Bearer ${jwtToken}`, "x-device-id": "test-device-id" },
    });
    expect(filesRes.statusCode).toBe(200);
  });
});
