import { createDbClient } from "../../src/config/database.js";
import { adminCredentials } from "../../src/db/schemas/index.js";
import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import crypto from "node:crypto";

/**
 * 테스트용 JWT 인증 헬퍼
 * API Key 인증이 제거되어 모든 테스트에서 JWT 토큰을 사용합니다.
 */

let _setupDone = false;
let _testAdminUsername = "";
let _testAdminPassword = "";
let _jwtToken = "";
let _testAdminId = "";

/**
 * 테스트용 관리자 계정을 생성하고 JWT 토큰을 반환합니다.
 * 같은 프로세스 내에서 한 번만 실행됩니다.
 */
export async function setupTestAuth(app: FastifyInstance): Promise<string> {
  if (_setupDone) return _jwtToken;

  const { db } = createDbClient();
  _testAdminUsername = `test-admin-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  _testAdminPassword = "testadmin12345678";

  // 관리자 계정 생성
  const hash = await bcrypt.hash(_testAdminPassword, 12);
  await db.insert(adminCredentials).values({
    username: _testAdminUsername,
    passwordHash: hash,
    role: "admin",
  });

  // JWT 토큰 획득 (device_id 포함, SPEC-JWT-DEVICE-BINDING-001)
  const loginRes = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: { username: _testAdminUsername, password: _testAdminPassword, device_id: "test-device-id" },
  });

  _jwtToken = loginRes.json().token;
  _testAdminId = loginRes.json().user?.id;
  _setupDone = true;
  return _jwtToken;
}

/**
 * JWT 인증 헤더를 반환합니다. (device_id 헤더 포함)
 */
export function authHeaders(token?: string): Record<string, string> {
  if (!token) throw new Error("Token required. Call setupTestAuth first.");
  return {
    authorization: `Bearer ${token}`,
    "x-device-id": "test-device-id",
  };
}

/**
 * 테스트용 관리자 계정을 정리합니다.
 * afterAll에서 호출합니다.
 */
export async function cleanupTestAuth(): Promise<void> {
  if (!_setupDone) return;
  const { client, db } = createDbClient();
  try {
    // 관리자가 생성한 볼트가 있을 수 있으므로 삭제 스킵 (테스트 볼트는 setup.js에서 정리)
    await db
      .delete(adminCredentials)
      .where(eq(adminCredentials.username, _testAdminUsername));
  } catch {
    // 외래 키 제약 조건으로 삭제 실패 시 무시 (다른 정리에서 처리됨)
  } finally {
    await client.end();
  }
}
