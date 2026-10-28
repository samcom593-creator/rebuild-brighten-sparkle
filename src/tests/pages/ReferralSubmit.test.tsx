/**
 * Refer a recruit (src/pages/ReferralSubmit.tsx), Grow review fixes 2026-10-28.
 *
 * The page sits in the standard frame: a PageHeader titled "Refer a recruit" with a
 * one-sentence subtitle and no header button; the one gold button is the form's
 * 48px Send referral (30). The bonus is a quiet line in plain words with no "AP" (30).
 * Every control is at least 44px, every word at least 13px (34). Errors are 14px words
 * (30). A failed send keeps what was typed and says why on the page. The
 * submit_referral RPC call is unchanged.
 *
 * Colour layer (2026-10-28): a sent referral celebrates once, from the Send button, after the
 * RPC resolved; a failed send celebrates nothing; the confirmation pops in; the header bubble is
 * decoration beside a title that stays the accessible name.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "@/integrations/supabase/client";

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));
// The colour layer's side effects are observed, never run: canvas-confetti has no canvas in jsdom.
vi.mock("@/lib/celebrate", () => ({ celebrate: vi.fn(() => Promise.resolve()), prefersReducedMotion: () => true }));
vi.mock("@/hooks/useSoundEffects", () => ({ playSoundEffect: vi.fn(), useSoundEffects: () => ({ playSound: vi.fn() }) }));

import ReferralSubmit from "@/pages/ReferralSubmit";
import { celebrate } from "@/lib/celebrate";
import { playSoundEffect } from "@/hooks/useSoundEffects";

type RpcAnswer = { data: unknown; error: null | { message: string } };
const SENT: RpcAnswer = {
  data: [{ referral_id: "ref-1", is_duplicate: false, duplicate_of: null, matching_application_id: null }],
  error: null,
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/dashboard/referrals/new"]}>
      <Routes>
        <Route path="/dashboard/referrals/new" element={<ReferralSubmit />} />
        <Route path="/dashboard/referrals/mine" element={<p>My referrals page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const header = () => screen.getByRole("heading", { level: 1, name: "Refer a recruit" }).closest("header") as HTMLElement;
const goldButtons = () => Array.from(document.querySelectorAll("button, a")).filter((el) => /\bbg-primary\b(?!\/)/.test(el.className));
const sendButton = () => screen.getByRole("button", { name: "Send referral" });

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
  vi.mocked(supabase.rpc).mockReset();
  vi.mocked(supabase.rpc).mockResolvedValue(SENT as never);
  // Radix positions the Select list with ResizeObserver and scrolls the focused option into view; jsdom has neither.
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

afterEach(() => vi.unstubAllGlobals());

describe("Refer a recruit", () => {
  it("sits in the standard frame: PageHeader with a one-sentence subtitle, no header button, and one gold button at 48px", () => {
    renderPage();
    expect(document.title).toBe("Refer a recruit · Galaxy");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    const subtitle = within(header()).getByText("We contact your referral within 24 hours.");
    expect(subtitle.textContent!.split(/[.!?]\s/).length).toBe(1);
    expect(subtitle.textContent!.length).toBeLessThanOrEqual(48);
    expect(within(header()).queryAllByRole("button")).toHaveLength(0);
    expect(within(header()).queryAllByRole("link")).toHaveLength(0);
    // The old page's only navigation was a 36px Back button; the shell carries navigation now.
    expect(screen.queryByRole("button", { name: /Back/ })).toBeNull();

    const gold = goldButtons();
    expect(gold).toHaveLength(1);
    expect(gold[0]).toBe(sendButton());
    expect(sendButton().className).toMatch(/\bh-12\b/);
  });

  it("says what the bonus means in plain words: no AP, no raw bg-white box", () => {
    renderPage();
    const bonus = screen.getByText(/\$300 referral bonus\./).closest("p") as HTMLElement;
    expect(bonus).toHaveTextContent("$10,000 in annual premium");
    expect(bonus).toHaveTextContent("the yearly premium on the policies they sell");
    expect(bonus.className).toMatch(/\bbg-card\b/);
    expect(bonus.className).toMatch(/\bborder-border\b/);
    expect(document.body.innerHTML).not.toMatch(/\bAP\b/);
    expect(document.querySelector('[class*="bg-white"]')).toBeNull();
    // No marketing headline inside the card: the header carries the only title.
    expect(screen.queryByText(/could win/)).toBeNull();
  });

  it("puts a label above every field, keeps State's aria-label, and holds one control scale: 48px fields, 44px everything else, nothing under 13px", () => {
    renderPage();
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
      expect(control.className).toMatch(/\bh-1[12]\b|\bmin-h-\[96px\]/);
    }
  });

  it("validation errors are 14px words that name the fix, tied to their fields", async () => {
    renderPage();
    fireEvent.click(sendButton());
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
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("sends through the unchanged submit_referral RPC and the confirmation keeps one gold button at 48px", async () => {
    renderPage();
    typeInto("First name", "Ana");
    typeInto("Last name", "Ruiz");
    typeInto("Phone", "6015551001");
    await chooseState("Texas");
    fireEvent.click(sendButton());

    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledTimes(1));
    expect(vi.mocked(supabase.rpc).mock.calls[0]).toEqual([
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
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: [{ referral_id: "ref-2", is_duplicate: true, duplicate_of: null, matching_application_id: "app-9" }],
      error: null,
    } as never);
    renderPage();
    typeInto("First name", "Cy");
    typeInto("Last name", "Dunn");
    typeInto("Phone", "6015551003");
    await chooseState("Texas");
    fireEvent.click(sendButton());
    expect(await screen.findByText(/They had already applied on their own\./)).toBeInTheDocument();
    expect(screen.getByText(/if they reach \$10,000 in annual premium, the \$300 is yours/)).toBeInTheDocument();
  });

  it("a failed send keeps what was typed and says why on the page, never as a vanished toast alone", async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: null, error: { message: "No agent record for user" } } as never);
    renderPage();
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
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();

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

    vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: null, error: { message: "No agent record for user" } } as never);
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
