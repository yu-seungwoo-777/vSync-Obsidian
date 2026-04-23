import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import session from "@fastify/session";
import { v1Routes } from "../../src/routes/v1.js";
import { adminRoutes } from "../../src/routes/admin/index.js";
import { createDbClient } from "../../src/config/database.js";
import crypto from "node:crypto";

// @MX:NOTE 관리자 기능이 포함된 테스트용 Fastify 앱 빌더
export async function buildTestAdminApp() {
  const app = Fastify({
    logger: false,
  });

  await app.register(cors, { origin: true });

  // 세션 플러그인 등록
  await app.register(cookie);
  await app.register(session, {
    secret: "test-session-secret-for-testing-only",
    cookie: {
      httpOnly: true,
      sameSite: "strict" as const,
      secure: false, // 테스트 환경
      maxAge: 24 * 60 * 60 * 1000, // 24시간
    },
    saveUninitialized: false,
  });

  // Health 엔드포인트
  app.get("/health", async () => {
    return { status: "ok", timestamp: new Date().toISOString() };
  });

  // API v1 라우트
  app.register(v1Routes, { prefix: "/v1" });

  // 관리자 라우트
  const { db } = createDbClient();
  app.register(adminRoutes(db), { prefix: "/admin/api" });

  return app;
}
