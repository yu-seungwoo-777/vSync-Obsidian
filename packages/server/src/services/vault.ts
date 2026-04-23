import { eq } from "drizzle-orm";
import { vaults } from "../db/schemas/index.js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "../db/schemas/index.js";

type DbType = PostgresJsDatabase<typeof schema>;

// @MX:NOTE 볼트 생성: UUID 자동 생성, JWT 토큰 기반 인증
export async function createVault(db: DbType, name: string, createdBy?: string) {
  const values = {
    name,
    ...(createdBy !== undefined ? { createdBy } : {}),
  };

  const result = await db
    .insert(vaults)
    .values(values)
    .returning();

  return {
    vault_id: result[0].id,
    name: result[0].name,
    created_at: result[0].createdAt,
  };
}

// 볼트 ID로 조회
export async function getVaultById(db: DbType, id: string) {
  const result = await db
    .select()
    .from(vaults)
    .where(eq(vaults.id, id))
    .limit(1);

  return result.length > 0 ? result[0] : null;
}
