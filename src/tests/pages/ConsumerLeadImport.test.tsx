import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "@/integrations/supabase/client";

const auth = vi.hoisted(() => ({ user: { id: "user-a" } as { id: string } | null }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));
vi.mock("@/components/leads/EthosConsumerCampaignPanel", () => ({ EthosConsumerCampaignPanel: () => <div>Consumer coverage preview</div> }));
import ConsumerLeadImport from "@/pages/ConsumerLeadImport";

const rpc = vi.mocked(supabase.rpc);
const masterRow = [1, "Producer Example", "P1", "Taylor Example", "123 Example Way", "TN", "6152345678", "taylor@example.test", "1980-01-03", "", "Active (inforce)", "2021-02-03", "Whole life", "POLICY-DEMO", "75", "Example Carrier"];
const receipt = (received = 1) => ({ batch_id: "batch-a", source: "MSTERRRR — policy owners", received, imported: received, matched: 0, review: 0, duplicate: 0, suppressed: 0, replayed: false });
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
  const content = () => <QueryClientProvider client={client}><MemoryRouter><ConsumerLeadImport /></MemoryRouter></QueryClientProvider>;
  return { client, content, ...render(content()) };
}
function preview(rows: unknown[][] = [masterRow]) {
  fireEvent.change(screen.getByLabelText("Consumer spreadsheet rows"), { target: { value: JSON.stringify(rows) } });
  fireEvent.click(screen.getByRole("button", { name: "Preview mapping" }));
}
beforeEach(() => {
  rpc.mockReset(); auth.user = { id: "user-a" };
  rpc.mockResolvedValue({ data: [], error: null } as never);
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

describe("consumer intake state and receipts", () => {
  it("distinguishes pending history from a confirmed empty source list", async () => {
    let finish!: (value: unknown) => void;
    rpc.mockReturnValue(new Promise(resolve => { finish = resolve; }) as never);
    mount();
    expect(screen.getByText("Loading import receipts…")).toBeInTheDocument();
    expect(screen.queryByText(/No consumer source receipts yet/)).toBeNull();
    await act(async () => finish({ data: [], error: null }));
    expect(await screen.findByText("No held consumer rows.")).toBeInTheDocument();
  });

  it("gives a retry action when receipt rows cannot be verified", async () => {
    rpc.mockImplementation(name => Promise.resolve({ data: name === "consumer_import_history" ? [{ id: "bad", receipt: {} }] : [], error: null }) as never);
    mount();
    expect(await screen.findByText("Import receipts could not be verified.")).toBeInTheDocument();
    expect(screen.queryByText(/No consumer source receipts yet/)).toBeNull();
    rpc.mockResolvedValue({ data: [], error: null } as never);
    fireEvent.click(screen.getByRole("button", { name: "Retry import receipts" }));
    expect(await screen.findByText(/No consumer source receipts yet/)).toBeInTheDocument();
  });

  it("does not let a late file read replace newer pasted rows", async () => {
    let finish!: (value: string) => void;
    const file = new File(["old"], "old.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { value: () => new Promise<string>(resolve => { finish = resolve; }) });
    mount();
    fireEvent.change(screen.getByLabelText("Upload consumer spreadsheet export"), { target: { files: [file] } });
    expect(screen.getByText("Reading the selected file…")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Consumer spreadsheet rows"), { target: { value: "Newer pasted source" } });
    await act(async () => finish("Old file contents"));
    expect(screen.getByLabelText("Consumer spreadsheet rows")).toHaveValue("Newer pasted source");
    expect(screen.queryByText("Reading the selected file…")).toBeNull();
  });

  it("clears the previous file when a different source layout is selected", async () => {
    mount(); preview();
    fireEvent.keyDown(screen.getByLabelText("Source layout"), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: "Jt — policy history" }));
    expect(screen.getByLabelText("Consumer spreadsheet rows")).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Import reviewed source" })).toBeNull();
    expect(screen.getByRole("button", { name: "Preview mapping" })).toBeDisabled();
  });

  it("stops after the current chunk when the account changes and clears local consumer data", async () => {
    let finish!: (value: unknown) => void;
    rpc.mockImplementation(name => name === "consumer_lead_import"
      ? new Promise(resolve => { finish = resolve; }) as never
      : Promise.resolve({ data: [], error: null }) as never);
    const view = mount(); preview(Array.from({ length: 251 }, (_, i) => { const row = [...masterRow]; row[13] = `DEMO-${i}`; return row; }));
    fireEvent.click(screen.getByRole("button", { name: "Import reviewed source" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("consumer_lead_import", expect.anything()));
    auth.user = { id: "user-b" }; view.rerender(view.content());
    expect(screen.getByLabelText("Consumer spreadsheet rows")).toHaveValue("");
    await act(async () => finish({ data: receipt(250), error: null }));
    expect(rpc.mock.calls.filter(([name]) => name === "consumer_lead_import")).toHaveLength(1);
    expect(screen.queryByText(/250 new contacts/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Import complete" })).toBeNull();
  });

  it("does not mark an import complete when its receipt is incomplete", async () => {
    rpc.mockImplementation(name => Promise.resolve({ data: name === "consumer_lead_import" ? { batch_id: "batch-a" } : [], error: null }) as never);
    mount(); preview();
    fireEvent.click(screen.getByRole("button", { name: "Import reviewed source" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Import did not return a verified receipt");
    expect(screen.queryByRole("button", { name: "Import complete" })).toBeNull();
    expect(screen.queryByText(/undefined imported|NaN/)).toBeNull();
  });

  it("identifies the source file and row when a consumer needs correction", async () => {
    rpc.mockImplementation(name => Promise.resolve({ data: name === "consumer_import_review" ? [{ id: "review-a", source_row: 17, source_key: "jt-policy-history", source_name: "Jt — policy history", issues: ["state_needs_review"], payload: { first_name: "Taylor", last_name: "Example", state: null } }] : [], error: null }) as never);
    mount();
    expect(await screen.findByText("Jt — policy history · row 17")).toBeInTheDocument();
    expect(screen.getByText("State needs review")).toBeInTheDocument();
  });
});
