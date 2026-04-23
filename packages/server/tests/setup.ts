import { afterAll } from "vitest";
import { createDbClient } from "../src/config/database.js";
import { eq } from "drizzle-orm";
import { vaults } from "../src/db/schemas/index.js";
import type { FastifyInstance } from "fastify";

// Vitest 전역 설정
// postgres 라이브러리가 .end() 호출 시 자동 UNLISTEN을 시도하며
// 이미 파괴된 연결에서 발생하는 CONNECTION_DESTROYED 에러를 무시
process.on("unhandledRejection", (err: unknown) => {
  if (
    err &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code: string }).code === "CONNECTION_DESTROYED"
  ) {
    return;
  }
});

// 테스트 볼트 레지스트리
const testVaultIds: string[] = [];

/**
 * 테스트용 볼트를 생성하고 afterAll에서 자동 삭제되도록 등록합니다.
 * JWT 토큰 기반 인증을 사용합니다.
 */
export async function createTestVault(
  app: FastifyInstance,
  name: string,
): Promise<{ vault_id: string }> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/vault",
    payload: { name },
  });

  const body = res.json() as { vault_id: string };
  testVaultIds.push(body.vault_id);
  return body;
}

/**
 * 관리자 API로 테스트용 볼트를 생성하고 afterAll에서 자동 삭제되도록 등록합니다.
 */
export async function createAdminVault(
  app: FastifyInstance,
  name: string,
  sessionCookies: string,
): Promise<{ id: string; name: string }> {
  const res = await app.inject({
    method: "POST",
    url: "/admin/api/vaults",
    payload: { name },
    headers: { cookie: sessionCookies },
  });

  const body = res.json() as { id: string; name: string };
  testVaultIds.push(body.id);
  return body;
}

// 모든 테스트 완료 후 등록된 볼트 일괄 삭제
afterAll(async () => {
  if (testVaultIds.length === 0) return;

  const { client, db } = createDbClient();
  try {
    for (const vaultId of testVaultIds) {
      try {
        await db.delete(vaults).where(eq(vaults.id, vaultId));
      } catch {
        // 이미 삭제된 경우 무시
      }
    }
  } finally {
    await client.end();
  }
});
