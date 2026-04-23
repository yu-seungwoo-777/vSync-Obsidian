import type { FastifyRequest, FastifyReply } from "fastify";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import { vaults } from "../db/schemas/index.js";
import type * as schema from "../db/schemas/index.js";
import { verifyToken, type JwtPayload } from "./jwt.js";

// FastifyRequest에 vault 속성 추가 (인증 미들웨어에서 설정)
declare module "fastify" {
  interface FastifyRequest {
    vault?: typeof vaults.$inferSelect;
    // @MX:NOTE [AUTO] JWT 인증 시 요청에 첨부되는 사용자 정보
    user?: JwtPayload;
  }
}

// @MX:NOTE 데이터베이스 타입 (Drizzle ORM + PostgreSQL)
type DbType = PostgresJsDatabase<typeof schema>;

// @MX:ANCHOR Fastify 인증 미들웨어: JWT Bearer 토큰 인증만 지원
// @MX:REASON 모든 보호된 라우트에서 사용, fan_in >= 5, 볼트 격리 보장
export function createAuthMiddleware(db: DbType) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const authorization = request.headers["authorization"];

    // JWT Bearer 토큰 인증 처리
    if (authorization && typeof authorization === "string" && authorization.startsWith("Bearer ")) {
      const token = authorization.slice(7);
      const payload = verifyToken(token);

      if (!payload) {
        reply.code(401).send({ error: "Invalid or expired token" });
        return;
      }

      // 요청에 사용자 정보 첨부
      request.user = payload;

      // device_id 검증: JWT 페이로드와 요청 헤더의 device_id 일치 확인 (REQ-DB-004)
      const xDeviceId = request.headers["x-device-id"];
      if (!xDeviceId || typeof xDeviceId !== "string") {
        reply.code(401).send({ error: "Missing device identity" });
        return;
      }
      if (payload.device_id !== xDeviceId) {
        reply.code(401).send({ error: "Device identity mismatch" });
        return;
      }

      const vaultId = (request.params as Record<string, string>).id;
      if (!vaultId) {
        // 볼트 ID가 없는 라우트 (예: /auth/vaults)는 인증만으로 통과
        return;
      }

      // 관리자는 모든 볼트 접근 허용
      if (payload.role === "admin") {
        const result = await db
          .select()
          .from(vaults)
          .where(eq(vaults.id, vaultId))
          .limit(1);

        if (result.length === 0) {
          reply.code(404).send({ error: "Vault not found" });
          return;
        }
        request.vault = result[0];
        return;
      }

      // 일반 사용자: 본인이 생성한 볼트만 접근 가능
      const result = await db
        .select()
        .from(vaults)
        .where(eq(vaults.id, vaultId))
        .limit(1);

      if (result.length === 0) {
        reply.code(401).send({ error: "Unauthorized" });
        return;
      }

      if (result[0].createdBy !== payload.user_id) {
        reply.code(403).send({ error: "Forbidden" });
        return;
      }

      request.vault = result[0];
      return;
    }

    // 인증 정보 없음
    reply.code(401).send({ error: "Unauthorized" });
  };
}

// @MX:NOTE 사용자 ID로 접근 가능한 볼트 목록 조회 (JWT 인증용)
export async function getUserVaults(db: DbType, userId: string, role: string) {
  if (role === "admin") {
    // 관리자: 모든 볼트 반환
    return db
      .select({
        id: vaults.id,
        name: vaults.name,
        created_at: vaults.createdAt,
      })
      .from(vaults);
  }

  // 일반 사용자: 본인이 생성한 볼트만 반환
  return db
    .select({
      id: vaults.id,
      name: vaults.name,
      created_at: vaults.createdAt,
    })
    .from(vaults)
    .where(eq(vaults.createdBy, userId));
}
