// @MX:NOTE 3-way merge 엔진 단위 테스트 (SPEC-P5-3WAY-001, T-002)
import { describe, it, expect } from "vitest";
import { attemptThreeWayMerge } from "../src/services/three-way-merge.js";

describe("SPEC-P5-3WAY-001 - 3-Way Merge 엔진 (T-002)", () => {
  // ─── AC-002.3: 다른 줄 수정 → 자동 병합 성공 ──────────
  describe("다른 줄 수정 시 자동 병합", () => {
    it("서로 다른 줄을 수정한 경우 양쪽 변경 모두 보존된다", () => {
      const base = "line1\nline2\nline3\nline4";
      const server = "LINE1\nline2\nline3\nline4"; // 서버: line1 수정
      const incoming = "line1\nline2\nLINE3\nline4"; // 클라이언트: line3 수정

      const result = attemptThreeWayMerge(base, server, incoming);

      expect(result.type).toBe("auto");
      if (result.type === "auto") {
        expect(result.content).toContain("LINE1"); // 서버 변경 보존
        expect(result.content).toContain("LINE3"); // 클라이언트 변경 보존
        expect(result.merge_type).toBe("auto");
      }
    });

    it("서버는 첫 줄 추가, 클라이언트는 마지막 줄 추가하는 경우 자동 병합된다", () => {
      const base = "line1\nline2";
      const server = "header\nline1\nline2"; // 서버: 첫 줄 추가
      const incoming = "line1\nline2\nfooter"; // 클라이언트: 마지막 줄 추가

      const result = attemptThreeWayMerge(base, server, incoming);

      expect(result.type).toBe("auto");
      if (result.type === "auto") {
        expect(result.content).toContain("header");
        expect(result.content).toContain("footer");
      }
    });

    it("서버는 줄 삭제, 클라이언트는 다른 줄 수정하는 경우 자동 병합된다", () => {
      const base = "line1\nline2\nline3";
      const server = "line1\nline3"; // 서버: line2 삭제
      const incoming = "LINE1\nline2\nline3"; // 클라이언트: line1 수정

      const result = attemptThreeWayMerge(base, server, incoming);

      expect(result.type).toBe("auto");
      if (result.type === "auto") {
        // line2 삭제 + line1 수정 모두 반영
        expect(result.content).toContain("LINE1");
        expect(result.content).not.toContain("line2");
      }
    });
  });

  // ─── AC-002.4: 같은 줄 수정 → 충돌 감지 ──────────
  describe("같은 줄 수정 시 충돌 감지", () => {
    it("같은 줄을 다른 내용으로 수정하면 충돌로 감지된다", () => {
      const base = "line1\nline2\nline3";
      const server = "line1\nSERVER_LINE2\nline3"; // 서버: line2 수정
      const incoming = "line1\nCLIENT_LINE2\nline3"; // 클라이언트: line2 수정

      const result = attemptThreeWayMerge(base, server, incoming);

      expect(result.type).toBe("conflict");
      if (result.type === "conflict") {
        expect(result.can_auto_merge).toBe(false);
        expect(result.diff).toBeDefined();
        expect(Array.isArray(result.diff)).toBe(true);
        expect(result.diff.length).toBeGreaterThan(0);
      }
    });

    it("여러 줄이 겹치면 충돌로 감지된다", () => {
      const base = "a\nb\nc\nd";
      const server = "A\nB\nc\nd"; // 서버: a, b 수정
      const incoming = "a\nX\nY\nd"; // 클라이언트: b, c 수정 (b가 겹침)

      const result = attemptThreeWayMerge(base, server, incoming);

      expect(result.type).toBe("conflict");
    });
  });

  // ─── AC-002.6: 동일 내용 (false conflict) → 자동 병합 ──────────
  describe("동일 내용 (false conflict)", () => {
    it("같은 줄을 같은 내용으로 수정하면 자동 병합된다", () => {
      const base = "line1\nline2\nline3";
      const server = "line1\nMODIFIED\nline3";
      const incoming = "line1\nMODIFIED\nline3"; // 동일한 수정

      const result = attemptThreeWayMerge(base, server, incoming);

      expect(result.type).toBe("auto");
      if (result.type === "auto") {
        expect(result.content).toBe("line1\nMODIFIED\nline3");
      }
    });

    it("서버와 클라이언트 내용이 완전히 같으면 한쪽만 유지된다", () => {
      const base = "original";
      const server = "same-change";
      const incoming = "same-change";

      const result = attemptThreeWayMerge(base, server, incoming);

      expect(result.type).toBe("auto");
      if (result.type === "auto") {
        expect(result.content).toBe("same-change");
      }
    });
  });

  // ─── AC-002.8: 빈 문자열 입력 ──────────
  describe("빈 문자열 처리", () => {
    it("base가 빈 문자열이면 정상 동작한다", () => {
      const base = "";
      const server = "server content";
      const incoming = "incoming content";

      const result = attemptThreeWayMerge(base, server, incoming);

      // 빈 문자열에서 양쪽 다 추가 → 같은 줄이므로 충돌
      expect(result.type === "auto" || result.type === "conflict").toBe(true);
    });

    it("server가 빈 문자열이면 정상 동작한다", () => {
      const base = "base content";
      const server = "";
      const incoming = "incoming content";

      const result = attemptThreeWayMerge(base, server, incoming);

      expect(result.type === "auto" || result.type === "conflict").toBe(true);
    });

    it("incoming이 빈 문자열이면 정상 동작한다", () => {
      const base = "base content";
      const server = "server content";
      const incoming = "";

      const result = attemptThreeWayMerge(base, server, incoming);

      expect(result.type === "auto" || result.type === "conflict").toBe(true);
    });

    it("모두 빈 문자열이면 자동 병합된다", () => {
      const result = attemptThreeWayMerge("", "", "");

      expect(result.type).toBe("auto");
      if (result.type === "auto") {
        expect(result.content).toBe("");
      }
    });
  });

  // ─── AC-002.7: base가 null → fallback ──────────
  describe("base가 null인 경우", () => {
    it("base가 null이면 fallback 결과를 반환한다", () => {
      const result = attemptThreeWayMerge(null, "server", "incoming");

      expect(result.type).toBe("fallback");
      if (result.type === "fallback") {
        expect(result.reason).toBeDefined();
        expect(typeof result.reason).toBe("string");
      }
    });
  });

  // ─── 대용량 파일 성능 가드 ──────────
  describe("대용량 파일 처리", () => {
    it("1MB 초과 content는 스킵하고 conflict를 반환한다", () => {
      // 1MB + 1 바이트 문자열 생성
      const large_content = "x".repeat(1024 * 1024 + 1);
      const base = large_content;
      const server = large_content + "s";
      const incoming = large_content + "i";

      const result = attemptThreeWayMerge(base, server, incoming);

      expect(result.type).toBe("conflict");
      if (result.type === "conflict") {
        // 대용량은 diff 없이 conflict만 반환
        expect(result.diff).toEqual([]);
      }
    });
  });
});
