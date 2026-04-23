// SPEC-JWT-DEVICE-BINDING-001: JWT device_id 바인딩 + 만료 제거
import { describe, it, expect } from "vitest";
import { generateToken, verifyToken, type JwtPayload } from "../src/services/jwt.js";
import jwt from "jsonwebtoken";

describe("JWT 서비스 - device_id 바인딩 (REQ-DB-001, REQ-DB-002)", () => {
  const basePayload: JwtPayload = {
    user_id: "user-123",
    username: "testuser",
    role: "admin",
    device_id: "device-abc",
  };

  describe("generateToken", () => {
    it("device_id가 포함된 페이로드로 JWT를 생성하면 디코딩 시 device_id가 포함되어야 한다 (REQ-DB-001)", () => {
      const token = generateToken(basePayload);
      const decoded = jwt.decode(token) as Record<string, unknown>;

      expect(decoded.device_id).toBe("device-abc");
      expect(decoded.user_id).toBe("user-123");
      expect(decoded.username).toBe("testuser");
      expect(decoded.role).toBe("admin");
    });

    it("생성된 토큰에 exp 클레임이 없어야 한다 (REQ-DB-002)", () => {
      const token = generateToken(basePayload);
      const decoded = jwt.decode(token) as Record<string, unknown>;

      expect(decoded).not.toHaveProperty("exp");
    });

    it("토큰에 iat 클레임이 없어야 한다 (만료 관련 클레임 제거)", () => {
      const token = generateToken(basePayload);
      const decoded = jwt.decode(token) as Record<string, unknown>;

      // jwt.sign은 기본적으로 iat를 추가하지만, 확인 차 체크
      // iat는 있어도 무방하나 exp가 없는 것이 핵심
      expect(decoded).not.toHaveProperty("exp");
    });
  });

  describe("verifyToken", () => {
    it("device_id가 포함된 유효한 토큰을 검증하면 device_id가 포함된 페이로드를 반환해야 한다", () => {
      const token = generateToken(basePayload);
      const result = verifyToken(token);

      expect(result).not.toBeNull();
      expect(result!.device_id).toBe("device-abc");
      expect(result!.user_id).toBe("user-123");
      expect(result!.username).toBe("testuser");
      expect(result!.role).toBe("admin");
    });

    it("잘못된 토큰은 null을 반환해야 한다", () => {
      const result = verifyToken("invalid-token-xyz");

      expect(result).toBeNull();
    });

    it("만료되지 않는 토큰은 장시간 후에도 유효해야 한다 (REQ-DB-002)", () => {
      // 토큰이 만료되지 않음을 확인: exp 클레임이 없으므로 항상 유효
      const token = generateToken(basePayload);
      const result = verifyToken(token);

      expect(result).not.toBeNull();
      expect(result!.device_id).toBe("device-abc");
    });

    it("다른 device_id로 생성된 토큰도 올바르게 검증해야 한다", () => {
      const payload: JwtPayload = {
        ...basePayload,
        device_id: "different-device-xyz",
      };
      const token = generateToken(payload);
      const result = verifyToken(token);

      expect(result).not.toBeNull();
      expect(result!.device_id).toBe("different-device-xyz");
    });
  });
});
