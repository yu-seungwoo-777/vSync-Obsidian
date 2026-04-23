import type { FastifyInstance } from "fastify";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "../../db/schemas/index.js";
import { createAdminAuthMiddleware } from "../../middlewares/admin-auth.js";
import { setupRoutes } from "./setup.route.js";
import { authRoutes } from "./auth.route.js";
import { vaultAdminRoutes } from "./vault.route.js";
import { fileAdminRoutes } from "./file.route.js";

type DbType = PostgresJsDatabase<typeof schema>;

// @MX:NOTE 관리자 라우트 그룹: /admin/api 접두사로 등록
// 인증 미들웨어로 보호된 라우트들
export function adminRoutes(db: DbType) {
  return async (app: FastifyInstance) => {
    // 인증 미들웨어 등록
    app.addHook("preHandler", createAdminAuthMiddleware(app));

    // 하위 라우트 등록
    app.register(setupRoutes(db));
    app.register(authRoutes(db));
    app.register(vaultAdminRoutes(db));
    app.register(fileAdminRoutes(db));
  };
}
