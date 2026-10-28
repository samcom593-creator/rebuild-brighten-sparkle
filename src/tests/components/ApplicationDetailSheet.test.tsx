import { fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), toast: vi.fn(), close: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => {
  let writing = false;
  const q = { select: () => q, eq: () => q, order: () => q, limit: () => q,
    update: (value: unknown) => { writing = true; void value; return q; },
    maybeSingle: () => mock.read(), single: () => writing ? mock.save() : mock.read() };
  return q;
} } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: false }) }));
vi.mock("sonner", () => ({ toast: Object.assign(mock.toast, { error: mock.toast }) }));
vi.mock("@/lib/logLeadActivity", () => ({ logLeadActivity: vi.fn() }));
vi.mock("@/components/dashboard/LicensingDelegateSection", () => ({ LicensingDelegateSection: () => null }));
vi.mock("@/components/dashboard/CallTranscriptsSection", () => ({ CallTranscriptsSection: () => null }));
vi.mock("@/components/crm/LeadInsightsPanel", () => ({ LeadInsightsPanel: () => null }));
vi.mock("@/components/dashboard/CandidateGoalsNotesPanel", () => ({ CandidateGoalsNotesPanel: () => null }));
import { ApplicationDetailSheet } from "@/components/dashboard/ApplicationDetailSheet";
const person = { id: "person-1", first_name: "Alex", last_name: "Rivera", email: "alex@example.test", created_at: "2026-10-01T12:00:00Z" };
function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><ApplicationDetailSheet open applicationId={person.id} onOpenChange={mock.close} /></QueryClientProvider>);
  return qc;
}
beforeEach(() => { mock.read.mockReset().mockResolvedValue({ data: person, error: null }); mock.save.mockReset(); mock.toast.mockClear(); mock.close.mockClear(); });
async function edit() { fireEvent.click(await screen.findByRole("button", { name: /^Edit$/ })); fireEvent.change(screen.getByLabelText("First Name"), { target: { value: "My draft" } }); }
it("keeps an unfinished draft through a background refresh", async () => {
  const qc = mount(); await edit();
  act(() => { qc.setQueryData(["application-detail", person.id, undefined], { ...person, first_name: "Server update" }); });
  expect(screen.getByLabelText("First Name")).toHaveValue("My draft");
});
it("retains edits and unlocks Save after a thrown network failure, then saves successfully", async () => {
  mock.save.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ data: { ...person, first_name: "My draft" }, error: null });
  mount(); await edit(); fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
  await waitFor(() => expect(mock.toast).toHaveBeenCalledWith("Could not save changes", expect.objectContaining({ description: expect.any(String) })));
  expect(screen.getByLabelText("First Name")).toHaveValue("My draft");
  expect(screen.getByRole("button", { name: "Save Changes" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
  await screen.findByRole("button", { name: /^Edit$/ });
  expect(mock.toast).toHaveBeenCalledWith("Lead info updated");
});
it("does not report success when no writable row is returned", async () => {
  mock.save.mockResolvedValue({ data: null, error: null }); mount(); await edit();
  fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
  await waitFor(() => expect(mock.toast).toHaveBeenCalledWith("Could not save changes", expect.objectContaining({ description: expect.any(String) })));
  expect(screen.getByLabelText("First Name")).toHaveValue("My draft");
});
it("protects a draft when closing until discard is explicitly chosen", async () => {
  mount(); await edit(); fireEvent.click(screen.getByRole("button", { name: /^Close$/ }));
  expect(await screen.findByText(/You have unsaved changes/)).toBeTruthy(); expect(mock.close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(screen.getByLabelText("First Name")).toHaveValue("My draft");
  fireEvent.click(screen.getByRole("button", { name: /^Close$/ }));
  fireEvent.click(screen.getByRole("button", { name: "Discard changes" })); expect(mock.close).toHaveBeenCalledWith(false);
});
it("distinguishes load failure from a missing record and can retry", async () => {
  mock.read.mockResolvedValueOnce({ data: null, error: new Error("offline") }).mockResolvedValue({ data: person, error: null });
  mount(); fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
  await screen.findByRole("button", { name: /^Edit$/ });
});
