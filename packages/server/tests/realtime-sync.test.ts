// LISTEN/NOTIFY 통합 테스트
// T4: REQ-P3-005 - 동기화 이벤트 생성 시 NOTIFY 발행
// T5: REQ-P3-006, REQ-P3-007 - PG LISTEN 브릿지
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";
/* eslint-disable @typescript-eslint/no-explicit-any */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import WsLib from "ws";
const ws_lib = WsLib as any;
import postgres from "postgres";
import { createDbClient } from "../src/config/database.js";
import {
  createSyncEvent,
  setNotifyClient,
} from "../src/services/sync-event.js";
import { RealtimeSyncBridge } from "../src/services/realtime-sync.js";
import { WebSocketManager } from "../src/services/websocket.js";
import { createTestVault } from "./setup.js";
import { setupTestAuth, authHeaders, cleanupTestAuth } from "./helpers/jwt-auth.js";

function connect_ws(
  port: number,
  vault_id: string,
  token: string,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const ws = new ws_lib(
      `ws://localhost:${port}/ws/sync/${vault_id}?token=${token}`,
    );
    ws.on("open", () => resolve(ws));
    ws.on("error", (err: any) => reject(err));
  });
}

function wait_for_message(ws: any, timeout = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Message timeout")),
      timeout,
    );
    ws.on("message", (data: any) => {
      clearTimeout(timer);
      resolve(data.toString());
    });
    ws.on("close", () => {
      clearTimeout(timer);
      reject(new Error("Connection closed before message"));
    });
  });
}

