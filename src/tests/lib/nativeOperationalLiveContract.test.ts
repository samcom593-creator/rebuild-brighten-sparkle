import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = (file: string) => fs.readFileSync(path.resolve(__dirname, `../../../${file}`), "utf8");

describe("APEX native live operating contract", () => {
  const migration = source("supabase/migrations/20260827200000_native_live_dashboard_and_dual_channel_receipts.sql");

  it("refreshes every dashboard representation immediately after native mutations", () => {
    const invalidation = source("src/lib/invalidateOperationalTruth.ts");
    const submit = source("src/components/deals/SubmitDealDialog.tsx");
    const addAgent = source("src/components/dashboard/AddAgentModal.tsx");
    for (const key of [
      "apex-home-dashboard",
      "scoped-production-scoreboard",
      "crm-today-production",
      "imo-by-agency",
      "admin-operations-command-center",
      "recruiting-quick-view",
    ]) expect(invalidation).toContain(`"${key}"`);
    expect(submit).toContain("invalidateOperationalTruth(queryClient)");
    expect(addAgent).toContain("invalidateOperationalTruth(queryClient)");
  });

  it("subscribes to native, external, and hiring truth without a forward AgentLink dependency", () => {
    const realtime = source("src/hooks/useProductionRealtime.ts");
    for (const table of ["deals", "production_external_deals", "production_external_daily_snapshots", "applications", "agents"]) {
      expect(realtime).toContain(`table: "${table}"`);
    }
    expect(realtime).not.toContain('table: "agentlink_sync_log"');
  });

  it("queues each new hire and each named external deal to both Slack and Discord exactly once", () => {
    expect(migration).toContain("public.fn_notify_agent_hired");
    expect(migration).toContain("public.fn_queue_external_deal_channels");
    for (const suffix of [":slack", ":discord"]) {
      expect(migration).toContain(`'agent.hired:' || new.id::text || '${suffix}'`);
      expect(migration).toContain(`'external.deal.posted:' || new.id::text || '${suffix}'`);
    }
    expect(migration).toContain("on conflict (idempotency_key) do nothing");
  });

  it("retires forward cloud writes while preserving the native record", () => {
    const legacyForm = source("src/components/deals/DealEntryForm.tsx");
    const dispatcher = source("supabase/functions/apex-outbox-dispatcher/index.ts");
    expect(migration).toContain("drop trigger if exists trg_deals_autopush_insuracloud");
    expect(migration).toContain("public.fn_block_retired_cloud_outbox");
    expect(legacyForm).not.toContain('invoke("insuracloud-outbox"');
    expect(dispatcher).toContain("Legacy cloud forwarding is retired");
  });
});
