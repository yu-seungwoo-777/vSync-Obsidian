import { describe, it, expect } from "vitest";
import {
  validateVaultPath,
  validateSize,
  MAX_RAW_SIZE,
  MAX_ATTACHMENT_SIZE,
  MAX_EDIT_SIZE,
  MAX_SEARCH_QUERY_LENGTH,
} from "../src/utils/validation.js";

describe("validateVaultPath", () => {
  describe("유효한 경로", () => {
    it("일반 영어 경로를 허용한다", () => {
      const result = validateVaultPath("notes/project.md");
      expect(result).toEqual({ valid: true });
    });

    it("루트 파일 경로를 허용한다", () => {
      const result = validateVaultPath("readme.md");
      expect(result).toEqual({ valid: true });
    });

    it("유니코드 경로(한글)를 허용한다", () => {
      const result = validateVaultPath("노트/프로젝트.md");
      expect(result).toEqual({ valid: true });
    });

    it("공백이 포함된 경로를 허용한다", () => {
      const result = validateVaultPath("my notes/daily note.md");
      expect(result).toEqual({ valid: true });
    });

    it("깊이가 깊은 경로를 허용한다", () => {
      const result = validateVaultPath("a/b/c/d/e/f/g/file.md");
      expect(result).toEqual({ valid: true });
    });

    it("다양한 확장자를 허용한다", () => {
      expect(validateVaultPath("image.png")).toEqual({ valid: true });
      expect(validateVaultPath("data.json")).toEqual({ valid: true });
      expect(validateVaultPath("doc.pdf")).toEqual({ valid: true });
    });

    it("빈 문자열 경로를 허용한다", () => {
      const result = validateVaultPath("");
      expect(result).toEqual({ valid: true });
    });
  });

  describe("유효하지 않은 경로", () => {
    it(".. 경로 순회를 차단한다", () => {
      const result = validateVaultPath("../etc/passwd");
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toBeDefined();
        expect(typeof result.reason).toBe("string");
      }
    });

    it("중간에 .. 이 포함된 경로를 차단한다", () => {
      const result = validateVaultPath("notes/../../etc/passwd");
      expect(result.valid).toBe(false);
    });

    it("인코딩된 .. 경로 순회를 차단한다 (%2e%2e)", () => {
      const result = validateVaultPath("%2e%2e/etc/passwd");
      expect(result.valid).toBe(false);
    });

    it("절대 경로를 차단한다 (/로 시작)", () => {
      const result = validateVaultPath("/etc/passwd");
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toBeDefined();
      }
    });

    it("null byte를 차단한다", () => {
      const result = validateVaultPath("file\0.md");
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toBeDefined();
      }
    });

    it("경로 중간에 null byte가 있어도 차단한다", () => {
      const result = validateVaultPath("notes/\0/secret.md");
      expect(result.valid).toBe(false);
    });

    it("경로 깊이가 20단계를 초과하면 차단한다", () => {
      // 21 세그먼트 (20 단계 디렉토리 + 파일 = 21) 초과
      const deepPath = Array(21).fill("a").join("/") + "/file.md";
      const result = validateVaultPath(deepPath);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain("깊이");
      }
    });

    it("경로 깊이가 정확히 20단계면 허용한다", () => {
      // 정확히 20 세그먼트 경로
      const maxPath = Array(19).fill("a").join("/") + "/file.md";
      const result = validateVaultPath(maxPath);
      expect(result).toEqual({ valid: true });
    });

    it("경로 길이가 500자를 초과하면 차단한다", () => {
      const long_path = "a".repeat(501) + ".md";
      const result = validateVaultPath(long_path);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toContain("길이");
      }
    });

    it("경로 길이가 정확히 500자면 허용한다", () => {
      // 정확히 500자 경로 생성 (497 글자 + ".md" 3글자 = 500)
      const fiveHundred = "a".repeat(497) + ".md";
      expect(fiveHundred.length).toBe(500);
      const result = validateVaultPath(fiveHundred);
      expect(result).toEqual({ valid: true });
    });
  });
});

describe("Size limit constants", () => {
  it("MAX_RAW_SIZE 는 10MB 이다", () => {
    expect(MAX_RAW_SIZE).toBe(10 * 1024 * 1024);
  });

  it("MAX_ATTACHMENT_SIZE 는 50MB 이다", () => {
    expect(MAX_ATTACHMENT_SIZE).toBe(50 * 1024 * 1024);
  });

  it("MAX_EDIT_SIZE 는 1MB 이다", () => {
    expect(MAX_EDIT_SIZE).toBe(1 * 1024 * 1024);
  });

  it("MAX_SEARCH_QUERY_LENGTH 는 500 이다", () => {
    expect(MAX_SEARCH_QUERY_LENGTH).toBe(500);
  });
});

describe("validateSize", () => {
  it("raw 타입: 크기가 제한 이내면 valid 를 반환한다", () => {
    const result = validateSize("raw", 1024);
    expect(result).toEqual({ valid: true });
  });

  it("raw 타입: 크기가 제한을 초과하면 invalid 를 반환한다", () => {
    const result = validateSize("raw", MAX_RAW_SIZE + 1);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBeDefined();
    }
  });

  it("attachment 타입: 크기가 제한 이내면 valid 를 반환한다", () => {
    const result = validateSize("attachment", 1024 * 1024);
    expect(result).toEqual({ valid: true });
  });

  it("attachment 타입: 크기가 제한을 초과하면 invalid 를 반환한다", () => {
    const result = validateSize("attachment", MAX_ATTACHMENT_SIZE + 1);
    expect(result.valid).toBe(false);
  });

  it("edit 타입: 크기가 제한 이내면 valid 를 반환한다", () => {
    const result = validateSize("edit", 512 * 1024);
    expect(result).toEqual({ valid: true });
  });

  it("edit 타입: 크기가 제한을 초과하면 invalid 를 반환한다", () => {
    const result = validateSize("edit", MAX_EDIT_SIZE + 1);
    expect(result.valid).toBe(false);
  });

  it("search 타입: 길이가 제한 이내면 valid 를 반환한다", () => {
    const result = validateSize("search", 100);
    expect(result).toEqual({ valid: true });
  });

  it("search 타입: 길이가 제한을 초과하면 invalid 를 반환한다", () => {
    const result = validateSize("search", MAX_SEARCH_QUERY_LENGTH + 1);
    expect(result.valid).toBe(false);
  });

  it("경계값: raw 정확히 10MB 는 valid 이다", () => {
    const result = validateSize("raw", MAX_RAW_SIZE);
    expect(result).toEqual({ valid: true });
  });

  it("경계값: attachment 정확히 50MB 는 valid 이다", () => {
    const result = validateSize("attachment", MAX_ATTACHMENT_SIZE);
    expect(result).toEqual({ valid: true });
  });

  it("경계값: edit 정확히 1MB 는 valid 이다", () => {
    const result = validateSize("edit", MAX_EDIT_SIZE);
    expect(result).toEqual({ valid: true });
  });

  it("경계값: search 정확히 500 은 valid 이다", () => {
    const result = validateSize("search", MAX_SEARCH_QUERY_LENGTH);
    expect(result).toEqual({ valid: true });
  });
});
