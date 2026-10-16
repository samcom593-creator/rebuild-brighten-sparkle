/**
 * queryState helpers (F10 / F15 / F19 / F33): a failed read is never an empty
 * list or a zero; "empty" is only a completed read with no rows; a failed
 * refresh keeps the last good data as ready + stale.
 */
import { describe, expect, it } from "vitest";
import { describeQuery, errorMessage, formatAsOf, isEmptyResult, queryStale, queryStatus } from "@/lib/queryState";

// Intl puts a narrow no-break space before AM/PM on newer ICU; compare on plain spaces.
const norm = (s: string) => s.replace(/\s+/g, " ");

describe("queryStatus", () => {
  it("is loading while nothing has loaded, including a disabled query", () => {
    expect(queryStatus({ isPending: true, data: undefined })).toBe("loading");
    expect(queryStatus({ isLoading: true })).toBe("loading");
    expect(queryStatus({ isPending: true, isLoading: false, isError: false, data: undefined })).toBe("loading");
  });

  it("never reports empty for a read that has not completed", () => {
    expect(queryStatus({})).toBe("loading");
    expect(queryStatus({ isPending: false, isError: false, data: undefined })).toBe("loading");
  });

  it("is error when the read failed with nothing to show, whatever the caller says about emptiness", () => {
    expect(queryStatus({ isError: true, data: undefined })).toBe("error");
    expect(queryStatus({ isError: true, isPending: false, data: undefined, isEmpty: true })).toBe("error");
  });

  it("keeps the last good data as ready and flags it stale when a refresh fails", () => {
    const q = { isError: true, data: [{ id: 1 }] };
    expect(queryStatus(q)).toBe("ready");
    expect(queryStale(q)).toBe(true);
    expect(queryStale({ isError: false, data: [] })).toBe(false);
    expect(queryStale({ isError: true, data: undefined })).toBe(false);
  });

  it("is empty only for a completed read with no rows", () => {
    expect(queryStatus({ isPending: false, isError: false, data: [] })).toBe("empty");
    expect(queryStatus({ isPending: false, isError: false, data: null })).toBe("empty");
    expect(queryStatus({ isPending: false, isError: false, data: [{ id: 1 }] })).toBe("ready");
    expect(queryStatus({ isPending: false, isError: false, data: { rows: [] } })).toBe("ready");
    expect(queryStatus({ isPending: false, isError: false, data: { rows: [] }, isEmpty: true })).toBe("empty");
    expect(queryStatus({ isPending: false, isError: false, data: [], isEmpty: false })).toBe("ready");
  });

  it("describeQuery returns exactly the props QueryState reads", () => {
    const err = new Error("boom");
    expect(describeQuery({ isError: true, data: [1], error: err })).toEqual({ status: "ready", stale: true, error: err });
    expect(describeQuery({ isPending: true, data: undefined, error: null })).toEqual({ status: "loading", stale: false, error: null });
    expect(describeQuery({ isPending: false, isError: false, data: [] })).toEqual({ status: "empty", stale: false, error: null });
    expect(describeQuery({ isError: true, data: undefined, error: err })).toEqual({ status: "error", stale: false, error: err });
  });
});

describe("isEmptyResult", () => {
  it("treats no rows and null as empty, and objects as data", () => {
    expect(isEmptyResult([])).toBe(true);
    expect(isEmptyResult(null)).toBe(true);
    expect(isEmptyResult([0])).toBe(false);
    expect(isEmptyResult({ total: 0 })).toBe(false);
    expect(isEmptyResult(0)).toBe(false);
  });
});

describe("errorMessage", () => {
  it("reads Error instances and strings", () => {
    expect(errorMessage(new Error("Ledger read failed"))).toBe("Ledger read failed");
    expect(errorMessage("  plain text  ")).toBe("plain text");
  });

  it("reads the Supabase PostgrestError shape", () => {
    expect(errorMessage({ message: "relation does not exist", code: "42P01", details: null, hint: null })).toBe("relation does not exist");
  });

  it("turns the common codes into plain English", () => {
    expect(errorMessage({ message: "permission denied for table agents", code: "42501" })).toBe("You do not have permission to view this.");
    expect(errorMessage({ message: "JWT expired", code: "PGRST301" })).toMatch(/session has expired/);
    expect(errorMessage({ message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" })).toMatch(/ambiguous/);
    expect(errorMessage(new TypeError("Failed to fetch"))).toBe("Network error. Check your connection and retry.");
    expect(errorMessage({ message: "canceling statement due to statement timeout", code: "57014" })).toMatch(/took too long/);
  });

  it("reads a nested { error: { message } }", () => {
    expect(errorMessage({ error: { message: "nested failure" } })).toBe("nested failure");
  });

  it("never returns an empty string", () => {
    expect(errorMessage(null)).toBe("Something went wrong while loading.");
    expect(errorMessage(undefined, "Unavailable")).toBe("Unavailable");
    expect(errorMessage({})).toBe("Something went wrong while loading.");
    expect(errorMessage("")).toBe("Something went wrong while loading.");
    expect(errorMessage({ message: "", code: "XX000" })).toBe("Request failed (XX000).");
    expect(errorMessage({ message: "", details: "constraint failed" })).toBe("constraint failed");
    expect(errorMessage(42)).toBe("Something went wrong while loading.");
  });
});

describe("formatAsOf", () => {
  const now = Date.parse("2026-10-14T20:00:00Z"); // 1:00 PM in Phoenix

  it("renders a clock with its zone for an instant on the viewer's today", () => {
    expect(norm(formatAsOf(Date.parse("2026-10-14T19:30:00Z"), "America/Phoenix", now))).toBe("12:30 PM MST");
    expect(norm(formatAsOf("2026-10-14T19:30:00.000Z", "America/Phoenix", now))).toBe("12:30 PM MST");
    expect(norm(formatAsOf(new Date("2026-10-14T19:30:00Z"), "America/Phoenix", now))).toBe("12:30 PM MST");
  });

  it("adds the day when the instant is not the viewer's today", () => {
    expect(norm(formatAsOf("2026-10-13T19:30:00.000Z", "America/Phoenix", now))).toBe("Tue, Oct 13, 12:30 PM MST");
  });

  it("passes preformatted strings through and returns empty for nothing", () => {
    expect(formatAsOf("2 minutes ago")).toBe("2 minutes ago");
    expect(formatAsOf(null)).toBe("");
    expect(formatAsOf(undefined)).toBe("");
    expect(formatAsOf("")).toBe("");
    expect(formatAsOf(Number.NaN)).toBe("");
  });
});
