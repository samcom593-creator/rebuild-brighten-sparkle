import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "@/integrations/supabase/client";
import { looseSupabase } from "@/lib/looseSupabase";
import { ClientCallHistory } from "@/components/clients/ClientCallHistory";

const auth = vi.hoisted(() => ({ user: { id: "user-a" } as { id: string } | null }));
const notice = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));
vi.mock("sonner", () => ({ toast: notice }));
vi.mock("@/components/calls/CallAudioPlayer", () => ({
  CallAudioPlayer: ({ callId }: { callId: string }) => <button type="button" data-testid="private-call-player" data-call-id={callId}>Play call</button>,
}));

const rpc = vi.mocked(looseSupabase.rpc);
const call = { key: "readymode:call-a", source_id: "call-a", source: "readymode", happened_at: "2026-11-24T16:00:00Z", category: "objection", outcome: "Bank Objection", duration_seconds: 120, transcript: null, audio_url: null, transcript_access: "restricted" };
const page = (overrides = {}) => ({ client_id: "client-a", raw_provider_access: false, ambiguous_phone: false, calls: [], next_cursor: null, ...overrides });
function mount(client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })) {
  return { client, ...render(<QueryClientProvider client={client}><ClientCallHistory clientId="client-a" /></QueryClientProvider>) };
}

beforeEach(() => { rpc.mockReset(); vi.mocked(supabase.functions.invoke).mockClear(); notice.success.mockReset(); notice.error.mockReset(); auth.user = { id: "user-a" }; });

