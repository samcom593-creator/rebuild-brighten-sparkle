import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "@/integrations/supabase/client";
import { buildPublicRecruitingHref } from "@/lib/publicRecruitingFlow";

const api = vi.hoisted(() => ({
  rpc: vi.fn<(fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>>(),
  invoke: vi.fn<(fn: string) => Promise<{ data: unknown; error: unknown }>>(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: api.rpc, functions: { invoke: api.invoke } },
}));
vi.mock("@/hooks/useLandingLiveStats", () => ({ useLandingLiveStats: () => ({ data: null, isError: false }) }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// Keep the real form and restore/resume effects; expose the first step's value
// without depending on decorative classes used by the Yes/No controls.
vi.mock("@/pages/apply/QuickQualifyStep", () => ({
  QuickQualifyStep: ({ licenseStatus, onLicenseStatusChange }: {
    licenseStatus: string;
    onLicenseStatusChange: (status: "licensed" | "unlicensed") => void;
  }) => <div>
    <output data-testid="license-status">{licenseStatus}</output>
    <button type="button" onClick={() => onLicenseStatusChange("unlicensed")}>Choose unlicensed</button>
  </div>,
}));

import Apply from "@/pages/Apply";

const form = (query: string) => render(<MemoryRouter initialEntries={[`/apply?source=ad&${query}`]}><Apply /></MemoryRouter>);

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  vi.clearAllMocks();
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  api.invoke.mockReset().mockResolvedValue({ data: { managers: [] }, error: null });
  api.rpc.mockReset().mockResolvedValue({ data: null, error: null });
});
afterEach(() => vi.restoreAllMocks());

describe("Apply license defaults respect applicant answers", () => {
  it.each([
    ["licensed-producer", "licensed"],
    ["licensing-roadmap", "unlicensed"],
    ["agency-builder", "unlicensed"],
    ["unknown", "unlicensed"],
  ])("defaults a new %s application to %s", async (track, expected) => {
    form(`track=${track}`);
    expect((await screen.findByTestId("license-status")).textContent).toBe(expected);
  });

  it.each(["unlicensed", "pending"])("keeps a saved %s answer despite a licensed-producer link", async (savedStatus) => {
    sessionStorage.setItem("apex_apply_form", JSON.stringify({ licenseStatus: savedStatus }));
    form("track=licensed-producer");
    await waitFor(() => expect(screen.getByTestId("license-status").textContent).toBe(savedStatus));
  });

  it("keeps a restored licensed answer on the licensing-roadmap path", async () => {
    sessionStorage.setItem("apex_apply_form", JSON.stringify({ licenseStatus: "licensed" }));
    form("track=licensing-roadmap");
    await waitFor(() => expect(screen.getByTestId("license-status").textContent).toBe("licensed"));
  });

  it("lets the resume response replace the initial default with its saved answer", async () => {
    let resolveResume!: (result: { data: unknown; error: unknown }) => void;
    api.rpc.mockImplementationOnce(() => new Promise((resolve) => { resolveResume = resolve; }));
    form("track=licensed-producer&resume=11111111-2222-4333-8444-555555555555");
    expect(screen.getByTestId("license-status").textContent).toBe("licensed");
    await act(async () => resolveResume({ data: { licenseStatus: "unlicensed" }, error: null }));
    expect(screen.getByTestId("license-status").textContent).toBe("unlicensed");
    expect(supabase.rpc).toHaveBeenCalledWith("get_partial_application_resume", { p_partial_id: "11111111-2222-4333-8444-555555555555" });
  });

  it("does not reapply the URL default after the applicant changes their answer", async () => {
    form("track=licensed-producer");
    fireEvent.click(screen.getByRole("button", { name: "Choose unlicensed" }));
    await waitFor(() => expect(screen.getByTestId("license-status").textContent).toBe("unlicensed"));
  });

  it("reaches the real Quick Qualify flow after both paid-funnel hops", async () => {
    const landing = new URLSearchParams("utm_medium=paid_social&utm_source=synthetic-campaign");
    const vsl = new URL(buildPublicRecruitingHref("/vsl", landing, "licensed-producer"), "https://galaxyfinancial.org");
    const apply = buildPublicRecruitingHref("/apply", vsl.searchParams);
    render(<MemoryRouter initialEntries={[apply]}><Apply /></MemoryRouter>);
    expect((await screen.findByTestId("license-status")).textContent).toBe("licensed");
  });
});
