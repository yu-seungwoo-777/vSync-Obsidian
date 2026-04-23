import path from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";

// @MX:NOTE 정적 파일 서빙 플러그인: packages/web/dist를 루트 경로에서 서빙
// 반드시 /v1/ 및 /admin/api/ 라우트 등록 후에 호출해야 함
export async function registerStaticPlugin(app: FastifyInstance) {
  const webDistPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../../packages/web/dist",
  );

  try {
    await app.register(fastifyStatic, {
      root: webDistPath,
      prefix: "/",
      wildcard: false,
    });

    // SPA fallback: 존재하지 않는 경로에 대해 index.html 반환
    app.setNotFoundHandler((request, reply) => {
      // API 경로는 fallback하지 않음
      if (
        request.url.startsWith("/v1/") ||
        request.url.startsWith("/admin/api/")
      ) {
        reply.code(404).send({ error: "Not Found" });
        return;
      }
      // SPA fallback: index.html 반환
      reply.sendFile("index.html");
    });
  } catch {
    // packages/web/dist가 존재하지 않는 경우 (빌드 전)
    app.setNotFoundHandler((request, reply) => {
      if (
        request.url.startsWith("/v1/") ||
        request.url.startsWith("/admin/api/")
      ) {
        reply.code(404).send({ error: "Not Found" });
        return;
      }
      reply.code(404).send({ error: "Web interface not built" });
    });
  }
}
