/**
 * MP-365 — review mode for leaders, and the two halves that have to hold together.
 *
 * Sam: "For managers, for MILVER and VA — isn't for me, of course — unlock all
 * training courses... to properly see what the courses entail."
 *
 * Measured on prod before this shipped: of 8 managers, the furthest along (KJ)
 * could open 5 of 6 lessons and John Riley could open 1, because every lesson
 * after the first was gated on passing the previous quiz. Milver and April have
 * no agent record, so their viewer loaded with no progress and locked at lesson 1.
 *
 * The unlock is only half the change. If a leader clicking through six lessons
 * still wrote progress, they would show up on the team-progress report they just
 * opened as a half-finished learner going stale — so the test that matters is
 * not "can they open lesson 6" alone, it is "can they open lesson 6 AND did
 * nothing get written". Both are asserted here, and the second is asserted by
 * failing on ANY write to onboarding_progress, so a future path that starts
 * writing from a new place is caught rather than a specific call being watched.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { useOnboardingCourse } from "@/hooks/useOnboardingCourse";

const MODULES = [
  { id: "m1", order_index: 1, title: "One", is_active: true },
  { id: "m2", order_index: 2, title: "Two", is_active: true },
  { id: "m3", order_index: 3, title: "Three", is_active: true },
];

const writes: string[] = [];
let roles = { isAdmin: false, isManager: false, isVaManager: false, isVa: false };

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => roles,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/integrations/supabase/client", () => {
  const table = (name: string) => {
    const rows = name === "onboarding_modules" ? MODULES : [];
    const result = Promise.resolve({ data: rows, error: null });
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "order", "in", "limit"]) {
      chain[method] = () => chain;
    }
    // Any write is a failure in review mode. Recording the verb rather than
    // spying on one call site means a NEW write path is caught too.
    for (const method of ["insert", "update", "upsert", "delete"]) {
      chain[method] = () => {
        writes.push(`${name}.${method}`);
        return chain;
      };
    }
    chain.then = (...args: unknown[]) =>
      (result as unknown as { then: (...a: unknown[]) => unknown }).then(...args);
    return chain;
  };
  return {
    supabase: {
      from: (name: string) => table(name),
      functions: { invoke: vi.fn(async () => ({ data: null, error: null })) },
    },
  };
});

function Probe() {
  const { modules, isModuleUnlocked, reviewMode, canReviewCourse, canTakeQuiz } =
    useOnboardingCourse("agent-1");
  return (
    <div>
      <span data-testid="loaded">{modules.length}</span>
      <span data-testid="review">{String(reviewMode)}</span>
      <span data-testid="can-review">{String(canReviewCourse)}</span>
      <span data-testid="last-unlocked">{String(isModuleUnlocked(2))}</span>
      <span data-testid="quiz">{String(canTakeQuiz("m3"))}</span>
    </div>
  );
}

async function renderProbe() {
  render(<Probe />);
  await waitFor(() => expect(screen.getByTestId("loaded").textContent).toBe("3"));
}

describe("useOnboardingCourse — review mode", () => {
  beforeEach(() => {
    writes.length = 0;
    roles = { isAdmin: false, isManager: false, isVaManager: false, isVa: false };
  });

  it("locks a plain agent out of a lesson whose predecessor is unpassed", async () => {
    await renderProbe();
    expect(screen.getByTestId("can-review").textContent).toBe("false");
    expect(screen.getByTestId("review").textContent).toBe("false");
    // This is the state every manager was in, and it is the state the guard
    // exists to keep for agents — if this ever reads "true" the sequence is gone
    // for everyone, not just for leaders.
    expect(screen.getByTestId("last-unlocked").textContent).toBe("false");
  });

  it.each([
    ["manager", { isManager: true }],
    ["va_manager", { isVaManager: true }],
    ["va", { isVa: true }],
    ["admin", { isAdmin: true }],
  ])("opens every lesson for %s and records nothing", async (_label, grant) => {
    roles = { isAdmin: false, isManager: false, isVaManager: false, isVa: false, ...grant };
    await renderProbe();
    expect(screen.getByTestId("review").textContent).toBe("true");
    expect(screen.getByTestId("last-unlocked").textContent).toBe("true");
    // The knowledge check is part of what the course entails, and review mode
    // writes no progress row for the 80%-watched test to read.
    expect(screen.getByTestId("quiz").textContent).toBe("true");
    // The half that is easy to forget: opening lessons must not enrol the leader.
    expect(writes.filter((w) => w.startsWith("onboarding_progress"))).toEqual([]);
  });
});
