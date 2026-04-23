// WebSocket 연결 관리자

import type { FastifyInstance } from "fastify";
// @ts-expect-error ws has no type declarations in this project
import type { WebSocket } from "ws";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import { vaults } from "../db/schemas/index.js";
import { verifyToken } from "./jwt.js";
import type * as schema from "../db/schemas/index.js";

type DbType = PostgresJsDatabase<typeof schema>;

// @MX:NOTE 연결 제한 상수
const MAX_CONNECTIONS_PER_VAULT = 10;

// @MX:NOTE 하트비트 설정 (테스트에서 짧은 간격으로 오버라이드 가능)
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 60_000;

// WS close codes (커스텀: 4000-4999)
const CLOSE_AUTH_FAILED = 4001;
const CLOSE_CAPACITY_EXCEEDED = 4002;

// 연결별 하트비트 상태
interface HeartbeatState {
  lastPong: number;
  intervalId: ReturnType<typeof setInterval>;
  timeoutId: ReturnType<typeof setTimeout> | null;
}

/**
 * @MX:ANCHOR WebSocket 연결 관리자: vault별 연결 레지스트리, 인증, 하트비트
 * @MX:REASON 실시간 동기화의 핵심 컴포넌트, 모든 WS 연결을 관리
 */
export class WebSocketManager {
  // vaultId → Set<WebSocket> 연결 레지스트리
  private _connections = new Map<string, Set<WebSocket>>();
  // WebSocket → HeartbeatState 하트비트 상태
  private _heartbeatStates = new Map<WebSocket, HeartbeatState>();
  private _db: DbType;
  private _heartbeatIntervalMs: number;
  private _heartbeatTimeoutMs: number;
  private _bridge: import("./realtime-sync.js").RealtimeSyncBridge | null = null;

  constructor(
    db: DbType,
    options?: {
      heartbeatIntervalMs?: number;
      heartbeatTimeoutMs?: number;
    },
  ) {
    this._db = db;
    this._heartbeatIntervalMs =
      options?.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this._heartbeatTimeoutMs =
      options?.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;
  }

  /** LISTEN/NOTIFY 브릿지 설정 */
  setBridge(bridge: import("./realtime-sync.js").RealtimeSyncBridge): void {
    this._bridge = bridge;
  }

  /** vaultId의 현재 연결 수 */
  getConnectionCount(vaultId: string): number {
    return this._connections.get(vaultId)?.size ?? 0;
  }

  /** vaultId에 연결된 모든 클라이언트에 메시지 브로드캐스트 */
  broadcastToVault(vaultId: string, message: string): void {
    const connections = this._connections.get(vaultId);
    if (!connections) return;

    for (const ws of connections) {
      if (ws.readyState === 1) {
        // WebSocket.OPEN = 1
        ws.send(message);
      }
    }
  }

