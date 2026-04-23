import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "../../db/schemas/index.js";
import {
  getAdminByUsername,
  verifyAdminPassword,
} from "../../services/admin.service.js";

type DbType = PostgresJsDatabase<typeof schema>;

// @MX:NOTE 인증 라우트: POST /login, POST /logout, GET /me
export function authRoutes(db: DbType) {
  return async (app: FastifyInstance) => {
    // 로그인
    app.post("/login", async (request: FastifyRequest, reply: FastifyReply) => {
      const { username, password } = request.body as {
        username?: string;
        password?: string;
      };

      if (!username || !password) {
        reply.code(401).send({ error: "Invalid credentials" });
        return;
      }

      const admin = await getAdminByUsername(db, username);
      if (!admin) {
        reply.code(401).send({ error: "Invalid credentials" });
        return;
      }

      const valid = await verifyAdminPassword(password, admin.passwordHash);
      if (!valid) {
        reply.code(401).send({ error: "Invalid credentials" });
        return;
      }

      // 세션 설정
      request.session.set("adminId", admin.id);
      request.session.set("username", admin.username);
      request.session.set("role", admin.role);

      return { username: admin.username };
    });

    // 로그아웃
    app.post("/logout", async (request: FastifyRequest, _reply: FastifyReply) => {
      request.session.destroy();
      return { message: "Logged out" };
    });

    // 현재 사용자 정보
    app.get("/me", async (request: FastifyRequest) => {
      const username = request.session.get("username");
      const role = request.session.get("role");
      return { username, role };
    });
  };
}
