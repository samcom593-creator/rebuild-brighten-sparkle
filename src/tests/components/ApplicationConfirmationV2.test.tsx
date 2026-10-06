import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Synthetic applicant only.
const status: { data: unknown; isLoading: boolean } = { data: null, isLoading: false };

vi.mock("@/hooks/useApplicationStatus", () => ({
  useApplicationStatus: () => status,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: () => Promise.resolve({ data: null, error: { message: "offline" } }) } },
}));

vi.mock("@/components/landing/CalendlyEmbed", () => ({ CalendlyEmbed: () => null }));

import { ApplicationConfirmationV2 } from "@/components/landing/ApplicationConfirmationV2";

function renderPage(props: Partial<Parameters<typeof ApplicationConfirmationV2>[0]> = {}) {
  return render(
    <MemoryRouter>
      <ApplicationConfirmationV2 applicationId="app-test-1" showCalendly={false} {...props} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  status.data = null;
  status.isLoading = false;
});

describe("ApplicationConfirmationV2 reads the status snapshot from the query result", () => {
  it("greets by first name and routes a licensed applicant to the hire call on /status", () => {
    status.data = { first_name: "Jordan", license_status: "licensed" };
    renderPage();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Jordan, your application is");
    expect(screen.getAllByText("Book your hire call").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Watch licensing video/)).toBeNull();
  });

  it("does not guess unlicensed while the snapshot is still loading", () => {
    status.isLoading = true;
    renderPage();
    expect(screen.getByRole("status").textContent).toContain("Loading your next step");
    expect(screen.queryByText(/Watch licensing video/)).toBeNull();
  });

  it("the unlicensed fallback CTA identifies the applicant by application id", () => {
    status.data = { first_name: "Jordan", license_status: "unlicensed" };
    renderPage();
    const cta = screen.getByText(/Watch licensing video/).closest("a");
    expect(cta?.getAttribute("href")).toBe("/get-licensed?applicationId=app-test-1#licensing-video");
  });

  it("a forced branch renders immediately, without waiting on the snapshot", () => {
    status.isLoading = true;
    renderPage({ forceLicenseStatus: "licensed" });
    expect(screen.getAllByText("Book your hire call").length).toBeGreaterThan(0);
  });
});
