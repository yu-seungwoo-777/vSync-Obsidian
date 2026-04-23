import { describe, it, expect } from "vitest";
import {
  StandardError,
  ERROR_CODES,
} from "../src/utils/errors.js";

describe("StandardError", () => {
  it("Error 클래스를 상속한다", () => {
    const err = new StandardError(ERROR_CODES.VALIDATION_ERROR, "test message", 400);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(StandardError);
  });

  it("code, message, statusCode 속성을 가진다", () => {
    const err = new StandardError("VALIDATION_ERROR", "잘못된 입력", 400);
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.message).toBe("잘못된 입력");
    expect(err.statusCode).toBe(400);
  });

  it("toJSON() 이 { code, message, statusCode } 를 반환한다", () => {
    const err = new StandardError("NOT_FOUND", "파일을 찾을 수 없습니다", 404);
    const json = err.toJSON();
    expect(json).toEqual({
      code: "NOT_FOUND",
      message: "파일을 찾을 수 없습니다",
      statusCode: 404,
    });
  });

  it("에러 이름이 'StandardError' 이다", () => {
    const err = new StandardError(ERROR_CODES.INTERNAL_ERROR, "test", 500);
    expect(err.name).toBe("StandardError");
  });

  it("try/catch 로 잡을 수 있다", () => {
    const throw_it = () => {
      throw new StandardError("UNAUTHORIZED", "인증 필요", 401);
    };

    expect(throw_it).toThrow(StandardError);
    expect(throw_it).toThrow("인증 필요");
  });
});

describe("ERROR_CODES", () => {
  it("VALIDATION_ERROR 가 존재한다", () => {
    expect(ERROR_CODES).toHaveProperty("VALIDATION_ERROR");
  });

  it("NOT_FOUND 가 존재한다", () => {
    expect(ERROR_CODES).toHaveProperty("NOT_FOUND");
  });

  it("UNAUTHORIZED 가 존재한다", () => {
    expect(ERROR_CODES).toHaveProperty("UNAUTHORIZED");
  });

  it("PAYLOAD_TOO_LARGE 가 존재한다", () => {
    expect(ERROR_CODES).toHaveProperty("PAYLOAD_TOO_LARGE");
  });

  it("RATE_LIMITED 가 존재한다", () => {
    expect(ERROR_CODES).toHaveProperty("RATE_LIMITED");
  });

  it("CONFLICT 가 존재한다", () => {
    expect(ERROR_CODES).toHaveProperty("CONFLICT");
  });

  it("INTERNAL_ERROR 가 존재한다", () => {
    expect(ERROR_CODES).toHaveProperty("INTERNAL_ERROR");
  });

  it("FORBIDDEN 이 존재한다", () => {
    expect(ERROR_CODES).toHaveProperty("FORBIDDEN");
    expect(ERROR_CODES.FORBIDDEN).toBe("FORBIDDEN");
  });

  it("TOO_MANY_REQUESTS 가 존재한다", () => {
    expect(ERROR_CODES).toHaveProperty("TOO_MANY_REQUESTS");
    expect(ERROR_CODES.TOO_MANY_REQUESTS).toBe("TOO_MANY_REQUESTS");
  });

  it("모든 에러 코드가 문자열이다", () => {
    const codes = Object.values(ERROR_CODES);
    for (const code of codes) {
      expect(typeof code).toBe("string");
    }
  });
});

describe("StandardError 팩토리 패턴", () => {
  it("VALIDATION_ERROR 로 생성 시 400 상태 코드를 가진다", () => {
    const err = new StandardError(
      ERROR_CODES.VALIDATION_ERROR,
      "검증 실패",
      400,
    );
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe(ERROR_CODES.VALIDATION_ERROR);
  });

  it("NOT_FOUND 로 생성 시 404 상태 코드를 가진다", () => {
    const err = new StandardError(ERROR_CODES.NOT_FOUND, "없음", 404);
    expect(err.statusCode).toBe(404);
  });

  it("UNAUTHORIZED 로 생성 시 401 상태 코드를 가진다", () => {
    const err = new StandardError(ERROR_CODES.UNAUTHORIZED, "인증 필요", 401);
    expect(err.statusCode).toBe(401);
  });

  it("PAYLOAD_TOO_LARGE 로 생성 시 413 상태 코드를 가진다", () => {
    const err = new StandardError(
      ERROR_CODES.PAYLOAD_TOO_LARGE,
      "크기 초과",
      413,
    );
    expect(err.statusCode).toBe(413);
  });

  it("RATE_LIMITED 로 생성 시 429 상태 코드를 가진다", () => {
    const err = new StandardError(
      ERROR_CODES.RATE_LIMITED,
      "요청 제한",
      429,
    );
    expect(err.statusCode).toBe(429);
  });

  it("CONFLICT 로 생성 시 409 상태 코드를 가진다", () => {
    const err = new StandardError(ERROR_CODES.CONFLICT, "충돌", 409);
    expect(err.statusCode).toBe(409);
  });

  it("INTERNAL_ERROR 로 생성 시 500 상태 코드를 가진다", () => {
    const err = new StandardError(
      ERROR_CODES.INTERNAL_ERROR,
      "서버 오류",
      500,
    );
    expect(err.statusCode).toBe(500);
  });
});