  /** WS 연결 핸들러 (Fastify WS 라우트에서 호출) */
  async handleConnection(
    ws: WebSocket,
    vaultId: string,
    log: FastifyInstance["log"],
  ): Promise<void> {
    // 연결 제한 확인
    const currentCount = this.getConnectionCount(vaultId);
    if (currentCount >= MAX_CONNECTIONS_PER_VAULT) {
      ws.close(CLOSE_CAPACITY_EXCEEDED, "Capacity Exceeded");
      return;
    }

    // 연결 등록
    this._registerConnection(vaultId, ws);

    // 브릿지에 클라이언트 연결 알림 (LISTEN 활성화)
    if (this._bridge) {
      this._bridge.onClientConnect(vaultId);
    }

    // connected 메시지 전송
    ws.send(
      JSON.stringify({
        type: "connected",
        vault_id: vaultId,
        timestamp: new Date().toISOString(),
      }),
    );

    log.info(
      `[WS] Connected: vault=${vaultId}, total=${this.getConnectionCount(vaultId)}`,
    );

    // 하트비트 시작
    this._startHeartbeat(ws, vaultId, log);

    // 연결 해제 처리
    ws.on("close", (code: number) => {
      this._stopHeartbeat(ws);
      this._removeConnection(vaultId, ws);
      // 브릿지에 클라이언트 해제 알림 (필요시 UNLISTEN)
      if (this._bridge && this.getConnectionCount(vaultId) === 0) {
        this._bridge.onClientDisconnect(vaultId);
      }
      log.info(
        `[WS] Disconnected: vault=${vaultId}, total=${this.getConnectionCount(vaultId)}, code=${code}`,
      );
    });

    ws.on("error", () => {
      this._stopHeartbeat(ws);
      this._removeConnection(vaultId, ws);
      if (this._bridge && this.getConnectionCount(vaultId) === 0) {
        this._bridge.onClientDisconnect(vaultId);
      }
    });

    // 클라이언트 ping 메시지 처리 (애플리케이션 레벨)
    ws.on("message", (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
        }
      } catch {
        // 파싱 불가한 메시지는 무시
      }
    });
  }

  /** 인증 (JWT 토큰) */
  async authenticateConnection(
    token: string,
    vaultId: string,
  ): Promise<boolean> {
    // JWT 토큰 인증
    const jwtPayload = verifyToken(token);
    if (jwtPayload) {
      // 볼트 존재 여부 확인
      const result = await this._db
        .select()
        .from(vaults)
        .where(eq(vaults.id, vaultId))
        .limit(1);
      if (result.length === 0) return false;

      // 관리자는 모든 볼트 접근 허용
      if (jwtPayload.role === 'admin') return true;
      // 일반 사용자는 createdBy가 본인인 볼트만
      return result[0].createdBy === jwtPayload.user_id;
    }

    return false;
  }

  /** 연결 등록 */
  private _registerConnection(vaultId: string, ws: WebSocket): void {
    if (!this._connections.has(vaultId)) {
      this._connections.set(vaultId, new Set());
    }
    this._connections.get(vaultId)!.add(ws);
  }

  /** 연결 제거 */
  private _removeConnection(vaultId: string, ws: WebSocket): void {
    const connections = this._connections.get(vaultId);
    if (connections) {
      connections.delete(ws);
      if (connections.size === 0) {
        this._connections.delete(vaultId);
      }
    }
  }

  /** 하트비트 시작 */
  private _startHeartbeat(
    ws: WebSocket,
    vaultId: string,
    log: FastifyInstance["log"],
  ): void {
    let terminated = false;

    const state: HeartbeatState = {
      lastPong: Date.now(),
      intervalId: setInterval(() => {
        if (terminated || ws.readyState !== 1) {
          // OPEN
          this._stopHeartbeat(ws);
          return;
        }

        // ping 전송
        try {
          ws.ping();
        } catch {
          this._stopHeartbeat(ws);
          return;
        }

        // 타임아웃 확인 (ping 전송 후 이전 pong로부터 경과 시간 체크)
        const elapsed = Date.now() - state.lastPong;
        if (elapsed > this._heartbeatTimeoutMs) {
          log.info(
            `[WS] Heartbeat timeout: vault=${vaultId}, elapsed=${elapsed}ms, terminating connection`,
          );
          terminated = true;
          this._stopHeartbeat(ws);
          // terminate가 close 이벤트를 트리거하지 않을 수 있으므로 cleanup 직접 호출
          this._removeConnection(vaultId, ws);
          ws.terminate();
          return;
        }
      }, this._heartbeatIntervalMs),
      timeoutId: null,
    };

    // pong 리스너
    ws.on("pong", () => {
      state.lastPong = Date.now();
    });

    this._heartbeatStates.set(ws, state);
  }

  /** 하트비트 중지 */
  private _stopHeartbeat(ws: WebSocket): void {
    const state = this._heartbeatStates.get(ws);
    if (state) {
      clearInterval(state.intervalId);
      if (state.timeoutId) {
        clearTimeout(state.timeoutId);
      }
      this._heartbeatStates.delete(ws);
    }
  }
}

/**
 * @MX:NOTE WS 라우트 등록: app.ts에서 호출하여 WS 엔드포인트 추가
 */
export async function registerWebSocket(
  app: FastifyInstance,
  db: DbType,
  options?: {
    heartbeatIntervalMs?: number;
    heartbeatTimeoutMs?: number;
  },
): Promise<WebSocketManager> {
  // @fastify/websocket 플러그인 등록
  await app.register(import("@fastify/websocket"));

  const manager = new WebSocketManager(db, options);

  // WS 동기화 라우트
  app.get("/ws/sync/:vault_id", { websocket: true }, async (socket, request) => {
    const vaultId = (request.params as Record<string, string>).vault_id;
    const query = request.query as Record<string, string>;
    const token = query.token;

    // 인증 (JWT 토큰)
    if (!token) {
      socket.close(CLOSE_AUTH_FAILED, "Authentication required");
      return;
    }

    const authenticated = await manager.authenticateConnection(token, vaultId);
    if (!authenticated) {
      socket.close(CLOSE_AUTH_FAILED, "Authentication failed");
      return;
    }

    // 연결 처리
    await manager.handleConnection(socket as unknown as WebSocket, vaultId, app.log);
  });

  return manager;
}
