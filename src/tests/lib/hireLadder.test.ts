import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HIRE_RUNGS, stageForRank, stageLabel, stageRank } from "@/lib/hireLadder";

const MIGRATION = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20260831280000_hire_launch_board.sql"),
  "utf8",
);

describe("hire ladder", () => {
  it("puts a producer at the top rung — the exact bug this replaced", () => {
    // The old rail matched /(training|onboard|contract)/ then
    // /(field|active|production|ready)/. 'evaluated' matched neither and fell
    // through to step 1, "Licensed". Measured: 8 of 8 active agents at
    // 'evaluated' have a first deal and rows in agentlink_book.
    expect(stageRank("evaluated")).toBe(4);
    expect(stageRank("live")).toBe(4);
  });

  it("ranks the ladder in the order a hire climbs it", () => {
    expect(stageRank("pre_licensed")).toBe(0);
    expect(stageRank("onboarding")).toBe(1);
    expect(stageRank("training_online")).toBe(2);
    expect(stageRank("in_field_training")).toBe(3);
    expect(stageRank(null)).toBe(0);
  });

  it("returns null for a status flag rather than sorting it to a rung", () => {
    for (const flag of ["inactive", "need_followup", "pending_review", "transfer", "below_10k"]) {
      expect(stageRank(flag), flag).toBeNull();
    }
  });

  it("does not demote 'evaluated' to 'live' when the same rung is re-clicked", () => {
    expect(stageForRank(4, "evaluated")).toBe("evaluated");
    expect(stageForRank(4, "onboarding")).toBe("live");
    expect(stageForRank(1, null)).toBe("onboarding");
  });

  it("never prints a raw column name at the user", () => {
    expect(stageLabel("in_field_training")).toBe("Field training");
    expect(stageLabel(null)).toBe("No stage recorded");
    expect(stageLabel("training_online")).toBe("In course");
  });

  // The ladder is written twice — here and in public.fn_hire_stage_rank —
  // because CI has no database. Asserting the migration's own SQL carries the
  // same pairs is what stops the two drifting; re-implementing the mapping in
  // the test would only prove the test agrees with itself.
  it("agrees with fn_hire_stage_rank in the migration", () => {
    const pairs: Array<[string, number]> = [
      ["pre_licensed", 0], ["applied", 0], ["meeting_attendance", 0],
      ["onboarding", 1], ["training_online", 2], ["in_field_training", 3],
      ["live", 4], ["evaluated", 4],
    ];
    const body = MIGRATION.slice(MIGRATION.indexOf("fn_hire_stage_rank"));
    for (const [stage, rank] of pairs) {
      const line = new RegExp(`when '${stage}'\\s*then ${rank}\\b`);
      expect(body, `${stage} -> ${rank}`).toMatch(line);
      expect(stageRank(stage), stage).toBe(rank);
    }
    // and the SQL must fall through to NULL for anything else, so an
    // off-ladder status can never be silently ranked.
    expect(body).toMatch(/else null/);
  });

  it("keeps the rung list and the rank function in step", () => {
    for (const rung of HIRE_RUNGS) {
      expect(stageRank(rung.stage), rung.stage).toBe(rung.rank);
    }
    expect(HIRE_RUNGS.map((rung) => rung.rank)).toEqual([0, 1, 2, 3, 4]);
  });
});
