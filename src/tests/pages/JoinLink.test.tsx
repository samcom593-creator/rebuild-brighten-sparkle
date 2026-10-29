/**
 * /join/:token, the page a Refer a recruit link opens (OVERHAUL-1, 2026-10-29). A link made as
 * Licensed or Not licensed yet shows that path instead of a toggle that would not count (the
 * server reads the path from the claimed row), and a permanent link prints no expiry date.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "@/integrations/supabase/client";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import JoinLink from "@/pages/JoinLink";

function renderJoin() {
  return render(
    <MemoryRouter initialEntries={["/join/tok-123456789"]}>
      <Routes>
        <Route path="/join/:token" element={<JoinLink />} />
        <Route path="/get-licensed" element={<p>Licensing steps</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const prefill = (over: Record<string, unknown>) => ({
  data: {
    ok: true, kind: "join", expires_at: null, permanent: true,
    prefill: { full_name: "Test Prospect", phone: "6025550199", email: "prospect@example.test", state: null, license_status: "unlicensed", license_status_locked: true },
    ...over,
  },
  error: null,
});

beforeEach(() => {
  // The recipient's own toggle is a Radix Switch, which measures itself with ResizeObserver.
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.mocked(supabase.rpc).mockReset();
  vi.mocked(supabase.functions.invoke).mockReset();
  vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: { ok: true, kind: "join", application_id: "app-1", licensed: false }, error: null } as never);
});

afterEach(() => vi.unstubAllGlobals());

describe("JoinLink", () => {
  it("shows the license path the link was made with, not a toggle, and sends it", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue(prefill({}) as never);
    renderJoin();
    expect(await screen.findByTestId("join-license-locked")).toHaveTextContent("Not licensed yet");
    expect(screen.queryByTestId("join-licensed-toggle")).toBeNull();
    // A permanent link names no expiry.
    expect(screen.queryByText(/expires/)).toBeNull();
    fireEvent.click(screen.getByTestId("join-submit"));
    await waitFor(() => expect(supabase.functions.invoke).toHaveBeenCalledTimes(1));
    const [fn, opts] = vi.mocked(supabase.functions.invoke).mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(fn).toBe("consume-invite-token");
    expect(opts.body).toMatchObject({ token: "tok-123456789", licensed: false, email: "prospect@example.test" });
  });

  it("a link made as Licensed sends licensed", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue(prefill({ prefill: { full_name: "Lic Ensed", phone: "6025550198", email: "lic@example.test", license_status: "licensed", license_status_locked: true } }) as never);
    renderJoin();
    expect(await screen.findByTestId("join-license-locked")).toHaveTextContent("Licensed agent");
    fireEvent.click(screen.getByTestId("join-submit"));
    await waitFor(() => expect(supabase.functions.invoke).toHaveBeenCalledTimes(1));
    expect((vi.mocked(supabase.functions.invoke).mock.calls[0][1] as { body: Record<string, unknown> }).body.licensed).toBe(true);
  });

  it("an open link (no license picked) keeps the recipient's own toggle, and a temporary one names its date", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue(prefill({
      expires_at: "2026-11-04T15:00:00Z", permanent: false,
      prefill: { full_name: null, phone: null, email: null, license_status: null, license_status_locked: false },
    }) as never);
    renderJoin();
    expect(await screen.findByTestId("join-licensed-toggle")).toBeInTheDocument();
    expect(screen.queryByTestId("join-license-locked")).toBeNull();
    expect(screen.getByText(/expires/)).toBeInTheDocument();
  });
});
