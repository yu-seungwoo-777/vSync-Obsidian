import { eq } from "drizzle-orm";
import { vaults, adminCredentials } from "../../db/schemas/index.js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "../../db/schemas/index.js";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

type DbType = PostgresJsDatabase<typeof schema>;

// @MX:NOTE [AUTO] RBAC 권한 헬퍼: 볼트 접근 권한 확인
// admin은 모든 볼트 접근 가능, user는 본인 볼트(created_by=자신)만 접근 가능
function checkVaultAccess(role: string | undefined, adminId: string | undefined, vaultCreatedBy: string | null): boolean {
  if (role === "admin") return true;
  if (!adminId) return false;
  return vaultCreatedBy === adminId;
}

// @MX:NOTE 볼트 관리 라우트: GET /vaults, POST /vaults, DELETE /vaults/:id
export function vaultAdminRoutes(db: DbType) {
  return async (app: FastifyInstance) => {
    // 볼트 목록 조회 - RBAC 적용
    app.get("/vaults", async (request: FastifyRequest) => {
      const role = request.session.get("role");
      const adminId = request.session.get("adminId");

      const columns = {
        id: vaults.id,
        name: vaults.name,
        created_at: vaults.createdAt,
        created_by: adminCredentials.username,
      };

      if (role === "admin") {
        const result = await db
          .select(columns)
          .from(vaults)
          .leftJoin(adminCredentials, eq(vaults.createdBy, adminCredentials.id));

        return result;
      }

      // user: 본인 볼트만 조회 (created_by = adminId)
      const result = await db
        .select(columns)
        .from(vaults)
        .leftJoin(adminCredentials, eq(vaults.createdBy, adminCredentials.id))
        .where(eq(vaults.createdBy, adminId!));

      return result;
    });

    // 볼트 생성 - created_by 저장
    app.post("/vaults", async (request: FastifyRequest, reply: FastifyReply) => {
      const { name } = request.body as { name?: string };

      if (!name || typeof name !== "string" || name.trim().length === 0) {
        reply.code(400).send({ error: "name is required" });
        return;
      }

      const adminId = request.session.get("adminId");

      const result = await db
        .insert(vaults)
        .values({
          name: name.trim(),
          createdBy: adminId,
        })
        .returning();

      reply.code(201).send({
        id: result[0].id,
        name: result[0].name,
      });
    });

    // 볼트 삭제 - RBAC 적용
    app.delete("/vaults/:id", async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const role = request.session.get("role");
      const adminId = request.session.get("adminId");

      const existing = await db
        .select()
        .from(vaults)
        .where(eq(vaults.id, id))
        .limit(1);

      if (existing.length === 0) {
        reply.code(404).send({ error: "Vault not found" });
        return;
      }

      // RBAC 권한 확인
      if (!checkVaultAccess(role, adminId, existing[0].createdBy)) {
        reply.code(403).send({ error: "Forbidden" });
        return;
      }

      await db.delete(vaults).where(eq(vaults.id, id));
      reply.code(204).send();
    });
  };
}