describe("Realtime Sync - LISTEN/NOTIFY", () => {
  let app: FastifyInstance;
  let vault_id: string;
  let jwt_token: string;
  let vault2_id: string;
  let port: number;
  const { client, db } = createDbClient();

  // LISTEN용 별도 연결
  let listener_sql: ReturnType<typeof postgres>;
  let bridge: RealtimeSyncBridge;
  let ws_manager: WebSocketManager;

  beforeAll(async () => {
    app = await buildApp();
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    port = typeof address === "object" && address ? address.port : 0;

    // JWT 토큰 획득
    jwt_token = await setupTestAuth(app);

    // 테스트용 볼트 생성
    const vault1 = await createTestVault(app, "realtime-test-vault");
    vault_id = vault1.vault_id;

    // 두 번째 볼트
    const vault2 = await createTestVault(app, "realtime-test-vault-2");
    vault2_id = vault2.vault_id;

    // LISTEN용 별도 postgres 연결
    listener_sql = postgres(process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/obsidiansync");

    // NOTIFY 활성화: set_notify_client로 글로벌 클라이언트 설정
    setNotifyClient(listener_sql as any);

    // WebSocketManager와 RealtimeSyncBridge 초기화
    ws_manager = new WebSocketManager(db);
    bridge = new RealtimeSyncBridge(ws_manager, app.log);
    await bridge.start();
  });

  afterAll(async () => {
    await bridge?.stop();
    setNotifyClient(null);
    await cleanupTestAuth();
    await app.close();
    if (listener_sql) await listener_sql.end();
    await client.end();
  });

  // ============================================================
  // T4: PG NOTIFY in Sync Event
  // ============================================================

  describe("T4: PG NOTIFY in Sync Event (REQ-P3-005)", () => {
    it("createSyncEvent 후 NOTIFY를 수신해야 한다", async () => {
      const channel = `vault_sync_${vault_id}`;

      // 파일 업로드
      const file_res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: authHeaders(jwt_token),
        payload: {
          path: "notes/notify-test.md",
          content: "# Notify Test",
          hash: "notify123",
        },
      });
      const file_id = file_res.json().id;

      // LISTEN 설정
      const notification_promise = new Promise<string>((resolve) => {
        listener_sql.listen(channel, (payload) => {
          resolve(payload);
        });
      });

      await new Promise((r) => setTimeout(r, 200));

      // 이벤트 생성 (NOTIFY 포함)
      await createSyncEvent(db, vault_id, file_id, "created", "device-notify-test");

      const payload = await notification_promise;
      const parsed = JSON.parse(payload);
      expect(parsed.event_id).toBeDefined();
      expect(parsed.event_type).toBe("created");
      expect(parsed.file_path).toBe("notes/notify-test.md");
      expect(parsed.device_id).toBe("device-notify-test");
      expect(parsed.timestamp).toBeDefined();
    }, 10000);

    it("NOTIFY 페이로드에 fileType이 포함되어야 한다", async () => {
      const channel = `vault_sync_${vault_id}`;

      const file_res = await app.inject({
        method: "GET",
        url: `/v1/vault/${vault_id}/files`,
        headers: authHeaders(jwt_token),
      });
      const files_list = file_res.json();
      const file_id = files_list[files_list.length - 1].id;

      const notification_promise = new Promise<string>((resolve) => {
        listener_sql.listen(channel, (payload) => {
          resolve(payload);
        });
      });

      await new Promise((r) => setTimeout(r, 200));
      await createSyncEvent(db, vault_id, file_id, "updated", "device-type-test");

      const payload = await notification_promise;
      const parsed = JSON.parse(payload);
      expect(parsed.file_type).toBeDefined();
    }, 10000);
  });

  // ============================================================
  // T5: PG LISTEN Bridge
  // ============================================================

  describe("T5: PG LISTEN Bridge (REQ-P3-006, REQ-P3-007)", () => {
    it("첫 WS 클라이언트 연결 시 LISTEN이 시작되어야 한다", async () => {
      // WS 연결
      const ws = await connect_ws(port, vault_id, jwt_token);
      await wait_for_message(ws, 3000); // connected 메시지 소비

      // 브릿지에 vault LISTEN 등록 요청
      bridge.onClientConnect(vault_id);

      // LISTEN이 활성화될 때까지 대기
      await new Promise((r) => setTimeout(r, 300));

      // 이벤트 생성 후 WS 클라이언트가 수신하는지 확인
      const file_res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: authHeaders(jwt_token),
        payload: {
          path: "notes/bridge-test.md",
          content: "# Bridge Test",
          hash: "bridge123",
        },
      });
      const file_id = file_res.json().id;

      // WS에서 sync_event 메시지 수신 대기
      const msg_promise = wait_for_message(ws, 5000);

      // 이벤트 생성 (NOTIFY → LISTEN → 브릿지 → WS broadcast)
      await createSyncEvent(db, vault_id, file_id, "created", "device-bridge-test");

      const msg = await msg_promise;
      const parsed = JSON.parse(msg);
      expect(parsed.type).toBe("sync_event");
      expect(parsed.data).toBeDefined();
      expect(parsed.data.event_type).toBe("created");
      expect(parsed.data.file_path).toBe("notes/bridge-test.md");

      ws.close();
    }, 10000);

    it("마지막 WS 클라이언트 해제 시 UNLISTEN되어야 한다", async () => {
      // LISTEN 상태 확인: 먼저 클라이언트 연결
      bridge.onClientConnect(vault_id);
      await new Promise((r) => setTimeout(r, 200));

      // 클라이언트 해제
      bridge.onClientDisconnect(vault_id);
      await new Promise((r) => setTimeout(r, 200));

      // UNLISTEN 후에는 이벤트 생성해도 브릿지가 수신하지 않아야 함
      // (새 이벤트 생성 후 WS로 전달되지 않음)
      // 이 테스트는 UNLISTEN이 에러 없이 실행됨을 확인
      expect(bridge.isListeningTo(vault_id)).toBe(false);
    });

    it("서로 다른 vault의 이벤트는 분리되어야 한다", async () => {
      // Vault 1에 연결
      const ws1 = await connect_ws(port, vault_id, jwt_token);
      await wait_for_message(ws1, 3000);
      bridge.onClientConnect(vault_id);

      // Vault 2에 연결
      const ws2 = await connect_ws(port, vault2_id, jwt_token);
      await wait_for_message(ws2, 3000);
      bridge.onClientConnect(vault2_id);

      await new Promise((r) => setTimeout(r, 300));

      // Vault 1에 파일 업로드
      const file1_res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: authHeaders(jwt_token),
        payload: {
          path: "notes/vault1-isolation.md",
          content: "# Vault 1",
          hash: "vault1iso",
        },
      });
      const file1_id = file1_res.json().id;

      // WS1만 메시지를 수신해야 함
      const msg1_promise = wait_for_message(ws1, 5000);

      // WS2가 vault2 이벤트가 아닌 것을 수신하지 않아야 함
      let ws2_received_event = false;
      ws2.on("message", () => { ws2_received_event = true; });

      await createSyncEvent(db, vault_id, file1_id, "created", "device-isolation-test");

      const msg1 = await msg1_promise;
      const parsed1 = JSON.parse(msg1);
      expect(parsed1.type).toBe("sync_event");

      // WS2는 짧은 시간 내에 이벤트를 받지 않아야 함
      await new Promise((r) => setTimeout(r, 500));
      expect(ws2_received_event).toBe(false);

      ws1.close();
      ws2.close();
      bridge.onClientDisconnect(vault_id);
      bridge.onClientDisconnect(vault2_id);
    }, 10000);

    it("같은 vault의 여러 클라이언트가 모두 이벤트를 수신해야 한다", async () => {
      bridge.onClientConnect(vault_id);

      const ws1 = await connect_ws(port, vault_id, jwt_token);
      await wait_for_message(ws1, 3000);
      bridge.onClientConnect(vault_id);

      const ws2 = await connect_ws(port, vault_id, jwt_token);
      await wait_for_message(ws2, 3000);

      await new Promise((r) => setTimeout(r, 300));

      // 파일 업로드
      const file_res = await app.inject({
        method: "PUT",
        url: `/v1/vault/${vault_id}/file`,
        headers: authHeaders(jwt_token),
        payload: {
          path: "notes/multi-client.md",
          content: "# Multi Client",
          hash: "multiclient123",
        },
      });
      const file_id = file_res.json().id;

      // 두 클라이언트 모두 수신 대기
      const msg1_promise = wait_for_message(ws1, 5000);
      const msg2_promise = wait_for_message(ws2, 5000);

      await createSyncEvent(db, vault_id, file_id, "created", "device-multi-test");

      const [msg1, msg2] = await Promise.all([msg1_promise, msg2_promise]);
      expect(JSON.parse(msg1).type).toBe("sync_event");
      expect(JSON.parse(msg2).type).toBe("sync_event");

      ws1.close();
      ws2.close();
      bridge.onClientDisconnect(vault_id);
      bridge.onClientDisconnect(vault_id);
    }, 10000);
  });
});
