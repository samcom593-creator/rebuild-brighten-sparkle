import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeQuery, person, status } from "../helpers/teamContractingFixtures";

const auth = { isAdmin: true, isManager: false, isVaManager: false, isVa: false };
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const phone = vi.hoisted(() => ({ startPhoneCall: vi.fn(() => true) }));
vi.mock("@/lib/phone", async (orig) => ({ ...(await orig<typeof import("@/lib/phone")>()), startPhoneCall: phone.startPhoneCall }));
const api = vi.hoisted(() => ({
  confirmClockBasis: vi.fn(async (_b: string) => ({ ok: true })),
  logContactOutcome: vi.fn(async (_id: string, _o: string) => ({ ok: true })),
}));
vi.mock("@/lib/teamContracting", async (orig) => ({ ...(await orig<typeof import("@/lib/teamContracting")>()), confirmClockBasis: api.confirmClockBasis, logContactOutcome: api.logContactOutcome }));

import { ContractingPriorityPanel } from "@/components/team/ContractingPriorityPanel";

function renderPanel(q: unknown, contact = () => ({ phone: "+15555550101", email: "x@example.test" }), extra: Record<string, unknown> = {}) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}><MemoryRouter>
      <ContractingPriorityPanel q={q as never} contactFor={contact} onOpenPerson={vi.fn()} {...extra} />
    </MemoryRouter></QueryClientProvider>,
  );
}

beforeEach(() => { vi.clearAllMocks(); Object.assign(auth, { isAdmin: true, isManager: false, isVaManager: false, isVa: false }); });

