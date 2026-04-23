import cookie from "@fastify/cookie";
import session from "@fastify/session";
import type { FastifyInstance } from "fastify";

// @MX:NOTE 세션 플러그인: @fastify/cookie + @fastify/session 설정
// 관리자 인증을 위한 서버 측 세션 관리
export async function registerSessionPlugin(app: FastifyInstance) {
  await app.register(cookie);
  await app.register(session, {
    secret: process.env.SESSION_SECRET ?? "dev-session-secret-change-in-production",
    cookie: {
      httpOnly: true,
      sameSite: "strict" as const,
      secure: process.env.NODE_ENV === "production",
      maxAge: 24 * 60 * 60 * 1000, // 24시간
    },
    saveUninitialized: false,
  });
}

// FastifyRequest 타입 확장: 세션에 adminId 추가
declare module "fastify" {
  interface Session {
    adminId?: string;
    username?: string;
    // @MX:NOTE [AUTO] RBAC: 세션에 캐시된 사용자 역할
    role?: string;
  }
}
