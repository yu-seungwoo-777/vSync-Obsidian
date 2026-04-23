import { describe, it, expect } from "vitest";
import {
  fileUploadSchema,
  editSchema,
  searchSchema,
  eventsQuerySchema,
  syncStatusSchema,
  batchSchema,
  moveSchema,
  paginationSchema,
} from "../src/schemas/api-schemas.js";

describe("fileUploadSchema", () => {
  it("유효한 입력을 통과시킨다", () => {
    const result = fileUploadSchema.safeParse({
      path: "notes/test.md",
      content: "# Hello",
      hash: "abc123",
    });
    expect(result.success).toBe(true);
  });

  it("path 가 없으면 실패한다", () => {
    const result = fileUploadSchema.safeParse({
      content: "# Hello",
      hash: "abc123",
    });
    expect(result.success).toBe(false);
  });

  it("hash 가 없으면 실패한다", () => {
    const result = fileUploadSchema.safeParse({
      path: "notes/test.md",
      content: "# Hello",
    });
    expect(result.success).toBe(false);
  });

  it("content 는 선택적이다", () => {
    const result = fileUploadSchema.safeParse({
      path: "notes/test.md",
      hash: "abc123",
    });
    expect(result.success).toBe(true);
  });
});

describe("editSchema", () => {
  it("유효한 입력을 통과시킨다", () => {
    const result = editSchema.safeParse({
      path: "notes/test.md",
      old_text: "hello",
      new_text: "world",
    });
    expect(result.success).toBe(true);
  });

  it("path 가 없으면 실패한다", () => {
    const result = editSchema.safeParse({
      old_text: "hello",
      new_text: "world",
    });
    expect(result.success).toBe(false);
  });

  it("old_text 가 빈 문자열이면 실패한다 (min 1)", () => {
    const result = editSchema.safeParse({
      path: "notes/test.md",
      old_text: "",
      new_text: "world",
    });
    expect(result.success).toBe(false);
  });

  it("new_text 가 없으면 실패한다", () => {
    const result = editSchema.safeParse({
      path: "notes/test.md",
      old_text: "hello",
    });
    expect(result.success).toBe(false);
  });
});

