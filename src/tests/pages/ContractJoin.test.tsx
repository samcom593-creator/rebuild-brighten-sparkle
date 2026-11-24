import { act, fireEvent, render, screen } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { resolve, join } = vi.hoisted(() => ({ resolve: vi.fn(), join: vi.fn() }));
vi.mock("@/lib/contractingDownlines", () => ({ contractingDownlines: { resolve, join } }));
vi.mock("@/hooks/usePageTitle", () => ({ usePageTitle: vi.fn() }));
vi.mock("@/components/ui/email-typo-hint", () => ({ EmailTypoHint: () => null }));
import ContractJoin from "@/pages/ContractJoin";

beforeEach(() => {
  vi.clearAllMocks();
  resolve.mockResolvedValue({ data: { ok: true, manager_name: "Fixture Manager" }, error: null });
  join.mockResolvedValue({ data: { ok: true, manager_name: "Fixture Manager", intake_id: "receipt-1", provisioned: false, delivery: "not_configured", comp_pct: 60, redirect_url: "https://mgnagenthub.com/dashboard" }, error: null });
});
async function mount() {
  render(<MemoryRouter initialEntries={["/contract/fixture-manager"]}><Routes><Route path="/contract/:slug" element={<ContractJoin />} /></Routes></MemoryRouter>);
  await screen.findByRole("form", { name: "Contracting details" });
}
function fill(licensed: boolean) {
  fireEvent.click(screen.getByLabelText(licensed ? "I hold a current life insurance license and the NPN above is mine." : "I am not licensed yet."));
  fireEvent.change(screen.getByLabelText("Legal first name (as on your licence)"), { target: { value: "Pat" } });
  fireEvent.change(screen.getByLabelText("Legal last name (as on your licence)"), { target: { value: "Producer" } });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "pat@example.com" } });
  fireEvent.change(screen.getByLabelText("Mobile"), { target: { value: "4145550100" } });
  if (licensed) fireEvent.change(screen.getByLabelText("NPN"), { target: { value: "1234567" } });
}
describe("public contracting join receipts", () => {
  it("distinguishes a temporary lookup failure from an invalid link and supports retry", async () => {
    resolve.mockResolvedValueOnce({ data: null, error: "Lookup temporarily unavailable", status: 503 })
      .mockResolvedValueOnce({ data: { ok: true, manager_name: "Fixture Manager" }, error: null, status: 200 });
    render(<MemoryRouter initialEntries={["/contract/fixture-manager"]}><Routes><Route path="/contract/:slug" element={<ContractJoin />} /></Routes></MemoryRouter>);
    expect(await screen.findByRole("alert")).toHaveTextContent("Lookup temporarily unavailable");
    expect(screen.queryByText("This link isn't valid")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry link check" }));
    await screen.findByRole("form", { name: "Contracting details" });
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it("keeps a confirmed invalid link distinct from a service outage", async () => {
    resolve.mockResolvedValue({ data: { ok: false, error: "NO_SUCH_LINK" }, error: "That link is not valid.", status: 404 });
    render(<MemoryRouter initialEntries={["/contract/no-manager"]}><Routes><Route path="/contract/:slug" element={<ContractJoin />} /></Routes></MemoryRouter>);
    await screen.findByText("This link isn't valid");
    expect(screen.queryByRole("button", { name: "Retry link check" })).not.toBeInTheDocument();
  });

  it("clears the prior manager's saved receipt and form when opening a different team link", async () => {
    let finishLookup!: (value: unknown) => void;
    resolve.mockResolvedValueOnce({ data: { ok: true, manager_name: "First Manager" }, error: null, status: 200 })
      .mockImplementationOnce(() => new Promise((r) => { finishLookup = r; }));
    render(<MemoryRouter initialEntries={["/contract/first-manager"]}><Link to="/contract/second-manager">Open second team</Link><Routes><Route path="/contract/:slug" element={<ContractJoin />} /></Routes></MemoryRouter>);
    await screen.findByRole("form", { name: "Contracting details" });
    fill(true); fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText("Request receipt: receipt-1");
    fireEvent.click(screen.getByRole("link", { name: "Open second team" }));
    expect(screen.queryByText("Request receipt: receipt-1")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Checking your link");
    await act(async () => finishLookup({ data: { ok: true, manager_name: "Second Manager" }, error: null, status: 200 }));
    expect(await screen.findByRole("heading", { name: "Join Second Manager's team" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveValue("");
    expect(screen.getByLabelText("I hold a current life insurance license and the NPN above is mine.")).not.toBeChecked();
  });

  it("surfaces an unexpected submission error without leaving the form stuck", async () => {
    join.mockRejectedValue(new Error("Connection lost while confirming the request"));
    await mount(); fill(true); fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Connection lost while confirming the request");
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
    expect(screen.getByLabelText("Email")).toHaveValue("pat@example.com");
  });
  it("requires an explicit license choice before making a request", async () => {
    await mount();
    expect(screen.getByLabelText("I hold a current life insurance license and the NPN above is mine.")).not.toBeChecked();
    expect(screen.getByLabelText("I am not licensed yet.")).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Choose your current license status");
    expect(join).not.toHaveBeenCalled();
  });
  it("keeps the receipt and account/delivery blockers visible before the external continuation", async () => {
    await mount(); fill(true); fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("Request receipt: receipt-1")).toBeInTheDocument();
    expect(screen.getByText(/account setup needs attention/)).toBeInTheDocument();
    expect(screen.getByText(/Ethos submission is held for review/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue to MGN" })).toBeInTheDocument();
    expect(screen.queryByText(/Taking you there in/)).not.toBeInTheDocument();
    expect(join).toHaveBeenCalledWith("fixture-manager", expect.objectContaining({ license_status: "licensed", npn: "1234567" }));
  });
  it("directs an explicitly unlicensed person to licensing without claiming an Ethos submission", async () => {
    join.mockResolvedValue({ data: { ok: true, parked: true, intake_id: "receipt-2", agent_id: null }, error: null });
    await mount(); fill(false); fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("link", { name: "Start licensing" })).toHaveAttribute("href", "/get-licensed");
    expect(screen.getByText(/No Ethos submission has been made/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue to MGN" })).not.toBeInTheDocument();
  });
  it("refuses a non-HTTPS portal URL even when the hostname looks correct", async () => {
    join.mockResolvedValue({ data: { ok: true, provisioned: true, redirect_url: "http://mgnagenthub.com/dashboard" }, error: null });
    await mount(); fill(true); fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("link", { name: "Open Galaxy sign-in" });
    expect(screen.queryByRole("button", { name: "Continue to MGN" })).not.toBeInTheDocument();
  });
});
