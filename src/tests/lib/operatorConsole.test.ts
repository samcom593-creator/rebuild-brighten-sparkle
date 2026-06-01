/**
 * operatorConsole.test.ts
 *
 * Tests for src/lib/operatorConsole.ts — the pure routing brain behind
 * ConductCommandCenter. All pure functions, zero external deps.
 *
 * Coverage targets:
 *   ✅ planOperatorCommand — route shortcuts (today/crm/call-center/leaderboard/get-licensed/offers)
 *   ✅ planOperatorCommand — sync / agentlink refresh detection
 *   ✅ planOperatorCommand — health check detection
 *   ✅ planOperatorCommand — licensing blast → requiresConfirmation=true
 *   ✅ planOperatorCommand — status snapshot detection
 *   ✅ planOperatorCommand — SQL/destructive commands → requiresConfirmation=true
 *   ✅ planOperatorCommand — unknown command → queue_prompt fallback with prompt body
 *   ✅ planOperatorCommand — createdAt is always a valid ISO timestamp
 *   ✅ buildImplementationPrompt — includes command verbatim + AgentLink source-of-truth rule
 */

import { describe, it, expect } from "vitest";
import { planOperatorCommand, buildImplementationPrompt } from "@/lib/operatorConsole";

// ── route shortcuts ───────────────────────────────────────────────────────────
describe("planOperatorCommand — route shortcuts", () => {
  it("maps 'open today' to /dashboard/today with navigate type", () => {
    const r = planOperatorCommand("open today");
    expect(r.executionType).toBe("navigate");
    expect(r.route).toBe("/dashboard/today");
    expect(r.requiresConfirmation).toBe(false);
  });

  it("maps 'CRM' (case-insensitive) to /dashboard/crm", () => {
    const r = planOperatorCommand("CRM");
    expect(r.executionType).toBe("navigate");
    expect(r.route).toBe("/dashboard/crm");
  });

  it("maps 'call center' to /dashboard/call-center", () => {
    const r = planOperatorCommand("call center");
    expect(r.executionType).toBe("navigate");
    expect(r.route).toBe("/dashboard/call-center");
  });

  it("maps 'leaderboard' to /dashboard/leaderboard", () => {
    const r = planOperatorCommand("show leaderboard");
    expect(r.executionType).toBe("navigate");
    expect(r.route).toBe("/dashboard/leaderboard");
  });

  it("maps 'get licensed' to /get-licensed", () => {
    const r = planOperatorCommand("get licensed");
    expect(r.executionType).toBe("navigate");
    expect(r.route).toBe("/get-licensed");
  });

  it("maps 'offers' to /dashboard/offers", () => {
    const r = planOperatorCommand("offers");
    expect(r.executionType).toBe("navigate");
    expect(r.route).toBe("/dashboard/offers");
  });

  it("scope is 'website' on navigate responses", () => {
    expect(planOperatorCommand("today").scope).toBe("website");
  });
});

// ── sync detection ────────────────────────────────────────────────────────────
describe("planOperatorCommand — sync detection", () => {
  it("detects 'refresh agentlink deals' as sync", () => {
    const r = planOperatorCommand("refresh agentlink deals");
    expect(r.executionType).toBe("sync");
    expect(r.requiresConfirmation).toBe(false);
    expect(r.scope).toBe("metrics");
  });

  it("detects 'pull agentlink sync' as sync", () => {
    // NOTE: 'pull leaderboard numbers' triggers the leaderboard route shortcut first.
    // Use an input that doesn't contain a route shortcut keyword.
    expect(planOperatorCommand("pull agentlink sync").executionType).toBe("sync");
  });

  it("detects 'sync deals' as sync", () => {
    expect(planOperatorCommand("sync deals").executionType).toBe("sync");
  });
});

// ── health check ─────────────────────────────────────────────────────────────
describe("planOperatorCommand — health check", () => {
  it("detects 'system health' as health_check", () => {
    const r = planOperatorCommand("system health");
    expect(r.executionType).toBe("health_check");
    expect(r.requiresConfirmation).toBe(false);
    expect(r.scope).toBe("admin");
  });

  it("detects 'run check' as health_check", () => {
    expect(planOperatorCommand("run check").executionType).toBe("health_check");
  });
});