describe("Priority 1 panel: read states", () => {
  it("shows a loading state and never an all-clear while the read is in flight", () => {
    renderPanel(fakeQuery({ isLoading: true }));
    expect(screen.getByRole("status", { name: /loading contracting status/i })).toBeInTheDocument();
    expect(screen.queryByText(/no overdue contracting actions/i)).toBeNull();
  });

  it("a failed read is its own state with Retry, and never reads as nobody being overdue", () => {
    const refetch = vi.fn(() => Promise.resolve(undefined));
    renderPanel(fakeQuery({ isError: true, refetch }));
    expect(screen.getByRole("alert")).toHaveTextContent(/contracting status unavailable/i);
    expect(screen.queryByText(/no overdue contracting actions/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("a read that returned nothing is treated as failed, not as an empty roster", () => {
    renderPanel(fakeQuery({ data: undefined }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/no overdue contracting actions/i)).toBeNull();
  });

  it("renders nothing for a role with no contracting access", () => {
    Object.assign(auth, { isAdmin: false });
    const { container } = renderPanel(fakeQuery({ data: status([person()]) }));
    expect(container).toBeEmptyDOMElement();
  });
});

describe("Priority 1 panel: timing rule not confirmed", () => {
  const unconfirmed = () => status([person(), person({ agent_id: "a2", display_name: "Bo Kim" })], { basis: { key: "unset", label: "Not confirmed", confirmed: false, confirmed_at: null, window_days: 60 } });

  it("shows no urgency at all, only the rule that must be chosen", () => {
    renderPanel(fakeQuery({ data: unconfirmed() }));
    expect(screen.getByText(/contracting urgency is off/i)).toBeInTheDocument();
    expect(screen.queryByText(/priority 1/i)).toBeNull();
    expect(screen.queryByText("Ann Lee")).toBeNull();
  });

  it("lets an admin confirm once, even when the button is hit twice", async () => {
    let release: (v: { ok: boolean }) => void = () => {};
    api.confirmClockBasis.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    renderPanel(fakeQuery({ data: unconfirmed() }));
    const btn = screen.getByRole("button", { name: /confirm and turn urgency on/i });
    act(() => { btn.click(); btn.click(); });
    expect(api.confirmClockBasis).toHaveBeenCalledTimes(1);
    expect(api.confirmClockBasis).toHaveBeenCalledWith("hired_or_licensed");
    release({ ok: true });
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it("reports a rejected save and keeps urgency off", async () => {
    api.confirmClockBasis.mockResolvedValueOnce({ ok: false, error: "not authorised" } as never);
    renderPanel(fakeQuery({ data: unconfirmed() }));
    fireEvent.change(screen.getByLabelText(/day the clock starts/i), { target: { value: "hired" } });
    fireEvent.click(screen.getByRole("button", { name: /confirm and turn urgency on/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("not authorised")));
    expect(toast.success).not.toHaveBeenCalled();
    expect(api.confirmClockBasis).toHaveBeenCalledWith("hired");
  });

  it("tells a non-admin an admin has to confirm it, with no button", () => {
    Object.assign(auth, { isAdmin: false, isManager: true });
    renderPanel(fakeQuery({ data: unconfirmed() }));
    expect(screen.getByText(/an admin needs to confirm it/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /confirm and turn urgency on/i })).toBeNull();
  });
});

describe("Priority 1 panel: confirmed rule", () => {
  it("shows a quiet verified line when nobody is overdue", () => {
    const clear = status([person({ p1: false, p1_rank: null, milestones: [] })], { counts: { p1_people: 0, due_soon_people: 2, eligible_people: 35, timing_review_people: 1, license_review_people: 0, followup_due_people: 0, total_people: 36 } });
    const onShowFilter = vi.fn();
    renderPanel(fakeQuery({ data: clear }), undefined, { onShowFilter });
    expect(screen.getByRole("heading", { name: /no overdue contracting actions/i })).toBeInTheDocument();
    expect(screen.getByText(/35 eligible people checked, as of Oct 9/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /2 due soon/i }));
    expect(onShowFilter).toHaveBeenCalledWith("due_soon");
    fireEvent.click(screen.getByRole("button", { name: /1 need timing review/i }));
    expect(onShowFilter).toHaveBeenCalledWith("timing_review");
  });

  const many = (n: number) => Array.from({ length: n }, (_, i) => person({ agent_id: `p${i + 1}`, display_name: `Person ${i + 1}`, p1_rank: n - i }));

  it("lists each overdue person once, in the server's rank order, and shows five until asked", () => {
    renderPanel(fakeQuery({ data: status(many(7)) }));
    expect(screen.getByRole("heading", { name: /priority 1 — contact now \(7\)/i })).toBeInTheDocument();
    const items = within(screen.getByRole("region", { name: /priority 1: contact now/i })).getAllByRole("listitem");
    expect(items).toHaveLength(5);
    expect(items[0]).toHaveTextContent("Person 7"); // rank 1
    expect(items[4]).toHaveTextContent("Person 3"); // rank 5
    fireEvent.click(screen.getByRole("button", { name: /show all 7/i }));
    expect(within(screen.getByRole("region", { name: /priority 1: contact now/i })).getAllByRole("listitem")).toHaveLength(7);
    expect(screen.getByRole("button", { name: /show fewer/i })).toBeInTheDocument();
  });

  it("states the reason in plain words with the clock source and days past the deadline", () => {
    renderPanel(fakeQuery({ data: status([person()]) }));
    expect(screen.getByText("Aflac and First contract overdue · 6 days since hired or licensed · 3 days past the deadline")).toBeInTheDocument();
    expect(screen.getByText(/Clock: Day hired, or the day they got licensed if later/)).toBeInTheDocument();
  });

  it("keeps an already contacted but still overdue person visible and shows the planned follow-up", () => {
    const contacted = person({ followup: { last_at: "2026-10-07T12:00:00Z", last_outcome: "no_answer", call_count: 1, next_on: "2026-10-12", next_action: "Resend packet", waiting_on: "carrier", blocker: "carrier_issue", due_now: false } });
    renderPanel(fakeQuery({ data: status([contacted]) }));
    expect(screen.getByText("Ann Lee")).toBeInTheDocument();
    expect(screen.getByText(/Follow-up Oct 12/)).toBeInTheDocument();
    expect(screen.getByText(/Waiting on the carrier/)).toBeInTheDocument();
    expect(screen.getByText(/Blocker: Carrier issue/)).toBeInTheDocument();
  });
});

describe("Priority 1 panel: calling is not contacting", () => {
  it("dialling alone records nothing; only picking an outcome records a contact, once", async () => {
    const refetch = vi.fn(() => Promise.resolve(undefined));
    renderPanel(fakeQuery({ data: status([person()]), refetch }));
    fireEvent.click(screen.getByRole("button", { name: /^call ann lee$/i }));
    expect(phone.startPhoneCall).toHaveBeenCalledWith("+15555550101");
    expect(api.logContactOutcome).not.toHaveBeenCalled();
    expect(screen.getByText(/calling does not record a contact/i)).toBeInTheDocument();
    const noAnswer = screen.getByRole("button", { name: "No answer" });
    act(() => { noAnswer.click(); noAnswer.click(); });
    expect(api.logContactOutcome).toHaveBeenCalledTimes(1);
    expect(api.logContactOutcome).toHaveBeenCalledWith("a1", "no_answer");
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it("a rejected contact log is reported and leaves the prompt open", async () => {
    api.logContactOutcome.mockResolvedValueOnce({ ok: false, error: "denied" } as never);
    renderPanel(fakeQuery({ data: status([person()]) }));
    fireEvent.click(screen.getByRole("button", { name: /^call ann lee$/i }));
    fireEvent.click(screen.getByRole("button", { name: "Talked" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("denied")));
    expect(screen.getByText(/calling does not record a contact/i)).toBeInTheDocument();
  });

  it("never offers a dead Call button when the phone number is missing", () => {
    renderPanel(fakeQuery({ data: status([person()]) }), () => ({ phone: null, email: null }));
    expect(screen.queryByRole("button", { name: /^call ann lee$/i })).toBeNull();
    expect(screen.getByText(/no phone on file/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open details for ann lee/i })).toBeInTheDocument();
  });

  it("a blocker held by someone other than the agent routes to Review blocker, which opens the follow-up", () => {
    const onOpenPerson = vi.fn();
    const blocked = person({ followup: { last_at: null, last_outcome: null, call_count: 0, next_on: null, next_action: null, waiting_on: "carrier", blocker: "carrier_issue", due_now: true } });
    renderPanel(fakeQuery({ data: status([blocked]) }), undefined, { onOpenPerson });
    fireEvent.click(screen.getByRole("button", { name: /review blocker for ann lee/i }));
    expect(onOpenPerson).toHaveBeenCalledWith("a1", "followup");
  });
});
