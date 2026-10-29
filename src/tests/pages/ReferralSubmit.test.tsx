/**
 * Refer a recruit (src/pages/ReferralSubmit.tsx).
 *
 * Grow review fixes 2026-10-28: the page sits in the standard frame (a PageHeader with a
 * one-sentence subtitle and no header button); the bonus is a quiet line in plain words with no
 * "AP"; every control is at least 44px, every word at least 13px; errors are 14px words; a failed
 * send keeps what was typed and says why on the page. The submit_referral RPC call is unchanged.
 *
 * OVERHAUL-1 (2026-10-29): the page leads with links. Your permanent /r/<slug> link with Copy
 * and Share, then Make a link (a prospect join link credited to you), then "Rather we call
 * them?", which opens the referral form exactly as it was. While that form is open it holds the
 * page's one gold button (Send referral, then See my referrals); otherwise Make link does.
 *
 * Colour layer (2026-10-28): a sent referral celebrates once, from the Send button, after the
 * RPC resolved; a failed send celebrates nothing; the confirmation pops in; the header bubble is
 * decoration beside a title that stays the accessible name.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "@/integrations/supabase/client";

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));
// The colour layer's side effects are observed, never run: canvas-confetti has no canvas in jsdom.
vi.mock("@/lib/celebrate", () => ({ celebrate: vi.fn(() => Promise.resolve()), prefersReducedMotion: () => true }));
vi.mock("@/hooks/useSoundEffects", () => ({ playSoundEffect: vi.fn(), useSoundEffects: () => ({ playSound: vi.fn() }) }));
// A plain agent: the page's audience.
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "user-ana" }, isAdmin: false, isManager: false }) }));

import ReferralSubmit from "@/pages/ReferralSubmit";
import { ConfirmProvider } from "@/hooks/useConfirm";
import { celebrate } from "@/lib/celebrate";
import { playSoundEffect } from "@/hooks/useSoundEffects";

type RpcAnswer = { data: unknown; error: null | { message: string } };
const SENT: RpcAnswer = {
  data: [{ referral_id: "ref-1", is_duplicate: false, duplicate_of: null, matching_application_id: null }],
  error: null,
};
const AGENT_OPTIONS = {
  is_admin: false, is_manager: false, caller_agent_id: "agent-ana", cap_pct: null, can_offer_comp: false, comp_levels: [],
  roles: ["hired_unlicensed", "hired_licensed"], uplines: [{ id: "agent-ana", name: "Ana Agent", agency_key: "primary", is_self: true }], carriers: [],
};
const NO_LINKS = { counts: { total: 0, pending: 0, accepted: 0, expired: 0, revoked: 0, superseded: 0 }, rows: [], limit: 500 };

/** Answers for the next submit_referral calls, in order; SENT once they run out. */
const submitQueue: RpcAnswer[] = [];
let linkList: unknown = NO_LINKS;

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ConfirmProvider>
      <MemoryRouter initialEntries={["/dashboard/referrals/new"]}>
        <Routes>
          <Route path="/dashboard/referrals/new" element={<ReferralSubmit />} />
          <Route path="/dashboard/referrals/mine" element={<p>My referrals page</p>} />
        </Routes>
      </MemoryRouter>
      </ConfirmProvider>
    </QueryClientProvider>,
  );
}

const rpcCalls = (fn: string) => vi.mocked(supabase.rpc).mock.calls.filter((c) => c[0] === fn);
const header = () => screen.getByRole("heading", { level: 1, name: "Refer a recruit" }).closest("header") as HTMLElement;
const goldButtons = () => Array.from(document.querySelectorAll("button, a")).filter((el) => /\bbg-primary\b(?!\/)/.test(el.className));
const sendButton = () => screen.getByRole("button", { name: "Send referral" });
const openReferral = async () => {
  fireEvent.click(await screen.findByRole("button", { name: /Rather we call them\?/ }));
  return sendButton();
};

/** Radix Select in jsdom: open from the keyboard, select the option with Enter. No pointer events needed. */
async function chooseState(label: string) {
  const trigger = screen.getByRole("combobox", { name: "State" });
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  const option = await screen.findByRole("option", { name: label });
  fireEvent.keyDown(option, { key: "Enter" });
  await waitFor(() => expect(screen.getByRole("combobox", { name: "State" })).toHaveTextContent(label));
}

