import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "@/integrations/supabase/client";
import { SoldCallPanel } from "@/components/clients/SoldCallPanel";
import ReadyModeIntegration from "@/pages/ReadyModeIntegration";

const access = vi.hoisted(() => ({ canView: true, ready: true }));
vi.mock("@/hooks/useSoldCallKeys", () => ({ useCanViewSoldCalls: () => access }));
vi.mock("@/components/calls/CallAudioPlayer", () => ({
  CallAudioPlayer: ({ callId }: { callId: string }) => <button type="button" data-testid="private-call-player" data-call-id={callId}>Play call</button>,
}));

const tables = new Map<string, unknown[]>();
const packet = (overrides = {}) => ({
  packet_id: "packet-a", call_id: "internal-call-a", call_at: "2026-11-24T16:00:00Z",
  recording_url: null, status: "ready", has_ssn: false, has_bank: false,
  bank_name: "Example bank", ssn_last4: "4321", sensitive_pointers: { ssn: { t_start: 83 } },
  missing_fields: [], beneficiaries: [], ...overrides,
});

function mount(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter>{node}</MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  access.canView = true;
  tables.clear();
  vi.mocked(supabase.from).mockClear();
  vi.mocked(supabase.from).mockImplementation(((table: string) => {
    const result = () => ({ data: tables.get(table) ?? [], error: null });
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "is", "in", "gte", "order", "limit"]) builder[method] = () => builder;
    builder.maybeSingle = () => Promise.resolve({ data: (tables.get(table) ?? [])[0] ?? null, error: null });
    builder.then = (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject);
    return builder;
  }) as never);
  vi.mocked(supabase.functions.invoke).mockClear();
});

describe("recorded call entry points", () => {
  it("plays a sold call by internal ID even when the provider URL is absent", async () => {
    tables.set("v_sold_call_packets", [packet()]);
    const view = mount(<SoldCallPanel phone="2025550100" />);
    expect(await screen.findByTestId("private-call-player")).toHaveAttribute("data-call-id", "internal-call-a");
    expect(view.container.querySelector("button button")).toBeNull();
  });

  it("seeks the authorized private recording without opening a provider link", async () => {
    tables.set("v_sold_call_packets", [packet({ recording_url: "https://provider.example.test/private-recording.mp3" })]);
    mount(<SoldCallPanel phone="2025550100" />);
    const seek = vi.fn();
    window.addEventListener("call-audio-seek", seek);
    try {
      fireEvent.click(await screen.findByRole("button", { name: "Play recording from 1:23" }));
      expect(seek).toHaveBeenCalledTimes(1);
      expect((seek.mock.calls[0][0] as CustomEvent).detail).toEqual({ callId: "internal-call-a", seconds: 83 });
      expect(document.querySelector('a[href*="provider.example.test"]')).toBeNull();
    } finally {
      window.removeEventListener("call-audio-seek", seek);
    }
  });

  it("does not mistake a provider URL for a usable internal call identity", async () => {
    tables.set("v_sold_call_packets", [packet({ call_id: null, recording_url: "https://provider.example.test/private-recording.mp3" })]);
    mount(<SoldCallPanel phone="2025550100" />);
    await screen.findByText(/Sold call on file/);
    expect(screen.queryByTestId("private-call-player")).toBeNull();
    expect(screen.queryByRole("button", { name: /Play recording from/ })).toBeNull();
  });

  it("keeps the sold-call access gate closed", () => {
    access.canView = false;
    tables.set("v_sold_call_packets", [packet()]);
    mount(<SoldCallPanel phone="2025550100" />);
    expect(screen.queryByTestId("private-call-player")).toBeNull();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("uses the ReadyMode internal call ID without requiring or exposing a provider URL", async () => {
    tables.set("v_readymode_today", [{
      id: "internal-call-b", external_call_id: "provider-id-must-not-be-used", lead_first_name: "Example", lead_last_name: "Caller",
      call_started_at: "2026-11-24T16:00:00Z", duration_seconds: 80, recording_url: null,
    }]);
    mount(<ReadyModeIntegration />);
    fireEvent.mouseDown(await screen.findByRole("tab", { name: /Today's calls/ }), { button: 0, ctrlKey: false });
    expect(await screen.findByTestId("private-call-player")).toHaveAttribute("data-call-id", "internal-call-b");
    expect(screen.queryByRole("link", { name: "Listen" })).toBeNull();
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });
});
