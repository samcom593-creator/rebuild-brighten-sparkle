import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Synthetic options only: one admin inviting under themself, no carriers.
const calls = vi.hoisted(() => [] as Array<{ fn: string; args?: Record<string, unknown> }>);
// The next create_invitation answer: the server refuses when `error` is set.
const createAnswer = vi.hoisted(() => ({ error: null as null | { message: string }, nextId: 1 }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string, args?: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (fn === "invitation_mint_options") {
        return Promise.resolve({
          data: {
            is_admin: true, is_manager: true, caller_agent_id: "agent-self", cap_pct: 100, can_offer_comp: true,
            comp_levels: [50, 60], roles: ["hired_manager"],
            uplines: [{ id: "00000000-0000-4000-8000-0000000000aa", name: "Test Admin", agency_key: "apex", is_self: true }],
            carriers: [],
          },
          error: null,
        });
      }
      if (fn === "create_invitation") {
        if (createAnswer.error) return Promise.resolve({ data: null, error: createAnswer.error });
        return Promise.resolve({ data: { id: `inv-${createAnswer.nextId++}`, kind: "hire", path: "/hire/test-token", expires_at: "2026-11-04T00:00:00Z" }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  },
}));
// The colour layer's side effects are observed, never run: canvas-confetti has no canvas in jsdom.
vi.mock("@/lib/celebrate", () => ({ celebrate: vi.fn(() => Promise.resolve()), prefersReducedMotion: () => true }));
vi.mock("@/hooks/useSoundEffects", () => ({ playSoundEffect: vi.fn(), useSoundEffects: () => ({ playSound: vi.fn() }) }));
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

import { InviteAgentForm } from "@/components/invitations/InviteAgentForm";
import { celebrate } from "@/lib/celebrate";
import { playSoundEffect } from "@/hooks/useSoundEffects";

function renderForm(props: Parameters<typeof InviteAgentForm>[0] = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <InviteAgentForm {...props} />
    </QueryClientProvider>,
  );
}

/** The default Button variant is the one gold button; outline is the quiet one. */
const isGold = (el: HTMLElement) => /\bbg-primary\b(?!\/)/.test(el.className);

const createCalls = () => calls.filter((c) => c.fn === "create_invitation");

beforeEach(() => {
  createAnswer.error = null;
  vi.mocked(celebrate).mockClear();
  vi.mocked(playSoundEffect).mockClear();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
});

afterEach(() => {
  calls.length = 0;
});

