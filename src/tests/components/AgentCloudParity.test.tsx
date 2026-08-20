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
});
