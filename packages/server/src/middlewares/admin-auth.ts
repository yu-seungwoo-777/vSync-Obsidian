import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

// @MX:NOTE 인증 없이 접근 가능한 경로 접두사 목록
const PUBLIC_PATH_PREFIXES = [
  "/admin/api/status",
  "/admin/api/setup",
  "/admin/api/login",
];

// @MX:ANCHOR 관리자 인증 미들웨어: 세션 기반 adminId 확인
// @MX:REASON 모든 관리자 보호 라우트에서 사용, fan_in >= 5
export function createAdminAuthMiddleware(_app: FastifyInstance) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const urlPath = request.url.split("?")[0];

    // 공개 경로는 인증 스킵
    if (PUBLIC_PATH_PREFIXES.some((prefix) => urlPath === prefix)) {
      return;
    }

    // 세션에 adminId가 없으면 401
    if (!request.session.get("adminId")) {
      reply.code(401).send({ error: "Unauthorized" });
      return;
    }
  };
}