// ── licensing blast ───────────────────────────────────────────────────────────
describe("planOperatorCommand — licensing blast (requires confirmation)", () => {
  it("flags 'licensing blast' as requires_confirmation", () => {
    const r = planOperatorCommand("licensing blast");
    expect(r.requiresConfirmation).toBe(true);
    expect(r.executionType).toBe("licensing_blast");
    expect(r.scope).toBe("recruiting");
  });

  it("flags 'blast licensing' variant too", () => {
    expect(planOperatorCommand("blast licensing").requiresConfirmation).toBe(true);
  });
});

// ── status snapshot ───────────────────────────────────────────────────────────
describe("planOperatorCommand — status snapshot", () => {
  it("handles \"what's live\" as status_snapshot", () => {
    const r = planOperatorCommand("what's live");
    expect(r.executionType).toBe("status_snapshot");
    expect(r.scope).toBe("metrics");
  });

  it("handles \"what is live\" as status_snapshot", () => {
    // NOTE: 'today's numbers' contains 'today' and hits the route shortcut first.
    // 'what is live' matches only the status_snapshot branch.
    expect(planOperatorCommand("what is live").executionType).toBe("status_snapshot");
  });

  it("handles 'how are we doing' as status_snapshot", () => {
    expect(planOperatorCommand("how are we doing").executionType).toBe("status_snapshot");
  });
});

// ── destructive / SQL commands ────────────────────────────────────────────────
describe("planOperatorCommand — destructive commands require confirmation", () => {
  it("flags 'delete all stale rows' as requires_confirmation", () => {
    const r = planOperatorCommand("delete all stale rows");
    expect(r.requiresConfirmation).toBe(true);
    expect(r.executionType).toBe("advanced_sql");
    expect(r.scope).toBe("admin");
  });

  it("flags 'drop table' as requires_confirmation", () => {
    expect(planOperatorCommand("drop table agents").requiresConfirmation).toBe(true);
  });

  it("flags 'run sql' as advanced_sql", () => {
    expect(planOperatorCommand("run sql to fix the duplicates").executionType).toBe("advanced_sql");
  });

  it("flags 'truncate' as advanced_sql", () => {
    expect(planOperatorCommand("truncate stale_applications").executionType).toBe("advanced_sql");
  });
});

// ── unknown / queue_prompt fallback ──────────────────────────────────────────
describe("planOperatorCommand — unknown command → queue_prompt fallback", () => {
  it("unknown command returns queue_prompt", () => {
    const r = planOperatorCommand("redesign the hero section with confetti");
    expect(r.executionType).toBe("queue_prompt");
    expect(r.requiresConfirmation).toBe(false);
  });

  it("fallback includes a non-empty prompt string", () => {
    const r = planOperatorCommand("add a confetti animation on deal submit");
    expect(r.prompt).toBeTruthy();
    expect(typeof r.prompt).toBe("string");
  });

  it("fallback scope is 'website'", () => {
    expect(planOperatorCommand("anything random").scope).toBe("website");
  });
});

// ── invariants across all responses ──────────────────────────────────────────
describe("planOperatorCommand — invariants", () => {
  const samples = [
    "today",
    "refresh agentlink",
    "delete rows",
    "licensing blast",
    "completely unknown prompt",
    "",
  ];

  for (const cmd of samples) {
    it(`createdAt is a valid ISO timestamp for "${cmd || "(empty)"}"`, () => {
      const r = planOperatorCommand(cmd);
      expect(() => new Date(r.createdAt)).not.toThrow();
      expect(isNaN(new Date(r.createdAt).getTime())).toBe(false);
    });

    it(`command field echoes the trimmed input for "${cmd || "(empty)"}"`, () => {
      const r = planOperatorCommand(cmd);
      expect(r.command).toBe(cmd.trim());
    });
  }

  it("rollbackHint is always a non-empty string", () => {
    for (const cmd of samples) {
      expect(planOperatorCommand(cmd).rollbackHint.length).toBeGreaterThan(0);
    }
  });
});

// ── buildImplementationPrompt ─────────────────────────────────────────────────
describe("buildImplementationPrompt", () => {
  it("includes the command text verbatim", () => {
    const p = buildImplementationPrompt("add a confetti burst on submit");
    expect(p).toContain("add a confetti burst on submit");
  });

  it("mentions AgentLink as source of truth", () => {
    expect(buildImplementationPrompt("x")).toMatch(/AgentLink/);
  });

  it("includes Chicago timezone requirement", () => {
    expect(buildImplementationPrompt("x")).toMatch(/Chicago/);
  });

  it("requires live verification in the output", () => {
    expect(buildImplementationPrompt("x")).toMatch(/verification/i);
  });
});