describe("searchSchema", () => {
  it("유효한 입력을 통과시킨다", () => {
    const result = searchSchema.safeParse({ q: "test query" });
    expect(result.success).toBe(true);
  });

  it("q 가 없으면 실패한다", () => {
    const result = searchSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("q 가 빈 문자열이면 실패한다 (min 1)", () => {
    const result = searchSchema.safeParse({ q: "" });
    expect(result.success).toBe(false);
  });

  it("q 가 500자 초과면 실패한다", () => {
    const result = searchSchema.safeParse({ q: "a".repeat(501) });
    expect(result.success).toBe(false);
  });

  it("q 가 정확히 500자면 통과한다", () => {
    const result = searchSchema.safeParse({ q: "a".repeat(500) });
    expect(result.success).toBe(true);
  });

  it("limit 은 선택적이다", () => {
    const result = searchSchema.safeParse({ q: "test", limit: 10 });
    expect(result.success).toBe(true);
  });

  it("limit 이 1 미만이면 실패한다", () => {
    const result = searchSchema.safeParse({ q: "test", limit: 0 });
    expect(result.success).toBe(false);
  });

  it("limit 이 200 초과면 실패한다", () => {
    const result = searchSchema.safeParse({ q: "test", limit: 201 });
    expect(result.success).toBe(false);
  });

  it("folder 는 선택적이다", () => {
    const result = searchSchema.safeParse({ q: "test", folder: "notes" });
    expect(result.success).toBe(true);
  });
});

describe("eventsQuerySchema", () => {
  it("빈 쿼리를 통과시킨다 (모든 필드 선택적)", () => {
    const result = eventsQuerySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("유효한 UUID since 값을 통과시킨다", () => {
    const result = eventsQuerySchema.safeParse({
      since: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(result.success).toBe(true);
  });

  it("잘못된 형식의 since 값은 실패한다", () => {
    const result = eventsQuerySchema.safeParse({ since: "not-a-uuid" });
    expect(result.success).toBe(false);
  });

  it("limit 이 범위 내면 통과한다", () => {
    const result = eventsQuerySchema.safeParse({ limit: 50 });
    expect(result.success).toBe(true);
  });

  it("limit 이 0 이면 실패한다", () => {
    const result = eventsQuerySchema.safeParse({ limit: 0 });
    expect(result.success).toBe(false);
  });

  it("limit 이 100 초과면 실패한다", () => {
    const result = eventsQuerySchema.safeParse({ limit: 101 });
    expect(result.success).toBe(false);
  });
});

describe("syncStatusSchema", () => {
  it("유효한 입력을 통과시킨다", () => {
    const result = syncStatusSchema.safeParse({
      device_id: "device-123",
      last_event_id: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(result.success).toBe(true);
  });

  it("device_id 가 없으면 실패한다", () => {
    const result = syncStatusSchema.safeParse({
      last_event_id: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(result.success).toBe(false);
  });

  it("last_event_id 가 없으면 실패한다", () => {
    const result = syncStatusSchema.safeParse({ device_id: "device-123" });
    expect(result.success).toBe(false);
  });

  it("device_id 에 특수문자가 있으면 실패한다", () => {
    const result = syncStatusSchema.safeParse({
      device_id: "device@123!",
      last_event_id: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(result.success).toBe(false);
  });

  it("last_event_id 가 UUID 형식이 아니면 실패한다", () => {
    const result = syncStatusSchema.safeParse({
      device_id: "device-123",
      last_event_id: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });

  it("device_id 에 하이픈, 밑줄이 포함되면 통과한다", () => {
    const result = syncStatusSchema.safeParse({
      device_id: "my-device_abc-123",
      last_event_id: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(result.success).toBe(true);
  });
});

describe("batchSchema", () => {
  it("유효한 연산 배열을 통과시킨다", () => {
    const result = batchSchema.safeParse({
      operations: [
        { type: "create", data: { path: "a.md", content: "hello" } },
        { type: "delete", data: { path: "b.md" } },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("operations 가 빈 배열이면 실패한다 (min 1)", () => {
    const result = batchSchema.safeParse({ operations: [] });
    expect(result.success).toBe(false);
  });

  it("operations 가 50개 초과면 실패한다", () => {
    const ops = Array.from({ length: 51 }, (_, i) => ({
      type: "create",
      data: { path: `file${i}.md` },
    }));
    const result = batchSchema.safeParse({ operations: ops });
    expect(result.success).toBe(false);
  });

  it("operations 가 정확히 50개면 통과한다", () => {
    const ops = Array.from({ length: 50 }, (_, i) => ({
      type: "create",
      data: { path: `file${i}.md` },
    }));
    const result = batchSchema.safeParse({ operations: ops });
    expect(result.success).toBe(true);
  });

  it("operation 에 type 이 없으면 실패한다", () => {
    const result = batchSchema.safeParse({
      operations: [{ data: { path: "a.md" } }],
    });
    expect(result.success).toBe(false);
  });

  it("operation 에 data 가 없으면 실패한다", () => {
    const result = batchSchema.safeParse({
      operations: [{ type: "create" }],
    });
    expect(result.success).toBe(false);
  });
});

describe("moveSchema", () => {
  it("유효한 입력을 통과시킨다", () => {
    const result = moveSchema.safeParse({
      from: "notes/old.md",
      to: "notes/new.md",
    });
    expect(result.success).toBe(true);
  });

  it("from 이 없으면 실패한다", () => {
    const result = moveSchema.safeParse({ to: "notes/new.md" });
    expect(result.success).toBe(false);
  });

  it("to 가 없으면 실패한다", () => {
    const result = moveSchema.safeParse({ from: "notes/old.md" });
    expect(result.success).toBe(false);
  });
});

describe("paginationSchema", () => {
  it("빈 입력을 통과시킨다 (모든 필드 선택적)", () => {
    const result = paginationSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("limit 만 지정하면 통과한다", () => {
    const result = paginationSchema.safeParse({ limit: 50 });
    expect(result.success).toBe(true);
  });

  it("limit 이 1 미만이면 실패한다", () => {
    const result = paginationSchema.safeParse({ limit: 0 });
    expect(result.success).toBe(false);
  });

  it("limit 이 100 초과면 실패한다", () => {
    const result = paginationSchema.safeParse({ limit: 101 });
    expect(result.success).toBe(false);
  });

  it("cursor 를 지정하면 통과한다", () => {
    const result = paginationSchema.safeParse({ cursor: "abc123" });
    expect(result.success).toBe(true);
  });

  it("limit 기본값은 100 이다", () => {
    const result = paginationSchema.safeParse({});
    if (result.success) {
      expect(result.data.limit).toBe(100);
    }
  });
});