function typeInto(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

beforeEach(() => {
  toastMock.success.mockReset();
  toastMock.error.mockReset();
  vi.mocked(celebrate).mockClear();
  vi.mocked(playSoundEffect).mockClear();
  submitQueue.length = 0;
  linkList = NO_LINKS;
  vi.mocked(supabase.rpc).mockReset();
  vi.mocked(supabase.rpc).mockImplementation(((fn: string, args?: Record<string, unknown>) => {
    switch (fn) {
      case "submit_referral": return Promise.resolve(submitQueue.shift() ?? SENT);
      case "my_recruiting_link": return Promise.resolve({ data: { active: true, agent_id: "agent-ana", ref_slug: "ana-agent-a1b2c3" }, error: null });
      case "invitation_mint_options": return Promise.resolve({ data: AGENT_OPTIONS, error: null });
      case "list_invitations": return Promise.resolve({ data: linkList, error: null });
      case "create_invitation": return Promise.resolve({
        data: { id: "inv-1", kind: args?.p_kind, path: `/${String(args?.p_kind)}/tok-1`, expires_at: "2026-11-05T03:00:00Z", permanent: false },
        error: null,
      });
      default: return Promise.resolve({ data: null, error: null });
    }
  }) as never);
  // Radix positions the Select list with ResizeObserver and scrolls the focused option into view; jsdom has neither.
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

afterEach(() => vi.unstubAllGlobals());

describe("Refer a recruit", () => {
  it("sits in the standard frame: PageHeader with a one-sentence subtitle, no header button, and one gold button at 48px", async () => {
    renderPage();
    expect(document.title).toBe("Refer a recruit · Galaxy");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    const subtitle = within(header()).getByText("Send your link, or make one for one person.");
    expect(subtitle.textContent!.split(/[.!?]\s/).length).toBe(1);
    expect(subtitle.textContent!.length).toBeLessThanOrEqual(48);
    expect(within(header()).queryAllByRole("button")).toHaveLength(0);
    expect(within(header()).queryAllByRole("link")).toHaveLength(0);
    // The old page's only navigation was a 36px Back button; the shell carries navigation now.
    expect(screen.queryByRole("button", { name: /Back/ })).toBeNull();

    // At rest the one gold button is the link maker's Make link.
    const make = await screen.findByTestId("create-invitation");
    expect(goldButtons()).toEqual([make]);
    expect(make.className).toMatch(/\bh-12\b/);

    // Open the referral form and it holds the one gold button instead.
    const send = await openReferral();
    const gold = goldButtons();
    expect(gold).toHaveLength(1);
    expect(gold[0]).toBe(send);
    expect(send.className).toMatch(/\bh-12\b/);
  });

  it("leads with your permanent link: /r/<slug>, Copy and Share, one tap and no form", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderPage();
    const card = await screen.findByTestId("my-link-card");
    expect(await within(card).findByTestId("my-link-url")).toHaveTextContent("apex-financial.org/r/ana-agent-a1b2c3");
    expect(within(card).getByText("Permanent")).toBeInTheDocument();
    expect(within(card).getByText("Anyone who applies through it is credited to you.")).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("https://apex-financial.org/r/ana-agent-a1b2c3"));
    expect(within(card).getByRole("button", { name: "Share link" })).toBeInTheDocument();
    // Your link records nothing: it is not an invitation.
    expect(rpcCalls("record_invitation_share")).toHaveLength(0);
  });

  it("makes a prospect join link for one person, credited to you", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("radio", { name: "Not licensed yet" }));
    fireEvent.click(screen.getByTestId("create-invitation"));
    await waitFor(() => expect(rpcCalls("create_invitation")).toHaveLength(1));
    expect(rpcCalls("create_invitation")[0][1]).toMatchObject({
      p_kind: "join", p_target_role: "referral_prospect", p_target_manager_id: null, p_license_status: "unlicensed",
    });
    expect(await screen.findByTestId("invitation-created")).toHaveTextContent("/join/tok-1");
  });

  it("lists your links only once you have one, and only prospect join links", async () => {
    renderPage();
    await screen.findByTestId("create-invitation");
    await waitFor(() => expect(rpcCalls("list_invitations").length).toBeGreaterThan(0));
    expect(rpcCalls("list_invitations")[0][1]).toMatchObject({ p_kind: "join" });
    expect(screen.queryByRole("heading", { name: "Links you made" })).toBeNull();
  });

  it("says what the bonus means in plain words: no AP, no raw bg-white box", async () => {
    renderPage();
    // The bonus is named on the folded row itself, so it is seen without opening anything.
    expect(await screen.findByText(/you can earn a \$300 bonus/)).toBeInTheDocument();
    await openReferral();
    const bonus = screen.getByTestId("referral-bonus");
    expect(bonus).toHaveTextContent("$300 referral bonus.");
    expect(bonus).toHaveTextContent("$10,000 in annual premium");
    expect(bonus).toHaveTextContent("the yearly premium on the policies they sell");
    // A sentence inside the open section, not a box of its own inside a card.
    expect(bonus.className).not.toMatch(/\bborder\b/);
    expect(document.body.innerHTML).not.toMatch(/\bAP\b/);
    expect(document.querySelector('[class*="bg-white"]')).toBeNull();
    // No marketing headline inside the card: the header carries the only title.
    expect(screen.queryByText(/could win/)).toBeNull();
  });

  it("puts a label above every field, keeps State's aria-label, and holds one control scale: 48px fields, 44px everything else, nothing under 13px", async () => {
    renderPage();
    await openReferral();
    for (const label of ["First name", "Last name", "Phone", "Email", "Notes (optional)"]) {
      const field = screen.getByLabelText(label);
      expect(field).toBeInTheDocument();
      const own = field.closest(".space-y-2") as HTMLElement;
      expect(within(own).getByText(label).tagName).toBe("LABEL");
    }
    for (const id of ["firstName", "lastName", "phone", "email"]) {
      const input = document.getElementById(id) as HTMLInputElement;
      expect(input.className).toMatch(/\bh-12\b/);
      expect(input.className).toMatch(/\btext-base\b/);
      expect(input.className).toMatch(/\bmd:text-base\b/);
    }
    const state = screen.getByRole("combobox", { name: "State" });
    expect(state).toHaveAttribute("aria-label", "State");
    expect(state.className).toMatch(/\bh-12\b/);
    expect(screen.getByLabelText("State")).toBe(state);
    expect(screen.getByLabelText("Notes (optional)").className).toMatch(/\btext-base\b/);
    expect(screen.getByText("Phone or email. One is enough.").className).toMatch(/\btext-sm\b/);

    const page = screen.getByRole("heading", { level: 1 }).closest(".page-enter") as HTMLElement;
    expect(page.querySelectorAll('[class*="text-xs"], [class*="text-[12px]"], [class*="text-[11px]"], [class*="text-[10px]"]')).toHaveLength(0);
    for (const control of page.querySelectorAll("button, a, input, textarea, [role=combobox]")) {
      expect(control.className).toMatch(/\bh-1[124]\b|\bmin-h-\[96px\]/);
    }
  });

  it("validation errors are 14px words that name the fix, tied to their fields", async () => {
    renderPage();
    fireEvent.click(await openReferral());
    const alerts = await screen.findAllByRole("alert");
    const messages = alerts.map((a) => a.textContent);
    expect(messages).toContain("Enter their first name (at least 2 letters)");
    expect(messages).toContain("Enter their last name (at least 2 letters)");
    expect(messages).toContain("Add a phone number or an email so we can reach them");
    expect(messages).toContain("Choose their state");
    for (const alert of alerts) {
      expect(alert.className).toMatch(/\btext-sm\b/);
      expect(alert.className).toMatch(/\btext-destructive\b/);
      expect(alert.className).not.toMatch(/text-xs/);
    }
    expect(screen.getByLabelText("First name")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("First name")).toHaveAttribute("aria-describedby", "firstName-error");
    expect(screen.getByRole("combobox", { name: "State" })).toHaveAttribute("aria-invalid", "true");
    expect(rpcCalls("submit_referral")).toHaveLength(0);
  });

  it("sends through the unchanged submit_referral RPC and the confirmation keeps one gold button at 48px", async () => {
    renderPage();
    await openReferral();
    typeInto("First name", "Ana");
    typeInto("Last name", "Ruiz");
    typeInto("Phone", "6015551001");
    await chooseState("Texas");
    fireEvent.click(sendButton());

    await waitFor(() => expect(rpcCalls("submit_referral")).toHaveLength(1));
    expect(rpcCalls("submit_referral")[0]).toEqual([
      "submit_referral",
      {
        p_first_name: "Ana",
        p_last_name: "Ruiz",
        p_email: null,
        p_phone: "6015551001",
        p_state: "TX",
        p_license: "unknown",
        p_relationship: null,
        // An untouched Notes box registers as "", exactly as before this redesign; submit_referral NULLIFs it.
        p_notes: "",
      },
    ]);

    expect(await screen.findByRole("heading", { level: 2, name: "Ana Ruiz is on our list." })).toBeInTheDocument();
    expect(screen.getByText("Sent").className).toMatch(/\btext-sm\b/);
    expect(screen.getByText("We make first contact within 24 hours. My Referrals shows where they stand.")).toBeInTheDocument();
    expect(toastMock.success).toHaveBeenCalledWith("Referral sent. We make first contact within 24 hours.");
    // The frame stays: same header, still exactly one gold button.
    expect(screen.getByRole("heading", { level: 1, name: "Refer a recruit" })).toBeInTheDocument();
    const gold = goldButtons();
    expect(gold).toHaveLength(1);
    expect(gold[0]).toHaveTextContent("See my referrals");
    expect(gold[0].className).toMatch(/\bh-12\b/);
    const again = screen.getByRole("button", { name: "Refer someone else" });
    expect(again.className).toMatch(/\bh-11\b/);

    // Refer someone else clears the form, including the state picker.
    fireEvent.click(again);
    expect(screen.getByLabelText("First name")).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "State" })).toHaveTextContent("Choose a state");

    // See my referrals goes to the list.
    typeInto("First name", "Bo");
    typeInto("Last name", "Lee");
    typeInto("Email", "bo@example.test");
    await chooseState("Arizona");
    fireEvent.click(sendButton());
    fireEvent.click(await screen.findByRole("button", { name: "See my referrals" }));
    expect(screen.getByText("My referrals page")).toBeInTheDocument();
  });

  it("says in words when the person had already applied or was already on file", async () => {
    submitQueue.push({
      data: [{ referral_id: "ref-2", is_duplicate: true, duplicate_of: null, matching_application_id: "app-9" }],
      error: null,
    });
    renderPage();
    await openReferral();
    typeInto("First name", "Cy");
    typeInto("Last name", "Dunn");
    typeInto("Phone", "6015551003");
    await chooseState("Texas");
    fireEvent.click(sendButton());
    expect(await screen.findByText(/They had already applied on their own\./)).toBeInTheDocument();
    expect(screen.getByText(/if they reach \$10,000 in annual premium, the \$300 is yours/)).toBeInTheDocument();
  });

  it("a failed send keeps what was typed and says why on the page, never as a vanished toast alone", async () => {
    submitQueue.push({ data: null, error: { message: "No agent record for user" } });
    renderPage();
    await openReferral();
    typeInto("First name", "Di");
    typeInto("Last name", "Park");
    typeInto("Phone", "6015551004");
    typeInto("Notes (optional)", "Met at church");
    await chooseState("Texas");
    fireEvent.click(sendButton());

    const alert = await screen.findByText(/The referral did not send: No agent record for user\./);
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert.className).toMatch(/\btext-sm\b/);
    expect(toastMock.error).toHaveBeenCalledTimes(1);
    // Draft kept: still on the form, every value intact, the button ready again.
    expect(screen.getByLabelText("First name")).toHaveValue("Di");
    expect(screen.getByLabelText("Last name")).toHaveValue("Park");
    expect(screen.getByLabelText("Phone")).toHaveValue("6015551004");
    expect(screen.getByLabelText("Notes (optional)")).toHaveValue("Met at church");
    expect(screen.getByRole("combobox", { name: "State" })).toHaveTextContent("Texas");
    expect(sendButton()).toBeEnabled();
    // No confirmation: the page's other headings (Your link) are not a "Sent" card.
    expect(screen.queryByRole("heading", { level: 2, name: /is on our list/ })).toBeNull();

    // A retry that succeeds clears the reason.
    fireEvent.click(sendButton());
    expect(await screen.findByRole("heading", { level: 2, name: "Di Park is on our list." })).toBeInTheDocument();
    expect(screen.queryByText(/did not send/)).toBeNull();
  });

  it("celebrates once, from the Send button, after submit_referral resolved, and not on a failed send", async () => {
    renderPage();
    // The header bubble is decoration beside the title (a gift, in green); the h1 is still the only name.
    const bubble = Array.from(header().querySelectorAll('[aria-hidden="true"]')).find((el) => el.querySelector("svg")) as HTMLElement;
    expect(bubble).toBeDefined();
    expect(bubble.className).toMatch(/\btext-tone-good\b/);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Refer a recruit");

    submitQueue.push({ data: null, error: { message: "No agent record for user" } });
    await openReferral();
    typeInto("First name", "Ana");
    typeInto("Last name", "Ruiz");
    typeInto("Phone", "6015551001");
    await chooseState("Texas");
    const button = sendButton();
    fireEvent.click(button);
    await screen.findByText(/The referral did not send: No agent record for user\./);
    expect(celebrate).not.toHaveBeenCalled();
    expect(playSoundEffect).not.toHaveBeenCalled();

    // The same button, pressed again, and this time the server says yes: one celebration from it.
    fireEvent.click(sendButton());
    const heading = await screen.findByRole("heading", { level: 2, name: "Ana Ruiz is on our list." });
    expect(celebrate).toHaveBeenCalledTimes(1);
    expect(celebrate).toHaveBeenCalledWith("booked", button);
    expect(heading.closest(".apex-pop")).not.toBeNull();
    expect(screen.getByText("Sent").className).toMatch(/\btext-tone-good\b/);
    expect(playSoundEffect).not.toHaveBeenCalled();
  });
});
