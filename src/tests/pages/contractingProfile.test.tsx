import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBackend } from "../helpers/reviewFixtures";

const backend = vi.hoisted(() => ({ current: null as null | { rpc: (n: string, a?: Record<string, unknown>) => Promise<unknown> } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (n: string, a?: Record<string, unknown>) => backend.current!.rpc(n, a) } }));
vi.mock("@/hooks/usePageTitle", () => ({ usePageTitle: vi.fn() }));

import ContractingProfile from "@/pages/ContractingProfile";

let fb: ReturnType<typeof fakeBackend>;
const mount = () => {
  fb = fakeBackend([]);
  backend.current = fb;
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } })}><MemoryRouter><ContractingProfile /></MemoryRouter></QueryClientProvider>);
};
const fill = (npn = "0123456") => fireEvent.change(screen.getByLabelText("NPN number"), { target: { value: npn } });

beforeEach(() => { vi.clearAllMocks(); });

describe("Complete your contracting profile", () => {
  it("asks for the five fields and nothing else, prefilled from what the site already knows", async () => {
    mount();
    expect(await screen.findByLabelText("First name")).toHaveValue("Ava");
    expect(screen.getByLabelText("Last name")).toHaveValue("Agent");
    expect(screen.getByLabelText("Email")).toHaveValue("ava@example.test");
    expect(screen.getByLabelText("Resident state")).toHaveValue("AZ");
    expect(screen.getByLabelText("NPN number")).toHaveValue("");
    const labels = Array.from(document.querySelectorAll("label")).map((l) => l.textContent);
    expect(labels).toEqual(["First name", "Last name", "Email", "NPN number", "Resident state"]);
  });

  it("never asks the person for anything beyond the five (no phone, SSN, birth date, bank, upload, password)", async () => {
    mount();
    await screen.findByLabelText("First name");
    expect(document.querySelector('input[type="password"], input[type="file"], input[type="tel"]')).toBeNull();
    expect(screen.queryByLabelText(/phone|ssn|social|birth|bank|routing|password/i)).toBeNull();
  });

  it("says plainly that submitting does not mean carrier contracting is complete, before and after saving", async () => {
    mount();
    await screen.findByLabelText("First name");
    expect(screen.getByText(/Submitting your information does not mean carrier contracting is complete\./)).toBeInTheDocument();
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Save my profile" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/does not mean carrier contracting is complete/);
  });

  it("saves through the caller-only function with the NPN exactly as typed, leading zero intact", async () => {
    mount();
    await screen.findByLabelText("First name");
    fill("0123456");
    fireEvent.click(screen.getByRole("button", { name: "Save my profile" }));
    await waitFor(() => expect(fb.calls("save_my_contracting_profile")).toHaveLength(1));
    expect(fb.calls("save_my_contracting_profile")[0].args).toEqual({ p_npn: "0123456", p_first: "Ava", p_last: "Agent", p_email: "ava@example.test", p_state: "AZ" });
    // The save carries no agent id: it can only write to the signed-in person's own profile.
    expect(Object.keys(fb.calls("save_my_contracting_profile")[0].args)).not.toContain("p_agent_id");
  });

  it("names the field that is missing and sends nothing", async () => {
    mount();
    await screen.findByLabelText("First name");
    fireEvent.click(screen.getByRole("button", { name: "Save my profile" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("NPN number is needed.");
    expect(fb.calls("save_my_contracting_profile")).toHaveLength(0);
  });

  it("explains a malformed NPN without a round trip", async () => {
    mount();
    await screen.findByLabelText("First name");
    fill("12-34");
    fireEvent.click(screen.getByRole("button", { name: "Save my profile" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/5 to 10 digits/);
    expect(fb.calls("save_my_contracting_profile")).toHaveLength(0);
  });

  it("shows a server refusal on its field and does not say saved", async () => {
    mount();
    await screen.findByLabelText("First name");
    fb.state.profileResult = { ok: false, conflict: "npn_in_use", field: "npn", error: "That NPN is already on another profile. Nothing was saved. Staff must resolve it." };
    fill("7654321");
    fireEvent.click(screen.getByRole("button", { name: "Save my profile" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/already on another profile/);
    expect(screen.queryByText(/^Saved\./)).toBeNull();
  });

  it("blocks a double submit while saving", async () => {
    mount();
    await screen.findByLabelText("First name");
    let release!: () => void;
    fb.state.gate = { name: "save_my_contracting_profile", promise: new Promise<void>((r) => { release = r; }) };
    fill();
    const btn = screen.getByRole("button", { name: "Save my profile" });
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled());
    fireEvent.submit(screen.getByRole("form", { name: "Contracting profile" }));
    release();
    await screen.findByRole("status");
    expect(fb.calls("save_my_contracting_profile")).toHaveLength(1);
  });

  it("a login that matches no agent profile (or more than one) is told so, with no form to fill", async () => {
    fb = fakeBackend([]);
    fb.state.me = { ok: false, error: "More than one profile is linked to your login. Ask staff to merge them first." };
    backend.current = fb;
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } })}><MemoryRouter><ContractingProfile /></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByText(/More than one profile is linked to your login/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save my profile" })).toBeNull();
  });

  it("a failed load offers a retry instead of an empty form", async () => {
    fb = fakeBackend([]);
    fb.state.failNext = { name: "get_my_contracting_profile", times: 2 };
    backend.current = fb;
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } })}><MemoryRouter><ContractingProfile /></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByRole("alert")).toHaveTextContent("did not load");
    expect(screen.queryByLabelText("NPN number")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByLabelText("NPN number")).toBeInTheDocument();
  });
});
