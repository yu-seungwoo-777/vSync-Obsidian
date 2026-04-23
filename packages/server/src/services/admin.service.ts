import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";
import { adminCredentials } from "../db/schemas/index.js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "../db/schemas/index.js";

type DbType = PostgresJsDatabase<typeof schema>;

// @MX:NOTE 관리자 계정 존재 여부 확인 (초기 설정 화면 판단)
export async function checkInitialized(db: DbType): Promise<boolean> {
  const result = await db
    .select({ id: adminCredentials.id })
    .from(adminCredentials)
    .limit(1);
  return result.length > 0;
}

// @MX:NOTE 관리자 계정 생성 (초기 설정 시 1회만 호출)
export async function createAdmin(
  db: DbType,
  username: string,
  password: string,
  role: string = "user",
): Promise<{ id: string; username: string; role: string }> {
  const passwordHash = await bcrypt.hash(password, 12);
  const result = await db
    .insert(adminCredentials)
    .values({ username, passwordHash, role })
    .returning();

  return {
    id: result[0].id,
    username: result[0].username,
    role: result[0].role,
  };
}

// @MX:NOTE 사용자 이름으로 관리자 조회
export async function getAdminByUsername(
  db: DbType,
  username: string,
): Promise<{ id: string; username: string; passwordHash: string; role: string } | null> {
  const result = await db
    .select()
    .from(adminCredentials)
    .where(eq(adminCredentials.username, username))
    .limit(1);

  return result.length > 0 ? result[0] : null;
}

// @MX:NOTE 비밀번호 검증
export async function verifyAdminPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