describe("InviteAgentForm team note", () => {
  it("a note that stops fitting once the contracting fields are typed is flagged and blocks the invitation, never trimmed", async () => {
    renderForm();
    const noteInput = (await screen.findByLabelText(/Team note/)) as HTMLInputElement;

    // With no contracting fields the whole 200-character note limit is the note's.
    fireEvent.change(noteInput, { target: { value: "n".repeat(190) } });
    expect(screen.getByText("10 characters left")).toBeTruthy();

    // The contracting line then takes 72 of those characters, so 128 remain and 62 are over.
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Mary Ann" } });
    fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "Smith" } });
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "(256) 975-6155" } });
    fireEvent.change(screen.getByLabelText(/^NPN/), { target: { value: "12345678" } });
    expect(noteInput.value).toHaveLength(190);
    expect(noteInput.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toContain("The note is 62 characters too long");

    // Create is refused until the note fits; nothing reaches the server.
    fireEvent.click(screen.getByTestId("create-invitation"));
    await waitFor(() => expect((screen.getByTestId("create-invitation") as HTMLButtonElement).disabled).toBe(true));
    expect(createCalls()).toHaveLength(0);

    // Shortening the note clears the flag; the saved note carries the contracting line and the whole note.
    fireEvent.change(noteInput, { target: { value: "Met at the Tuesday seminar" } });
    expect(screen.queryByRole("alert")).toBeNull();
    await waitFor(() => expect((screen.getByTestId("create-invitation") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId("create-invitation"));
    await waitFor(() => expect(createCalls()).toHaveLength(1));
    const args = createCalls()[0].args ?? {};
    expect(args.p_recipient_name).toBe("Mary Ann Smith");
    expect(args.p_recipient_phone).toBe("(256) 975-6155");
    expect(args.p_notes).toBe("Contracting: First=Mary Ann; Last=Smith; Phone=2569756155; NPN=12345678\nMet at the Tuesday seminar");
  });

  it("a note typed after the fields is capped by the room left, so it can never go over", async () => {
    renderForm();
    fireEvent.change(await screen.findByLabelText("First name"), { target: { value: "Jo" } });
    const noteInput = (await screen.findByLabelText(/Team note/)) as HTMLInputElement;
    // "Contracting: First=Jo" is 21 characters plus the newline: 178 remain.
    expect(noteInput.getAttribute("maxlength")).toBe("178");
    fireEvent.change(noteInput, { target: { value: "n".repeat(170) } });
    expect(screen.getByText("8 characters left")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("InviteAgentForm one gold button per screen", () => {
  it("after creating, Copy link is the gold button and Create steps back until the form changes", async () => {
    renderForm();
    fireEvent.change(await screen.findByLabelText("First name"), { target: { value: "Jo" } });
    expect(isGold(screen.getByTestId("create-invitation"))).toBe(true);

    fireEvent.click(screen.getByTestId("create-invitation"));
    await screen.findByTestId("invitation-created");
    expect(isGold(screen.getByRole("button", { name: "Copy link" }))).toBe(true);
    expect(isGold(screen.getByTestId("create-invitation"))).toBe(false);
    expect(screen.getByTestId("create-invitation").className).toMatch(/\bbg-transparent\b/);

    // Typing the next person hands gold back to Create and quiets the card's Copy link: still one gold,
    // and the created card (its link, its contracting values) is still there.
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Al" } });
    expect(isGold(screen.getByTestId("create-invitation"))).toBe(true);
    expect(isGold(screen.getByRole("button", { name: "Copy link" }))).toBe(false);
    expect(screen.getByTestId("invitation-created")).toBeInTheDocument();

    // Only one gold button on the screen at any point.
    expect(screen.getAllByRole("button").filter(isGold)).toHaveLength(1);
  });

  it("shows the page's license rule as the hint of the License step, and no second callout", async () => {
    const rule = "License status is always required. Pick one, or let them choose.";
    renderForm({ licenseHint: rule });
    await screen.findByLabelText("First name");
    expect(screen.getAllByText(rule)).toHaveLength(1);
    const step = screen.getByRole("region", { name: "Their role and license" });
    expect(step.textContent).toContain(rule);
  });
});

/**
 * Colour layer (2026-10-28): the celebration and the sounds mark only what the person just
 * completed, from the control they pressed; the step bubbles are decoration beside titles that
 * stay the accessible text.
 */
describe("InviteAgentForm colour, motion and sound", () => {
  it("celebrates once, from the Create button, after an invitation exists, and never after a refused one", async () => {
    renderForm();
    fireEvent.change(await screen.findByLabelText("First name"), { target: { value: "Jo" } });
    const create = screen.getByTestId("create-invitation");
    fireEvent.click(create);
    await screen.findByTestId("invitation-created");
    expect(celebrate).toHaveBeenCalledTimes(1);
    expect(celebrate).toHaveBeenCalledWith("booked", create);
    // The card pops in; nothing else played (the chime is celebrate's own).
    expect(screen.getByTestId("invitation-created").className).toMatch(/\bapex-pop\b/);
    expect(playSoundEffect).not.toHaveBeenCalled();

    // The server refuses the next one: the error toast as before, no second celebration, no sound.
    createAnswer.error = { message: "That upline is not one you can place a recruit under." };
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Al" } });
    fireEvent.click(screen.getByTestId("create-invitation"));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("That upline is not one you can place a recruit under."));
    expect(createCalls()).toHaveLength(2);
    expect(celebrate).toHaveBeenCalledTimes(1);
    expect(playSoundEffect).not.toHaveBeenCalled();
    // The earlier card is still there: a refusal never takes a made link away.
    expect(screen.getByTestId("invitation-created")).toBeInTheDocument();
  });

  it("Copy link pops once the clipboard has the link, and stays silent with its message when the clipboard is blocked", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderForm();
    fireEvent.change(await screen.findByLabelText("First name"), { target: { value: "Jo" } });
    fireEvent.click(screen.getByTestId("create-invitation"));
    await screen.findByTestId("invitation-created");

    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(playSoundEffect).toHaveBeenCalledWith("pop"));
    expect(playSoundEffect).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/hire/test-token`);
    expect(toastMock.success).toHaveBeenCalledWith("Link copied.");

    writeText.mockRejectedValueOnce(new Error("NotAllowedError"));
    fireEvent.click(screen.getByRole("button", { name: "Copied" }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Clipboard blocked. Select the link and copy it manually."));
    expect(playSoundEffect).toHaveBeenCalledTimes(1);
  });

  it("puts the step numbers in 44px bubbles hidden from assistive technology, keeps each title as the accessible text, and colours the step in hand gold and a step left in good order green", async () => {
    renderForm();
    await screen.findByLabelText("First name");
    const titles = ["Who are you inviting?", "Their role and license", "Who they'll work under", "The offer"];
    const region = (title: string) => screen.getByRole("region", { name: title });
    const bubbleOf = (title: string) => region(title).querySelector('[aria-hidden="true"]') as HTMLElement;

    titles.forEach((title, i) => {
      expect(within(region(title)).getByRole("heading", { level: 3 })).toHaveTextContent(title);
      const bubble = bubbleOf(title);
      expect(bubble).not.toBeNull();
      expect(bubble.className).toMatch(/\bh-11\b/);
      expect(bubble.className).toMatch(/\bw-11\b/);
      expect(bubble.textContent).toBe(String(i + 1));
    });
    // On load the first step is in hand (gold); the rest are paperwork ahead (royal).
    expect(bubbleOf(titles[0]).className).toMatch(/\btext-tone-gold\b/);
    for (const title of titles.slice(1)) expect(bubbleOf(title).className).toMatch(/\btext-tone-royal\b/);

    // Moving on to the upline: step 1, left blank, is in good order (an open link) and turns green with a
    // check; step 2, never touched, stays royal; step 3 is the one in hand.
    fireEvent.focus(screen.getByLabelText("Upline"));
    expect(bubbleOf(titles[2]).className).toMatch(/\btext-tone-gold\b/);
    expect(bubbleOf(titles[0]).className).toMatch(/\btext-tone-good\b/);
    expect(bubbleOf(titles[0]).querySelector("svg")).not.toBeNull();
    expect(bubbleOf(titles[0]).textContent).toBe("");
    expect(bubbleOf(titles[1]).className).toMatch(/\btext-tone-royal\b/);
    expect(bubbleOf(titles[1]).textContent).toBe("2");

    // A step left with a problem in it is not done: a bad email takes step 1 back to royal, fixing it turns it green.
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "not-an-email" } });
    expect(bubbleOf(titles[0]).className).toMatch(/\btext-tone-royal\b/);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "jo@example.test" } });
    expect(bubbleOf(titles[0]).className).toMatch(/\btext-tone-good\b/);

    // Nothing played: a step moved is not a sound here, and no bubble is a solid fill behind text.
    expect(playSoundEffect).not.toHaveBeenCalled();
    expect(celebrate).not.toHaveBeenCalled();
    for (const title of titles) expect(bubbleOf(title).className).toMatch(/\bbg-tone-(?:gold|royal|good)\/12\b/);
  });
});
