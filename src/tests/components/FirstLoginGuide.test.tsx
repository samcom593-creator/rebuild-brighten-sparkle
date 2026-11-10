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
  // WP6: my_activation_state() result. null = the RPC errors, so the guide
  // falls back to the direct table reads above (what the first 5 tests cover).
  activation: null as null | Record<string, unknown>,
  rpcCalls: [] as Array<{ fn: string; args: unknown }>,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string, args: unknown) => {
      db.rpcCalls.push({ fn, args });
      if (fn === "my_activation_state" && db.activation) return Promise.resolve({ data: [db.activation], error: null });
      return Promise.resolve({ data: null, error: { message: "not available in this test" } });
    },
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
  db.activation = null;
  db.rpcCalls = [];
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

/**
 * WP6 (2026-11-10): the primary path is the own-row RPC my_activation_state().
 * Licensed hires get a "Book your onboarding call" step (agents can't read the
 * booking or their single-use link under RLS, so only the RPC can show it);
 * unlicensed hires never see it. The training CTA for licensed hires is the
 * required course, and a submitted contracting profile cannot hold the guide on
 * the contracting step while staff confirm carriers.
 */
function activation(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    agent_id: "agent-1",
    first_name: "Di",
    onboarding_stage: "onboarding",
    license_status: "licensed",
    hired_at: "2026-11-09T00:00:00Z",
    profile_complete: true,
    has_phone: true,
    training_started: false,
    required_training_complete: false,
    required_passed: 0,
    required_total: 6,
    contracting_done: false,
    contracting_basis: null,
    contracting_profile_submitted: false,
    onboarding_call_booked: false,
    onboarding_call_at: null,
    onboarding_booking_url: "https://calendly.com/d/single-use-link",
    first_deal_at: null,
    manual_overrides: {},
    ...over,
  };
}

describe("FirstLoginGuide — facts from my_activation_state (WP6)", () => {
  it("asks the caller's own agent row, by id", async () => {
    db.activation = activation();
    renderGuide();
    await screen.findByText(/step 2 of 5/);
    expect(db.rpcCalls).toContainEqual({ fn: "my_activation_state", args: { p_agent_id: "agent-1" } });
  });

  it("shows a licensed hire the onboarding-call step with their booking link, in a new tab", async () => {
    db.activation = activation();
    renderGuide();
    expect(await screen.findByText(/step 2 of 5/)).toBeInTheDocument();
    expect(screen.getByText("Book your onboarding call")).toBeInTheDocument();
    const cta = screen.getByRole("link", { name: /Book my call/ });
    expect(cta).toHaveAttribute("href", "https://calendly.com/d/single-use-link");
    expect(cta).toHaveAttribute("target", "_blank");
    expect(cta).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("never shows the onboarding-call step to an unlicensed hire", async () => {
    db.activation = activation({ license_status: "unlicensed" });
    renderGuide();
    expect(await screen.findByText(/step 2 of 4/)).toBeInTheDocument();
    expect(screen.getByText("Start your training")).toBeInTheDocument();
    expect(screen.queryByText("Book your onboarding call")).not.toBeInTheDocument();
  });

  it("moves on once the call is booked, and points licensed training at the required course", async () => {
    db.activation = activation({ onboarding_call_booked: true, onboarding_call_at: "2026-11-12T17:00:00Z", required_passed: 2 });
    renderGuide();
    expect(await screen.findByText(/step 3 of 5/)).toBeInTheDocument();
    expect(screen.getByText("Start your training")).toBeInTheDocument();
    expect(screen.getByText(/2 of 6 required modules passed/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Start training/ })).toHaveAttribute("href", "/dashboard/training/sales-course");
  });

  it("does not stall on contracting once the agent's contracting profile is in", async () => {
    db.activation = activation({ onboarding_call_booked: true, training_started: true });
    const { unmount } = renderGuide();
    expect(await screen.findByText(/step 4 of 5/)).toBeInTheDocument();
    expect(screen.getByText("Get contracted")).toBeInTheDocument();
    unmount();

    db.activation = activation({ onboarding_call_booked: true, training_started: true, contracting_profile_submitted: true });
    renderGuide();
    expect(await screen.findByText(/step 5 of 5/)).toBeInTheDocument();
    expect(screen.getByText("Start writing")).toBeInTheDocument();
  });

  it("hides once the facts show a first deal", async () => {
    db.activation = activation({ first_deal_at: "2026-11-01T00:00:00Z" });
    const { container } = renderGuide();
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
  });

  it("keeps the checkbox override on the facts path too", async () => {
    db.activation = activation({ profile_complete: false, manual_overrides: { completed_profile: "2026-10-01T00:00:00Z" } });
    renderGuide();
    expect(await screen.findByText(/step 2 of 5/)).toBeInTheDocument();
  });

  it("falls back to direct reads (no call step) when the RPC errors", async () => {
    db.activation = null;
    renderGuide();
    expect(await screen.findByText(/step 2 of 4/)).toBeInTheDocument();
    expect(screen.queryByText("Book your onboarding call")).not.toBeInTheDocument();
    expect(db.rpcCalls.length).toBe(1);
  });
});
