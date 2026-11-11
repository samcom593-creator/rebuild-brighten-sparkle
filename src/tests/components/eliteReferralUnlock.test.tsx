/**
 * Elite referral card (MP-ONBOARD-ANCHOR-PKG2, 2026-11-12).
 *
 * The card applied its own hard-coded $10,000 month-to-date sum over native deals while my_referral_status applied
 * Sam's $20,000 policy (2026-08-01) to the frozen AgentLink book. Now there is one gate: the card renders whatever
 * my_referral_status() says (policy threshold, live production) and never queries deals itself.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  status: null as unknown,
  error: null as null | { message: string },
  tables: [] as string[],
}));

vi.mock("@/hooks/useProductionRealtime", () => ({ useProductionRealtime: () => undefined }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string) => Promise.resolve(fn === "my_referral_status" ? { data: db.status, error: db.error } : { data: null, error: null }),
    from: (table: string) => {
      db.tables.push(table);
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "update"]) b[m] = () => b;
      b.maybeSingle = () => Promise.resolve({ data: { ref_slug: "pat-1a2b3c", display_name: "Pat" }, error: null });
      return b;
    },
  },
}));

import { EliteReferralUnlock } from "@/components/agent/EliteReferralUnlock";

const ROOT = resolve(__dirname, "../../..");

describe("EliteReferralUnlock reads the one referral gate", () => {
  beforeEach(() => {
    db.status = null;
    db.error = null;
    db.tables.length = 0;
  });

  it("locked: shows the policy threshold and live production, not a $10K month-to-date figure", async () => {
    db.status = { has_agent: true, ref_slug: "pat-1a2b3c", production_total: 4200, threshold: 20000, unlocked: false, remaining: 15800 };
    render(<EliteReferralUnlock agentId="a-1" />);
    const line = await screen.findByTestId("elite-referral-locked");
    expect(line.textContent).toContain("$20,000 in production");
    expect(screen.getByText("$4,200 in production")).toBeInTheDocument();
    expect(screen.getByText("$15,800 to unlock")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/MTD|\$10K/);
    expect(db.tables).not.toContain("deals");
  });

  it("unlocked: the server's verdict opens the link", async () => {
    db.status = { has_agent: true, ref_slug: "pat-1a2b3c", production_total: 99423.48, threshold: 20000, unlocked: true, remaining: 0 };
    render(<EliteReferralUnlock agentId="a-1" />);
    expect(await screen.findByText(/apply\?ref=pat-1a2b3c&elite=1/)).toBeInTheDocument();
    expect(screen.getByText(/\$99,423 in production/)).toBeInTheDocument();
  });

  it("an unreadable gate renders nothing rather than a made-up $0", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    db.error = { message: "boom" };
    const { container } = render(<EliteReferralUnlock agentId="a-1" />);
    await waitFor(() => expect(warn).toHaveBeenCalled());
    expect(container.textContent).toBe("");
    warn.mockRestore();
  });

  it("the server keeps the $20,000 policy and sums live production", () => {
    const sql = readFileSync(resolve(ROOT, "supabase/migrations/20261112000270_pkg2_referral_gate_live_production.sql"), "utf8");
    expect(sql).toContain("key='referral_unlock_threshold'),20000)");
    expect(sql).toContain("from public.mat_production_unified m");
    expect(sql).not.toMatch(/from public\.agentlink_book/);
  });
});
