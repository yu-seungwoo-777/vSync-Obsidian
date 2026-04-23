import { describe, it, expect } from "vitest";
import { adminCredentials } from "../src/db/schemas/admin-credentials.js";
import { vaults } from "../src/db/schemas/vaults.js";

describe("T-001: DB Schema - admin_credentials 테이블", () => {
  it("adminCredentials 스키마가 올바른 컬럼을 가진다", () => {
    expect(adminCredentials).toBeDefined();
    expect(adminCredentials.id).toBeDefined();
    expect(adminCredentials.username).toBeDefined();
    expect(adminCredentials.passwordHash).toBeDefined();
    expect(adminCredentials.createdAt).toBeDefined();
  });

  it("adminCredentials의 컬럼 타입이 명세와 일치한다", () => {
    // 스키마 객체의 컬럼 정보 확인
    const columns = Object.keys(adminCredentials);
    expect(columns).toContain("id");
    expect(columns).toContain("username");
    expect(columns).toContain("passwordHash");
    expect(columns).toContain("createdAt");
  });

  it("adminCredentials 스키마에 role 필드가 존재한다 (REQ-RBAC-001 AC-001)", () => {
    expect(adminCredentials.role).toBeDefined();
  });
});

describe("T-001: DB Schema - vaults 테이블", () => {
  it("vaults 스키마가 올바른 컬럼을 가진다", () => {
    expect(vaults).toBeDefined();
    expect(vaults.id).toBeDefined();
    expect(vaults.name).toBeDefined();
    expect(vaults.createdBy).toBeDefined();
    expect(vaults.createdAt).toBeDefined();
    expect(vaults.updatedAt).toBeDefined();
  });

  // API key 관련 컬럼은 제거됨
  it("vaults 스키마에 api_key 관련 필드가 존재하지 않는다", () => {
    const cols = Object.keys(vaults);
    expect(cols).not.toContain('apiKeyHash');
    expect(cols).not.toContain('apiKey');
    expect(cols).not.toContain('apiKeyPreview');
  });

  it("vaults 스키마에 createdBy 필드가 존재한다 (REQ-RBAC-002 AC-004)", () => {
    expect(vaults.createdBy).toBeDefined();
  });
});
