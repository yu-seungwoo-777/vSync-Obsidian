import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "../../db/schemas/index.js";
import { checkInitialized, createAdmin } from "../../services/admin.service.js";

type DbType = PostgresJsDatabase<typeof schema>;

// @MX:NOTE 초기 설정 라우트: GET /status, POST /setup
export function setupRoutes(db: DbType) {
  return async (app: FastifyInstance) => {
    // 초기화 상태 확인
    app.get("/status", async () => {
      const initialized = await checkInitialized(db);
      return { initialized };
    });

    // 초기 설정 (최초 1회만 가능)
    app.post("/setup", async (request: FastifyRequest, reply: FastifyReply) => {
      const { username, password } = request.body as {
        username?: string;
        password?: string;
      };

      // 입력 검증
      if (!username || typeof username !== "string" || username.length < 3) {
        reply.code(400).send({
          error: "username must be at least 3 characters",
        });
        return;
      }

      if (!password || typeof password !== "string" || password.length < 8) {
        reply.code(400).send({
          error: "password must be at least 8 characters",
        });
        return;
      }

      // 이미 초기화된 경우 차단 (동시성 보호: check-then-insert)
      const alreadyInitialized = await checkInitialized(db);
      if (alreadyInitialized) {
        reply.code(403).send({
          error: "Already initialized",
        });
        return;
      }

      // 관리자 계정 생성 (UNIQUE 제약조건이 동시 요청에 대한 최종 방어)
      let admin;
      try {
        admin = await createAdmin(db, username, password, "admin");
      } catch (err: unknown) {
        // 동시에 두 요청이 checkInitialized를 통과한 경우 UNIQUE 위반 발생
        if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "23505") {
          reply.code(403).send({ error: "Already initialized" });
          return;
        }
        throw err;
      }

      // 세션 설정
      request.session.set("adminId", admin.id);
      request.session.set("username", admin.username);
      request.session.set("role", admin.role);

      reply.code(201).send({ username: admin.username });
    });
  };
}
