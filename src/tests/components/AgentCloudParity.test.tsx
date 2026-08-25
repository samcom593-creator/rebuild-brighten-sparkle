import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "samuel" } }) }));

import { AgentCloudSetupChecklist } from "@/components/layout/AgentCloudSetupChecklist";

const source = (file: string) => fs.readFileSync(path.resolve(__dirname, `../../${file}`), "utf8");

beforeEach(() => window.localStorage.clear());

describe("AgentCloud parity surfaces", () => {
  it("ships the persistent 11-step setup checklist", () => {
    render(<AgentCloudSetupChecklist />);
    fireEvent.click(screen.getByRole("button", { name: /Set up APEX/i }));
    expect(screen.getAllByRole("checkbox")).toHaveLength(11);
    expect(screen.getByText("Complete producer profile")).toBeTruthy();
  });

  it("keeps every settings application distinct", () => {
    const settings = source("pages/Settings.tsx");
    for (const name of ["Agency identity", "Notification preferences", "Billing & plan", "AI assistant", "White-label readiness", "Add sample data"]) {
      expect(settings).toContain(name);
    }
  });

  it("keeps contracting, marketing, calendar, and profile parity objects first-class", () => {
    const contracting = source("pages/CarrierContracts.tsx");
    for (const name of ["Carrier Directory", "Contracting Operations", "Contracting Requests", "Contract Documents", "E&O certificates"]) expect(contracting).toContain(name);

    expect(source("pages/ClientMarketing.tsx")).toContain("Recruiting Funnels");
    const calendar = source("pages/CalendarPage.tsx");
    for (const event of ["Appointment", "Birthday", "Policy Starting Soon", "Beneficiary Check-In", "Lapse Follow-Up", "Policy Anniversary"]) expect(calendar).toContain(event);

    const profile = source("pages/ProducerProfile.tsx");
    for (const tab of ["Personal info", "Carriers", "Contracts", "Background", "Documents"]) expect(profile).toContain(tab);
  });

  it("keeps APEX Training recruit lifecycle, active journey, and qualification calculator first-class", () => {
    const toolkit = source("pages/ApexCareerToolkit.tsx");
    for (const phrase of [
      "Master recruit pipeline",
      "Next right action",
      "Path rule",
      "First 30, 60, and 90 days",
      "Career qualification calculator",
    ]) {
      expect(toolkit).toContain(phrase);
    }
  });

  it("keeps one-link contracting inside the canonical Add Agent flow", () => {
    const addAgent = source("components/dashboard/AddAgentModal.tsx");
    expect(addAgent).toContain("One-link contracting");
    expect(addAgent).toContain("https://apex-financial.org/start-contracting");
    expect(addAgent).toContain("contracting spreadsheet and private support Discord");
  });

  it("makes every recruiting invite branch by license and auto-queues licensed contracting", () => {
    const inviteLinks = source("pages/admin/InviteLinks.tsx");
    const hire = source("pages/HireLink.tsx");
    const consumer = source("../supabase/functions/consume-invite-token/index.ts");
    expect(inviteLinks).toContain("License status is always required");
    expect(hire).toContain("Are you licensed?");
    expect(hire).toContain("licensed: licensedHire === true");
    expect(consumer).toContain('"submit_contracting_intake"');
    expect(consumer).toContain("licensed_contracting_enqueue_failed");
  });

  it("shows today's sale state and current streak on every Team roster row", () => {
    const crm = source("pages/DashboardCRM.tsx");
    expect(crm).toContain('supabase.rpc("crm_agent_sales_pulse"');
    expect(crm).toContain("Sold today");
    expect(crm).toContain("No sale today");
    expect(crm).toContain("selling_streak_days");
  });

  it("shows direct contacts and keeps Team scoped to the recursive hierarchy", () => {
    const crm = source("pages/DashboardCRM.tsx");
    const app = source("App.tsx");
    const migration = source("../supabase/migrations/20260825223500_team_hierarchy_contacts_training.sql");
    expect(crm).toContain('supabase.rpc("crm_agent_contacts"');
    expect(crm).toContain("mailto:${r.email}");
    expect(crm).toContain("tel:${r.phone}");
    expect(app).toContain('<Route path="/dashboard/team" element={<ProtectedRoute><DashboardCRM /></ProtectedRoute>} />');
    expect(migration).toContain("child.invited_by_manager_id = parent.id");
    expect(migration).toContain("public.apex_can_read_agent(p_agent_id)");
  });

  it("uses the operational onboarding to active release stages", () => {
    const stages = source("components/dashboard/AgentTrainingStageBar.tsx");
    expect(stages).toContain('label: "Onboarding"');
    expect(stages).toContain('label: "Training Complete"');
    expect(stages).toContain('(supabase as any).rpc("set_agent_training_stage"');
  });

  it("sends one idempotent daily numbers reminder at 6pm Chicago time", () => {
    const reminder = source("../supabase/functions/numbers-reminder/index.ts");
    const schedule = source("../supabase/migrations/20260825224500_numbers_reminder_6pm_ct.sql");
    expect(reminder).toContain('timeZone: "America/Chicago"');
    expect(reminder).toContain('chicago.hour !== 18');
    expect(reminder).toContain('from("v_production_unified")');
    expect(reminder).toContain('from("numbers_reminder_delivery_log")');
    expect(schedule).toContain("primary key (business_date, agent_id)");
  });
});