describe("client call history", () => {
  it("offers server-authorized private playback while withholding restricted provider text and URLs", async () => {
    rpc.mockResolvedValue({ data: page({ calls: [{ ...call, transcript: "Must never render", audio_url: "https://recordings.example.test/private.wav", transcript_access: "available" }] }), error: null } as never);
    mount();
    expect(await screen.findByText(/Raw provider transcripts and audio require existing call-access permission/)).toBeInTheDocument();
    expect(screen.queryByText("Must never render")).toBeNull();
    expect(screen.queryByRole("link", { name: "Open recording" })).toBeNull();
    expect(screen.getByTestId("private-call-player")).toHaveAttribute("data-call-id", call.source_id);
    expect(document.querySelector('a[href="https://recordings.example.test/private.wav"]')).toBeNull();
    expect(screen.getByText("Bank Objection")).toBeInTheDocument();
  });

  it("offers the private player without a provider URL and preserves row-level transcript restrictions", async () => {
    rpc.mockResolvedValue({ data: page({ raw_provider_access: true, calls: [{ ...call, transcript: "Still restricted" }] }), error: null } as never);
    mount();
    expect(await screen.findByTestId("private-call-player")).toHaveAttribute("data-call-id", call.source_id);
    expect(screen.queryByText("Still restricted")).toBeNull();
    expect(screen.queryByRole("link", { name: "Open recording" })).toBeNull();
  });

  it("removes a previous account's private player while the new account's history is unavailable", async () => {
    rpc.mockResolvedValueOnce({ data: page({ calls: [call] }), error: null } as never);
    const view = mount();
    await screen.findByTestId("private-call-player");
    auth.user = { id: "user-b" };
    rpc.mockResolvedValue({ data: null, error: new Error("Client not found or access denied") } as never);
    view.rerender(<QueryClientProvider client={view.client}><ClientCallHistory clientId="client-a" /></QueryClientProvider>);
    expect(screen.queryByTestId("private-call-player")).toBeNull();
    expect(await screen.findByRole("alert")).toHaveTextContent("does not have access");
  });

  it("uses stable page cursors and resets them when the category changes", async () => {
    rpc.mockImplementation((name, args) => Promise.resolve({ data: name === "producer_client_calls" ? page({ calls: args?.p_before_at ? [{ ...call, key: "readymode:older", source_id: "older", happened_at: "2026-11-23T16:00:00Z", outcome: "Earlier call" }] : [call], next_cursor: args?.p_before_at || args?.p_category ? null : { at: call.happened_at, key: call.key } }) : null, error: null }) as never);
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Load earlier calls" }));
    expect(await screen.findByText("Earlier call")).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith("producer_client_calls", expect.objectContaining({ p_client_id: "client-a", p_before_at: call.happened_at, p_before_key: call.key }));
    fireEvent.change(screen.getByLabelText("Show"), { target: { value: "objection" } });
    await waitFor(() => expect(rpc).toHaveBeenLastCalledWith("producer_client_calls", { p_client_id: "client-a", p_category: "objection", p_before_at: null, p_before_key: null }));
    await waitFor(() => expect(screen.queryByText("Earlier call")).toBeNull());
  });

  it("saves manual transcripts to the current client without invoking transcription services", async () => {
    rpc.mockImplementation((name) => Promise.resolve({ data: name === "producer_client_calls" ? page() : "transcript-a", error: null }) as never);
    mount();
    await screen.findByText("No calls or saved transcripts have been matched to this client.");
    fireEvent.click(screen.getByText("Save a client transcript"));
    fireEvent.change(screen.getByLabelText("Transcript"), { target: { value: "Client requested a follow-up next Tuesday." } });
    fireEvent.change(screen.getByLabelText("Transcript category"), { target: { value: "follow_up" } });
    fireEvent.change(screen.getByLabelText("Outcome (optional)"), { target: { value: "Follow-up agreed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save transcript" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("producer_save_client_transcript", { p_client_id: "client-a", p_transcript: "Client requested a follow-up next Tuesday.", p_category: "follow_up", p_outcome: "Follow-up agreed" }));
    await waitFor(() => expect(notice.success).toHaveBeenCalledWith("Transcript saved to this client."));
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Transcript")).toHaveValue("");
  });

  it("keeps a failed save available to retry and never reports success", async () => {
    rpc.mockImplementation((name) => Promise.resolve({ data: name === "producer_client_calls" ? page() : null, error: name === "producer_save_client_transcript" ? new Error("Access changed") : null }) as never);
    mount();
    await screen.findByText("Save a client transcript");
    fireEvent.click(screen.getByText("Save a client transcript"));
    fireEvent.change(screen.getByLabelText("Transcript"), { target: { value: "A transcript that must remain available after a failure." } });
    fireEvent.click(screen.getByRole("button", { name: "Save transcript" }));
    await waitFor(() => expect(notice.error).toHaveBeenCalledWith("Access changed"));
    expect(notice.success).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Transcript")).toHaveValue("A transcript that must remain available after a failure.");
  });

  it("shows an access state rather than claiming an empty history or permitting a save", async () => {
    rpc.mockResolvedValue({ data: null, error: new Error("Client not found or access denied") } as never);
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("Your current account does not have access");
    expect(screen.queryByText("Save a client transcript")).toBeNull();
    expect(screen.queryByText("No calls or saved transcripts have been matched to this client.")).toBeNull();
  });

  it("does not display another login’s cached transcript after an account change", async () => {
    rpc.mockResolvedValueOnce({ data: page({ calls: [{ ...call, key: "manual:call-a", source: "manual", transcript: "Only the previous login may see this.", transcript_access: "available" }] }), error: null } as never);
    const view = mount();
    await screen.findByText("Only the previous login may see this.");
    auth.user = { id: "user-b" };
    rpc.mockResolvedValue({ data: null, error: new Error("Client not found or access denied") } as never);
    view.rerender(<QueryClientProvider client={view.client}><ClientCallHistory clientId="client-a" /></QueryClientProvider>);
    expect(screen.queryByText("Only the previous login may see this.")).toBeNull();
    expect(await screen.findByRole("alert")).toHaveTextContent("does not have access");
  });

  it("does not carry a draft transcript or category to a different client", async () => {
    rpc.mockImplementation((_name, args) => Promise.resolve({ data: page({ client_id: args?.p_client_id }), error: null }) as never);
    const view = mount();
    fireEvent.click(await screen.findByText("Save a client transcript"));
    fireEvent.change(screen.getByLabelText("Transcript"), { target: { value: "Draft belonging only to the first client." } });
    fireEvent.change(screen.getByLabelText("Transcript category"), { target: { value: "sale" } });
    fireEvent.change(screen.getByLabelText("Show"), { target: { value: "objection" } });
    view.rerender(<QueryClientProvider client={view.client}><ClientCallHistory clientId="client-b" /></QueryClientProvider>);
    fireEvent.click(await screen.findByText("Save a client transcript"));
    expect(screen.getByLabelText("Transcript")).toHaveValue("");
    expect(screen.getByLabelText("Transcript category")).toHaveValue("discovery");
    expect(screen.getByLabelText("Show")).toHaveValue("all");
    expect(screen.getByRole("button", { name: "Save transcript" })).toBeDisabled();
  });

  it("clears draft transcript text when the signed-in account changes", async () => {
    rpc.mockResolvedValue({ data: page(), error: null } as never);
    const view = mount();
    fireEvent.click(await screen.findByText("Save a client transcript"));
    fireEvent.change(screen.getByLabelText("Transcript"), { target: { value: "Unsaved private transcript from the first login." } });
    auth.user = { id: "user-b" };
    view.rerender(<QueryClientProvider client={view.client}><ClientCallHistory clientId="client-a" /></QueryClientProvider>);
    fireEvent.click(await screen.findByText("Save a client transcript"));
    expect(screen.getByLabelText("Transcript")).toHaveValue("");
  });

  it("does not apply a previous client’s delayed save confirmation to the new client", async () => {
    let finish!: (value: unknown) => void;
    rpc.mockImplementation((name, args) => name === "producer_save_client_transcript"
      ? new Promise(resolve => { finish = resolve; }) as never
      : Promise.resolve({ data: page({ client_id: args?.p_client_id }), error: null }) as never);
    const view = mount();
    fireEvent.click(await screen.findByText("Save a client transcript"));
    fireEvent.change(screen.getByLabelText("Transcript"), { target: { value: "An earlier client's transcript being saved." } });
    fireEvent.click(screen.getByRole("button", { name: "Save transcript" }));
    view.rerender(<QueryClientProvider client={view.client}><ClientCallHistory clientId="client-b" /></QueryClientProvider>);
    fireEvent.click(await screen.findByText("Save a client transcript"));
    fireEvent.change(screen.getByLabelText("Transcript"), { target: { value: "The new client's unsaved draft." } });
    await act(async () => finish({ data: "saved-transcript", error: null }));
    expect(screen.getByLabelText("Transcript")).toHaveValue("The new client's unsaved draft.");
    expect(notice.success).not.toHaveBeenCalled();
  });
});
