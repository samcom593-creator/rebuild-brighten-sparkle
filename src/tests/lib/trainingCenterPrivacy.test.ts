// MP-TRAINING-CENTER (2026-11-23): the training center must never show an agent client data.
//
// These are source contracts, not render tests: they pin the three properties the live proofs established so a later
// edit cannot quietly undo them. (1) Everything an agent reads comes from the team copy, never from the raw analysis.
// (2) Every agent-facing function runs the leak test, so a bad team copy hides the call instead of leaking it.
// (3) The page no longer reads the old public source for recordings or transcripts.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const sql = read("supabase/migrations/20261124002000_training_center_team_copy.sql");

function body(fn: string): string {
  const start = sql.indexOf(`create or replace function public.${fn}(`);
  expect(start, `${fn} is defined`).toBeGreaterThan(-1);
  const open = sql.indexOf("$$", start);
  const close = sql.indexOf("$$", open + 2);
  return sql.slice(open + 2, close);
}

describe("training center: no client data reaches an agent", () => {
  it("serves call text from the team copy, never from the raw analysis", () => {
    for (const fn of ["call_training_library", "call_training_objections"]) {
      const b = body(fn);
      expect(b).toMatch(/join public\.call_training_team_copy tc on tc\.call_id = a\.call_id/);
      expect(b).not.toMatch(/\bg\.(summary|objection_moments|key_quotes|strengths|tactics|score_reasons|script_steps|coaching_notes)\b/);
      expect(b).not.toMatch(/lead_(phone|email)|lead_last_name\s*,|client_/);
    }
  });

  it("fails closed: every agent-facing function runs the leak test and needs team audio", () => {
    for (const fn of ["call_training_library", "call_training_objections"]) {
      const b = body(fn);
      expect(b).toMatch(/not public\.fn_training_text_leaks\(/);
      expect(b).toMatch(/tc\.audio_path is not null/);
      expect(b).toMatch(/can_view_sold_calls\(\) or public\.is_active_agent_login\(\)/);
    }
    expect(body("training_recordings_list")).toMatch(/not public\.fn_training_text_leaks\(/);
  });

  it("plays another agent's call from the team copy only", () => {
    const play = body("can_play_call_audio");
    // The numbers-only copy is for the caller's own calls and their downline's: no team_visible shortcut onto it.
    const nonLeader = play.slice(play.indexOf("else"));
    const redactedBranch = nonLeader.slice(0, nonLeader.indexOf("call_training_team_copy"));
    expect(redactedBranch).toMatch(/a\.redacted_path = p_path/);
    expect(redactedBranch).not.toMatch(/team_visible/);
    expect(body("call_audio_for")).toMatch(/else tc\.audio_path end/);
  });

  it("keeps the tables closed to the browser", () => {
    expect(sql).toMatch(/revoke all on public\.call_training_team_copy from anon, authenticated/);
    expect(sql).toMatch(/revoke all on public\.training_recordings from anon, authenticated/);
    expect(sql).toMatch(/values \('training-recordings', 'training-recordings', false\)/);
  });

  it("uses one objection vocabulary in the database and on the page", () => {
    const produced = new Set([...body("fn_objection_category").matchAll(/then '([a-z_]+)'|else '([a-z_]+)'/g)].map((m) => m[1] ?? m[2]));
    const tab = read("src/components/training/ObjectionsTab.tsx");
    const shown = new Set([...tab.matchAll(/\{ key: "([a-z_]+)", label:/g)].map((m) => m[1]));
    expect([...shown].sort()).toEqual([...produced].sort());
  });

  it("no longer reads recordings or transcripts from the public source", () => {
    const page = read("src/pages/TrainingHub.tsx");
    expect(page).not.toMatch(/useHubTranscripts|toHubEmbedUrl|HUB_EMBED_SANDBOX|<iframe/);
    expect(page).toMatch(/<TrainingRecordings \/>/);
    const rec = read("src/components/training/TrainingRecordings.tsx");
    expect(rec).toMatch(/rpc\("training_recordings_list"/);
    expect(rec).not.toMatch(/apex-resources|drive\.google/);
  });
});
