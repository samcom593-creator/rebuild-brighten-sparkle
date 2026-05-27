/**
 * queryKeys.test.ts
 *
 * Gaps covered:
 *   ✅ Each key factory returns a stable tuple matching the documented shape
 *   ✅ Keys with different args are not equal (cache separation guarantee)
 *   ✅ Undefined/omitted filters produce a consistent key
 *
 * Why test a simple factory? Cache invalidation bugs in React Query always
 * start with key shape drift. A test that pins the shape catches refactors
 * before they cause stale-data production incidents.
 */
import { describe, it, expect } from "vitest";
import { queryKeys } from "@/shared/api/queryKeys";

describe("queryKeys.agents", () => {
  it("all is a stable constant", () => {
    expect(queryKeys.agents.all).toEqual(["agents"]);
  });

  it("list() without filters returns predictable key", () => {
    expect(queryKeys.agents.list()).toEqual(["agents", "list", undefined]);
  });

  it("list(filters) embeds filter object", () => {
    expect(queryKeys.agents.list({ status: "active" })).toEqual([
      "agents",
      "list",
      { status: "active" },
    ]);
  });

  it("detail(id) includes the id", () => {
    expect(queryKeys.agents.detail("abc-123")).toEqual(["agents", "detail", "abc-123"]);
  });

  it("detail with different ids are not equal", () => {
    const k1 = queryKeys.agents.detail("id-1");
    const k2 = queryKeys.agents.detail("id-2");
    expect(k1).not.toEqual(k2);
  });

  it("metrics without period returns consistent key", () => {
    expect(queryKeys.agents.metrics("id", undefined)).toEqual([
      "agents",
      "metrics",
      "id",
      undefined,
    ]);
  });

  it("metrics with period includes period segment", () => {
    expect(queryKeys.agents.metrics("id", "monthly")).toEqual([
      "agents",
      "metrics",
      "id",
      "monthly",
    ]);
  });
});

describe("queryKeys.applications", () => {
  it("all is correct", () => {
    expect(queryKeys.applications.all).toEqual(["applications"]);
  });

  it("detail(id) works", () => {
    expect(queryKeys.applications.detail("app-1")).toEqual([
      "applications",
      "detail",
      "app-1",
    ]);
  });
});

describe("queryKeys.production", () => {
  it("daily includes agentId and date", () => {
    expect(queryKeys.production.daily("agent-1", "2026-05-01")).toEqual([
      "production",
      "daily",
      "agent-1",
      "2026-05-01",
    ]);
  });

  it("range includes start and end", () => {
    expect(queryKeys.production.range("2026-05-01", "2026-05-31")).toEqual([
      "production",
      "range",
      "2026-05-01",
      "2026-05-31",
    ]);
  });
});

describe("queryKeys.notifications", () => {
  it("unread includes userId", () => {
    expect(queryKeys.notifications.unread("user-42")).toEqual([
      "notifications",
      "unread",
      "user-42",
    ]);
  });
});

describe("queryKeys — cache isolation", () => {
  it("agents.list and applications.list keys do not collide", () => {
    expect(queryKeys.agents.list()).not.toEqual(queryKeys.applications.list());
  });

  it("agents.all prefix does not match agents.detail", () => {
    expect(queryKeys.agents.all).not.toEqual(queryKeys.agents.detail("any"));
  });
});
