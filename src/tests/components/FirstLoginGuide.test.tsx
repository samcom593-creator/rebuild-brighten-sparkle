/**
 * FirstLoginGuide reads facts, not checkboxes (2026-11-10).
 *
 * The guide used to decide each step from getting_started_progress checkbox
 * columns that only a manual toggle writes. Live on 2026-11-10 all 58 agents
 * who could see it read "step 1 of 4: Set up your account", including 43 with
 * a complete profile and 5 who had already closed a deal. These tests pin the
 * fact sources: profile name + phone, any training row, license status, and
 * agents.first_deal_at, with the checkboxes kept only as a manual override.
 */
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  agent: null as null | Record<string, unknown>,
  progress: null as null | Record<string, unknown>,
  profile: null as null | Record<string, unknown>,
  training: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const rows = (): Array<Record<string, unknown>> => {
        if (table === "agents") return db.agent ? [db.agent] : [];
        if (table === "getting_started_progress") return db.progress ? [db.progress] : [];
        if (table === "profiles") return db.profile ? [db.profile] : [];
        if (table === "onboarding_progress") return db.training;
        return [];
      };
      const chain = {
        select: () => chain,
        eq: () => chain,
        limit: () => Promise.resolve({ data: rows(), error: null }),
      };
      return chain;
    },
  },
}));

import { FirstLoginGuide } from "@/components/dashboard/FirstLoginGuide";

function renderGuide() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <FirstLoginGuide agentId="agent-1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // Mark the welcome dialog as seen so only the pinned card renders.
  window.localStorage.setItem("apex.first-login-guide.v1.agent-1", "1");
  db.agent = { display_name: "Di Park", onboarding_stage: "onboarding", license_status: "licensed", contracted_at: null, first_deal_at: null, user_id: "user-1" };
  db.progress = { agent_id: "agent-1", completed_profile: null, added_phone_number: null, completed_first_training: null, received_license: null, closed_first_deal: null };
  db.profile = { full_name: "Di Park", phone: "555-0100" };
  db.training = [];
});

describe("FirstLoginGuide", () => {
  it("skips setup when the profile already has a name and phone, even with no checkbox ticked", async () => {
    renderGuide();
    expect(await screen.findByText(/step 2 of 4/)).toBeInTheDocument();
    expect(screen.getByText("Start your training")).toBeInTheDocument();
  });

  it("still asks for setup when the profile is missing a phone", async () => {
    db.profile = { full_name: "Di Park", phone: "" };
    renderGuide();
    expect(await screen.findByText(/step 1 of 4/)).toBeInTheDocument();
    expect(screen.getByText("Set up your account")).toBeInTheDocument();
  });

  it("moves a licensed agent with a training row on to contracting", async () => {
    db.training = [{ module_id: "m1" }];
    renderGuide();
    expect(await screen.findByText(/step 3 of 4/)).toBeInTheDocument();
    expect(screen.getByText("Get contracted")).toBeInTheDocument();
  });

  it("hides entirely once agents.first_deal_at is set", async () => {
    db.training = [{ module_id: "m1" }];
    db.agent = { ...db.agent, first_deal_at: "2026-11-01T00:00:00Z" };
    const { container } = renderGuide();
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
  });

  it("keeps the manual checkbox as an override when facts are missing", async () => {
    db.profile = null;
    db.progress = { ...db.progress, completed_profile: "2026-10-01T00:00:00Z" };
    renderGuide();
    expect(await screen.findByText(/step 2 of 4/)).toBeInTheDocument();
  });
});
