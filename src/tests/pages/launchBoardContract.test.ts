import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Source-level contract for §11: one content workspace, one /dashboard/content route (a single-hop redirect),
// and no tap on the board can mark content Published without the live-URL confirmation.
const root = path.resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const app = read("src/App.tsx");
const nav = read("src/components/layout/agentCloudNavigation.ts");
const board = read("src/pages/LaunchBoard.tsx");
const migration = read("supabase/migrations/20261006150000_launch_board_workflow.sql");

const fnBody = (src: string, name: string) => {
  const start = src.indexOf(`const ${name} = `);
  expect(start, name).toBeGreaterThan(-1);
  const next = src.indexOf("\n  const ", start + 10);
  return src.slice(start, next === -1 ? undefined : next);
};

describe("Launch Board consolidation", () => {
  it("declares /dashboard/content exactly once, as a redirect to the Launch Board queue tab", () => {
    const routes = app.match(/<Route path="\/dashboard\/content"[^\n]*/g) ?? [];
    expect(routes).toHaveLength(1);
    expect(routes[0]).toContain('<Navigate to="/dashboard/launch-board?tab=queue" replace />');
    expect(app).toMatch(/<Route path="\/dashboard\/launch-board" element=\{<ProtectedRoute><ContentAccessGate><LaunchBoard \/>/);
  });
  it("drops the separate Content nav entry and keeps Launch Board", () => {
    expect(nav).not.toContain('href: "/dashboard/content"');
    expect(nav).toContain('href: "/dashboard/launch-board"');
  });
  it("embeds the content-ops queue as a tab", () => {
    expect(board).toContain('import("./ContentQueue")');
    expect(board).toContain("<ContentQueue embedded />");
  });
});

describe("publishing needs evidence", () => {
  it("copying a caption or downloading a clip never writes the card", () => {
    for (const name of ["copyCaption", "copyText", "saveOne", "downloadAll"]) {
      const body = fnBody(board, name);
      expect(body, name).not.toMatch(/\bpatch\(|\bmove\(|from\("content_cards"\)/);
    }
  });
  it("the page never writes the retired statuses", () => {
    expect(board).not.toMatch(/status:\s*"posted"/);
    expect(board).not.toMatch(/patch\([^)]*"recorded"/);
  });
  it("the only path to published sends a live URL with manual_confirmation evidence", () => {
    const writes = board.match(/move\([^;]*"published"[^;]*;/g) ?? [];
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("published_url: publishUrl.trim()");
    expect(writes[0]).toContain('publish_evidence: "manual_confirmation"');
    expect(fnBody(board, "confirmPublished")).toContain("if (!publishCheck.ok)");
  });
  it("a person-set schedule is always a manual plan", () => {
    const body = fnBody(board, "saveSchedule");
    expect(body).toContain('schedule_kind: "manual"');
    expect(body).not.toContain('schedule_kind: "job"');
  });
  it("the database enforces the same rules", () => {
    expect(migration).toMatch(/content_cards_published_needs_evidence[\s\S]*content_publish_url_ok\(published_url\)/);
    expect(migration).toContain("Posted is retired");
    expect(migration).toContain("Only an admin can approve content");
    expect(migration).toContain("A scheduled job can only be recorded by the scheduler");
    expect(migration).toContain("Provider evidence can only be written by the publishing integration");
    expect(migration).not.toMatch(/\bdelete\s+from\b|\btruncate\b|\bdrop\s+table\b/i);
  });
});
