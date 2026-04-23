import { describe, it, expect, vi, beforeEach } from "vitest";

// REQ-SRV-001: S3 클라이언트 싱글턴 패턴 테스트
describe("S3 클라이언트 싱글턴", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("getStorageClient을 여러 번 호출해도 동일한 인스턴스를 반환한다", async () => {
    const { getStorageClient } = await import("../src/config/storage.js");
    const client1 = getStorageClient();
    const client2 = getStorageClient();
    expect(client1).toBe(client2);
  });

  it("resetStorageClient 호출 후 새 인스턴스를 생성한다", async () => {
    const { getStorageClient, resetStorageClient } = await import("../src/config/storage.js");
    const client1 = getStorageClient();
    resetStorageClient();
    const client2 = getStorageClient();
    expect(client1).not.toBe(client2);
  });

  it("생성된 싱글턴 인스턴스는 S3Client 타입이다", async () => {
    const { getStorageClient } = await import("../src/config/storage.js");
    const client = getStorageClient();
    // S3Client 인스턴스는 send 메서드를 가짐
    expect(client).toHaveProperty("send");
    expect(typeof client.send).toBe("function");
  });
});
