import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Synthetic applicant only.
const { invoke, refetch } = vi.hoisted(() => ({ invoke: vi.fn(), refetch: vi.fn() }));
const status: { data: unknown; isLoading: boolean; isError: boolean; isFetching: boolean; refetch: typeof refetch } = {
  data: null, isLoading: false, isError: false, isFetching: false, refetch,
};

vi.mock("@/hooks/useApplicationStatus", () => ({
  useApplicationStatus: () => status,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke } },
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
  status.isError = false;
  status.isFetching = false;
  invoke.mockReset().mockResolvedValue({ data: null, error: { message: "offline" } });
  refetch.mockReset().mockResolvedValue({ data: null });
});
afterEach(() => vi.useRealTimers());

describe("ApplicationConfirmationV2 reads the status snapshot from the query result", () => {
  it("greets by first name and routes a licensed applicant to the hire call on /status", async () => {
    status.data = { first_name: "Jordan", license_status: "licensed" };
    renderPage();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Jordan, your application is");
    expect(screen.getAllByText("Book your hire call").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Watch the 5-min licensing video/)).toBeNull();
    await screen.findByRole("button", { name: "Try portal access again" });
  });

  it("does not guess unlicensed while the snapshot is still loading", () => {
    status.isLoading = true;
    renderPage();
    expect(screen.getByRole("status").textContent).toContain("Loading your next step");
    expect(screen.queryByText(/Watch the 5-min licensing video/)).toBeNull();
  });

  it("the unlicensed video step identifies the applicant by application id and opens in a new tab", async () => {
    status.data = { first_name: "Jordan", license_status: "unlicensed" };
    renderPage();
    const cta = screen.getByRole("link", { name: /Watch the 5-min licensing video/ });
    expect(cta.getAttribute("target")).toBe("_blank");
    expect(cta.getAttribute("href")).toBe("/get-licensed?applicationId=app-test-1#licensing-video");
    await act(async () => { await invoke.mock.results[0].value; });
  });

  it("a forced branch renders immediately, without waiting on the snapshot", async () => {
    status.isLoading = true;
    renderPage({ forceLicenseStatus: "licensed" });
    expect(screen.getAllByText("Book your hire call").length).toBeGreaterThan(0);
    await screen.findByRole("button", { name: "Try portal access again" });
  });

  it("keeps a failed status lookup unknown and lets the applicant retry", () => {
    status.isError = true;
    renderPage();
    expect(screen.getByRole("alert")).toHaveTextContent("couldn't confirm your saved next step");
    expect(screen.queryByText(/Watch the 5-min licensing video/)).toBeNull();
    expect(screen.queryByText("Application received.")).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Try application status again" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("does not claim a receipt or choose a license track without an application", () => {
    renderPage({ applicationId: null });
    expect(screen.getByRole("link", { name: "Open the application" })).toHaveAttribute("href", "/apply");
    expect(screen.queryByRole("button", { name: "Try application status again" })).toBeNull();
    expect(screen.queryByText(/Watch the 5-min licensing video/)).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("uses the recorded license status over an outdated success-page branch", async () => {
    status.data = { first_name: "Jordan", license_status: "licensed" };
    renderPage({ forceLicenseStatus: "unlicensed" });
    expect(screen.getAllByText("Book your hire call").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Watch the 5-min licensing video/)).toBeNull();
    await screen.findByRole("button", { name: "Try portal access again" });
  });

  it("keeps the hire call and normal sign-in usable when activation fails, then recovers on retry", async () => {
    status.data = { first_name: "Jordan", license_status: "licensed" };
    invoke.mockResolvedValueOnce({ data: null, error: { message: "offline" } })
      .mockResolvedValueOnce({ data: { action_link: "https://auth.example.test/verified-link" }, error: null });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Try portal access again" }));
    expect(screen.getByRole("link", { name: "Book your hire call" })).toBeInTheDocument();
    const activation = await screen.findByRole("link", { name: "Activate portal & start contracting" });
    expect(activation).toHaveAttribute("href", "https://auth.example.test/verified-link");
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenLastCalledWith("applicant-magic-link", expect.objectContaining({
      body: { applicationId: "app-test-1", redirectPath: "/dashboard/contracting-profile" },
    }));
  });

  it("hides the previous applicant's activation link immediately when the application changes", async () => {
    status.data = { first_name: "Jordan", license_status: "licensed" };
    invoke.mockResolvedValueOnce({ data: { action_link: "https://auth.example.test/first" }, error: null })
      .mockImplementationOnce(() => new Promise(() => {}));
    const page = renderPage();
    await screen.findByRole("link", { name: "Activate portal & start contracting" });
    page.rerender(<MemoryRouter><ApplicationConfirmationV2 applicationId="app-test-2" showCalendly={false} /></MemoryRouter>);
    expect(screen.queryByRole("link", { name: "Activate portal & start contracting" })).toBeNull();
    expect(screen.getByRole("link", { name: "Open portal sign-in" })).toHaveAttribute("href", "/dashboard/contracting-profile");
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
  });

  it("ignores an old applicant's late activation response", async () => {
    status.data = { first_name: "Jordan", license_status: "licensed" };
    let resolveOld!: (value: unknown) => void;
    invoke.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
      .mockResolvedValueOnce({ data: { action_link: "https://auth.example.test/second" }, error: null });
    const page = renderPage();
    page.rerender(<MemoryRouter><ApplicationConfirmationV2 applicationId="app-test-2" showCalendly={false} /></MemoryRouter>);
    expect(await screen.findByRole("link", { name: "Activate portal & start contracting" })).toHaveAttribute("href", "https://auth.example.test/second");
    await act(async () => resolveOld({ data: { action_link: "https://auth.example.test/first" }, error: null }));
    expect(screen.getByRole("link", { name: "Activate portal & start contracting" })).toHaveAttribute("href", "https://auth.example.test/second");
  });

  it("ends a stalled activation attempt with a retry and the protected sign-in path", async () => {
    vi.useFakeTimers();
    status.data = { first_name: "Jordan", license_status: "licensed" };
    invoke.mockImplementation(() => new Promise(() => {}));
    renderPage();
    await act(async () => { vi.advanceTimersByTime(12_000); });
    expect(screen.getByRole("button", { name: "Try portal access again" })).toBeEnabled();
    expect(screen.getByRole("link", { name: "Open portal sign-in" })).toHaveAttribute("href", "/dashboard/contracting-profile");
    expect(invoke.mock.calls[0][1].signal.aborted).toBe(true);
  });
});
