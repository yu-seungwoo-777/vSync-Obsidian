// PG LISTEN/NOTIFY 브릿지 서비스

import postgres from "postgres";
import { databaseConfig } from "../config/database.js";
import type { WebSocketManager } from "./websocket.js";
import type { FastifyInstance } from "fastify";

/**
 * @MX:NOTE RealtimeSyncBridge: PG LISTEN → WS 브로드캐스트 브릿지
 * 전용 PG 연결에서 LISTEN하여 WS 클라이언트에게 이벤트를 푸시
 */
export class RealtimeSyncBridge {
  private _wsManager: WebSocketManager;
  private _log: FastifyInstance["log"];
  private _sql: ReturnType<typeof postgres> | null = null;
  private _listened_vaults = new Map<string, { unlisten(): void }>(); // vaultId → ListenMeta

  constructor(wsManager: WebSocketManager, log: FastifyInstance["log"]) {
    this._wsManager = wsManager;
    this._log = log;
  }

  /** 브릿지 시작: 전용 PG 연결 생성 */
  async start(): Promise<void> {
    await this._connect();
  }

  /** 브릿지 중지: 모든 LISTEN 해제, 연결 종료 */
  async stop(): Promise<void> {
    // 모든 LISTEN 해제 (await 필요: postgres .end() 전에 정리해야 함)
    const unlistenPromises: Promise<void>[] = [];
    for (const [vaultId, meta] of this._listened_vaults) {
      unlistenPromises.push(
        Promise.resolve(meta.unlisten()).catch(() => {
          this._log.info(`[LISTEN] Unlisten error (ignored): vault=${vaultId}`);
        })
      );
    }
    await Promise.all(unlistenPromises);
    this._listened_vaults.clear();

    // PG 연결 종료
    if (this._sql) {
      try {
        await this._sql.end();
      } catch {
        // 연결 종료 에러 무시 (이미 파괴된 연결)
      }
      this._sql = null;
    }
  }

  /** WS 클라이언트가 vault에 연결 시 호출 */
  onClientConnect(vaultId: string): void {
    if (!this._listened_vaults.has(vaultId)) {
      this._listenToVault(vaultId);
    }
  }

  /** WS 클라이언트가 vault에서 해제 시 호출 */
  onClientDisconnect(vaultId: string): void {
    const meta = this._listened_vaults.get(vaultId);
    if (meta) {
      try {
        meta.unlisten();
      } catch {
        // 무시
      }
      this._listened_vaults.delete(vaultId);
      this._log.info(`[LISTEN] Unlistened: vault=${vaultId}`);
    }
  }

  /** 특정 vault를 LISTEN 중인지 확인 */
  isListeningTo(vaultId: string): boolean {
    return this._listened_vaults.has(vaultId);
  }

  /** 전용 PG 연결 생성 */
  private async _connect(): Promise<void> {
    this._sql = postgres(databaseConfig.url);
    this._log.info("[LISTEN] Dedicated PG connection established");
  }

  /** vault 채널 LISTEN 시작 */
  private _listenToVault(vaultId: string): void {
    if (!this._sql) {
      this._log.error("[LISTEN] No PG connection available");
      return;
    }

    const channel = `vault_sync_${vaultId}`;

    this._sql.listen(channel, (payload) => {
      this._onNotification(vaultId, payload);
    }).then((meta) => {
      this._listened_vaults.set(vaultId, meta);
      this._log.info(`[LISTEN] Listening: vault=${vaultId}, channel=${channel}`);
    }).catch((error) => {
      this._log.error(`[LISTEN] Failed to listen on ${channel}: ${error}`);
    });
  }

  /** NOTIFICATION 수신 시 WS 클라이언트에 브로드캐스트 */
  private _onNotification(vaultId: string, payload: string): void {
    try {
      const data = JSON.parse(payload);

      // WS 브로드캐스트 메시지 포맷
      const message = JSON.stringify({
        type: "sync_event",
        data: {
          id: data.event_id,
          event_type: data.event_type,
          file_path: data.file_path,
          file_type: data.file_type,
          device_id: data.device_id,
          created_at: data.timestamp,
        },
      });

      this._wsManager.broadcastToVault(vaultId, message);
    } catch (error) {
      this._log.error(`[LISTEN] Error processing notification: ${error}`);
    }
  }
}
