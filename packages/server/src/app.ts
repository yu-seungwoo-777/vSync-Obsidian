import crypto from "node:crypto";
import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { appConfig } from "./config/app.js";
import { databaseConfig } from "./config/database.js";
import { v1Routes } from "./routes/v1.js";
import { adminRoutes } from "./routes/admin/index.js";
import { registerWebSocket } from "./services/websocket.js";
import { RealtimeSyncBridge } from "./services/realtime-sync.js";
import { createDbClient } from "./config/database.js";
import { setNotifyClient } from "./services/sync-event.js";
import { registerSessionPlugin } from "./plugins/session.js";
import { registerStaticPlugin } from "./plugins/static.js";
import { sql } from "drizzle-orm";
import { StandardError, ERROR_CODES } from "./utils/errors.js";
import { createS3Client, storageConfig } from "./config/storage.js";
import { HeadBucketCommand } from "@aws-sdk/client-s3";
import postgres from "postgres";
import type Sql from "postgres";

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: appConfig.nodeEnv === "production" ? "info" : "debug",
    },
  });

  // CORS: CORS_ORIGINS 환경 변수 지원
  const corsOrigins = process.env.CORS_ORIGINS;
  const corsOptions: Record<string, unknown> = corsOrigins
    ? { origin: corsOrigins.split(",").map((s) => s.trim()) }
    : { origin: true };
  await app.register(cors, corsOptions);

  // T-F01: Rate limiting - 60/min per API key, health check 제외
  if (appConfig.nodeEnv !== "test") {
    await app.register(rateLimit, {
      max: 60,
      timeWindow: "1 minute",
      keyGenerator: (request) => {
        return (request.headers["authorization"] as string) ?? request.ip;
      },
      allowList: (request) => {
        return request.url === "/health" || request.url === "/";
      },
    });

    // @MX:WARN 로그인 브루트포스 방지: 5회/1분 → 차단 (AC-AUTH-005)
    // @MX:REASON 무차별 대입 공격으로부터 관리자 계정 보호
    await app.register(rateLimit, {
      max: 5,
      timeWindow: "1 minute",
      keyGenerator: (request) => `login:${request.ip}`,
      allowList: (request) => {
        const url = request.url.split("?")[0];
        return url !== "/admin/api/login" || request.method !== "POST";
      },
    });
  }

  // T-B04: 요청 ID 생성 로깅
  app.addHook("onRequest", async (request, _reply) => {
    // X-Request-Id 생성
    const requestId = crypto.randomUUID();
    request.headers["x-request-id"] = requestId;
    _reply.header("X-Request-Id", requestId);
    _reply.header("X-API-Version", "1.0.0");
  });

  // T-B03: Enhanced /health - DB, storage, WS 상태 체크
  app.get("/health", async (_request, reply) => {
    const timestamp = new Date().toISOString();
    const checks: { database: string; storage: string; websocket: string } = {
      database: "ok",
      storage: "ok",
      websocket: "ok",
    };

    // DB 연결 확인
    try {
      const { db, client: dbClient } = createDbClient();
      await db.execute(sql`SELECT 1`);
      await dbClient.end();
    } catch {
      checks.database = "error";
    }

    // Storage (MinIO) 연결 확인
    try {
      const s3 = createS3Client();
      await s3.send(new HeadBucketCommand({ Bucket: storageConfig.bucket }));
    } catch {
      checks.storage = "error";
    }

    // 전체 상태 결정
    const hasError = checks.database === "error" || checks.storage === "error" || checks.websocket === "error";
    const status = hasError ? "degraded" : "ok";

    const body = { status, ...checks, timestamp };

    if (checks.database === "error" || checks.storage === "error") {
      reply.code(503);
    }

    return body;
  });

  // T-B01: 전역 에러 핸들러 - StandardError 를 표준 형식으로 변환
  app.setErrorHandler((error: Error, _request, reply) => {
    // Fastify validation 에러 (FST_ERR_VALIDATION)
    if ("validation" in error && (error as { validation: unknown }).validation) {
      reply.code(400).send({
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: error.message,
          statusCode: 400,
        },
      });
      return;
    }

    // StandardError 인스턴스
    if (error instanceof StandardError) {
      reply.code(error.statusCode).send({
        error: error.toJSON(),
      });
      return;
    }

    // 기타 에러: 500 Internal Error
    const statusCode = "statusCode" in error ? (error as { statusCode: number }).statusCode : 500;
    const message =
      appConfig.nodeEnv === "production"
        ? "내부 서버 오류"
        : error.message ?? "내부 서버 오류";

    reply.code(statusCode).send({
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message,
        statusCode: statusCode,
      },
    });
  });

  // API v1 routes
  app.register(v1Routes, { prefix: "/v1" });

  // @MX:NOTE 관리자 세션 + 라우트 (SPEC-WEB-001)
  await registerSessionPlugin(app);
  const adminDb = createDbClient();
  app.register(adminRoutes(adminDb.db), { prefix: "/admin/api" });

  // @MX:NOTE 정적 파일 서빙 (마지막에 등록, /v1/과 /admin/api/보다 우선순위 낮음)
  await registerStaticPlugin(app);

  // @MX:NOTE WebSocket 동기화 라우트 + LISTEN/NOTIFY 브릿지 (SPEC-P3-REALTIME-001)
  const { db } = createDbClient();
  const wsManager = await registerWebSocket(app, db, {
    heartbeatIntervalMs: appConfig.nodeEnv === "test" ? 1000 : 30_000,
    heartbeatTimeoutMs: appConfig.nodeEnv === "test" ? 3000 : 60_000,
  });

  // PG LISTEN/NOTIFY 브릿지 초기화
  const bridge = new RealtimeSyncBridge(wsManager, app.log);
  await bridge.start();

  // WS 매니저에 브릿지 연결 (클라이언트 연결/해제 시 브릿지에 알림)
  wsManager.setBridge(bridge);

  // NOTIFY용 글로벌 PG 클라이언트 설정
  const notifyClient = postgres(databaseConfig.url);
  setNotifyClient(notifyClient as Sql.Sql);

  // 서버 종료 시 정리
  app.addHook("onClose", async () => {
    try {
      await bridge.stop();
    } catch {
      // 브릿지 정리 에러 무시
    }
    try {
      await notifyClient.end();
    } catch {
      // 연결 종료 에러 무시
    }
  });

  return app;
}

export async function startApp() {
  const app = await buildApp();

  try {
    await app.listen({ port: appConfig.port, host: appConfig.host });
    app.log.info(`Vector server running on ${appConfig.host}:${appConfig.port}`);
    app.log.info(`Database: ${databaseConfig.url.replace(/:[^:@]+@/, ":****@")}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  return app;
}
