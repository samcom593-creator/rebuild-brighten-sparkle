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
        const permanent = args?.p_permanent === true;
        const kind = (args?.p_kind as string) ?? "hire";
        return Promise.resolve({
          data: { id: `inv-${createAnswer.nextId++}`, kind, path: `/${kind}/test-token`, expires_at: permanent ? null : "2026-11-04T00:00:00Z", permanent },
          error: null,
        });
      }
      if (fn === "record_invitation_share") return Promise.resolve({ data: { ok: true, status: "pending" }, error: null });
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
const shareCalls = () => calls.filter((c) => c.fn === "record_invitation_share");
const make = () => screen.getByTestId("create-invitation") as HTMLButtonElement;
const pick = async (name: string) => fireEvent.click(await screen.findByRole("radio", { name }));
const withDetails = async () => {
  fireEvent.click(await screen.findByRole("radio", { name: "With details" }));
};

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
  it("a note that stops fitting once the contracting fields are typed is flagged and blocks the link, never trimmed", async () => {
    renderForm();
    await withDetails();
    await pick("Licensed");
    // The team note lives in the folded "Their team and offer" step; the row says its values and opens it.
    fireEvent.click(screen.getByRole("button", { name: /Change/ }));
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

    // Make link is refused until the note fits; nothing reaches the server.
    fireEvent.click(make());
    await waitFor(() => expect(make().disabled).toBe(true));
    expect(createCalls()).toHaveLength(0);

    // Shortening the note clears the flag; the saved note carries the contracting line and the whole note.
    fireEvent.change(noteInput, { target: { value: "Met at the Tuesday seminar" } });
    expect(screen.queryByRole("alert")).toBeNull();
    await waitFor(() => expect(make().disabled).toBe(false));
    fireEvent.click(make());
    await waitFor(() => expect(createCalls()).toHaveLength(1));
    const args = createCalls()[0].args ?? {};
    expect(args.p_recipient_name).toBe("Mary Ann Smith");
    expect(args.p_recipient_phone).toBe("(256) 975-6155");
    expect(args.p_notes).toBe("Contracting: First=Mary Ann; Last=Smith; Phone=2569756155; NPN=12345678\nMet at the Tuesday seminar");
    expect(args.p_license_status).toBe("licensed");
    expect(args.p_target_role).toBe("hired_licensed");
  });

  it("a note typed after the fields is capped by the room left, so it can never go over", async () => {
    renderForm();
    await withDetails();
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Jo" } });
    fireEvent.click(screen.getByRole("button", { name: /Change/ }));
    const noteInput = (await screen.findByLabelText(/Team note/)) as HTMLInputElement;
    // "Contracting: First=Jo" is 21 characters plus the newline: 178 remain.
    expect(noteInput.getAttribute("maxlength")).toBe("178");
    fireEvent.change(noteInput, { target: { value: "n".repeat(170) } });
    expect(screen.getByText("8 characters left")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("OVERHAUL-1: Quick link or With details, License either-or, Permanent or Temporary", () => {
  it("License is one required either-or with no default, and They choose is gone", async () => {
    renderForm();
    const group = await screen.findByRole("radiogroup", { name: "License" });
    const options = within(group).getAllByRole("radio");
    expect(options.map((o) => o.textContent)).toEqual(["Licensed", "Not licensed yet"]);
    expect(options.every((o) => o.getAttribute("aria-checked") === "false")).toBe(true);
    expect(screen.queryByText("They choose")).toBeNull();

    // Make link without a license says what to do and sends nothing.
    fireEvent.click(make());
    expect(await screen.findByText("Pick Licensed or Not licensed yet.")).toHaveAttribute("role", "alert");
    expect(group).toHaveAttribute("aria-invalid", "true");
    expect(createCalls()).toHaveLength(0);

    await pick("Not licensed yet");
    expect(screen.queryByText("Pick Licensed or Not licensed yet.")).toBeNull();
    expect(screen.getByText("Not licensed yet starts the licensing roadmap when they accept.")).toBeInTheDocument();
    await waitFor(() => expect(make().disabled).toBe(false));
    fireEvent.click(make());
    await waitFor(() => expect(createCalls()).toHaveLength(1));
    expect(createCalls()[0].args).toMatchObject({ p_kind: "hire", p_license_status: "unlicensed", p_target_role: "hired_unlicensed" });
  });

  it("a Quick link sends no details, even ones typed before switching back to Quick", async () => {
    renderForm();
    await withDetails();
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Mary" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "mary@example.com" } });
    fireEvent.change(screen.getByLabelText(/^NPN/), { target: { value: "12345678" } });
    await pick("Quick link");
    expect(screen.queryByLabelText("First name")).toBeNull();
    await pick("Licensed");
    fireEvent.click(make());
    await waitFor(() => expect(createCalls()).toHaveLength(1));
    expect(createCalls()[0].args).toMatchObject({ p_recipient_name: null, p_recipient_email: null, p_recipient_phone: null, p_notes: null });
    expect(await screen.findByText("Quick link ready")).toBeInTheDocument();
  });

  it("Temporary by default: shows when it stops before and after, and sends the span the person picked", async () => {
    renderForm();
    await screen.findByRole("radiogroup", { name: "Link type" });
    expect(screen.getByRole("radio", { name: "Temporary" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("invite-expiry-preview").textContent).toMatch(/^Stops working \w{3}, \w{3} \d+/);
    fireEvent.change(screen.getByLabelText("Works for"), { target: { value: "72" } });
    await pick("Licensed");
    fireEvent.click(make());
    await waitFor(() => expect(createCalls()).toHaveLength(1));
    const args = createCalls()[0].args ?? {};
    expect(args.p_expires_hours).toBe(72);
    // A temporary link is the exact call it always was: no p_permanent key at all.
    expect("p_permanent" in args).toBe(false);
    const card = await screen.findByTestId("invitation-created");
    expect(within(card).getByText("Temporary")).toBeInTheDocument();
    expect(within(card).getByTestId("invitation-lifetime").textContent).toMatch(/^Stops working /);
  });

  it("Permanent asks the server for a link that never expires and says so only when the server did", async () => {
    renderForm();
    await pick("Licensed");
    fireEvent.click(await screen.findByRole("radio", { name: "Permanent" }));
    expect(screen.getByText("Never expires. It still works for one person.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Works for")).toBeNull();
    fireEvent.click(make());
    await waitFor(() => expect(createCalls()).toHaveLength(1));
    expect(createCalls()[0].args?.p_permanent).toBe(true);
    const card = await screen.findByTestId("invitation-created");
    expect(within(card).getByText("Permanent")).toBeInTheDocument();
    expect(within(card).getByText("Licensed")).toBeInTheDocument();
    expect(within(card).getByTestId("invitation-lifetime")).toHaveTextContent("Never expires");
  });

  it("a prospect join link (Refer a recruit) sits under the person making it and carries no team or offer", async () => {
    renderForm({ kind: "join" });
    expect(await screen.findByRole("region", { name: "Who is it for?" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Their team and offer" })).toBeNull();
    expect(screen.queryByLabelText(/Team note/)).toBeNull();
    await pick("Licensed");
    expect(screen.getByText("Licensed alerts their manager the moment they apply.")).toBeInTheDocument();
    fireEvent.click(make());
    await waitFor(() => expect(createCalls()).toHaveLength(1));
    expect(createCalls()[0].args).toMatchObject({
      p_kind: "join", p_target_role: "referral_prospect", p_target_manager_id: null,
      p_offered_comp_pct: null, p_carrier_exceptions: [], p_license_status: "licensed",
    });
    const card = await screen.findByTestId("invitation-created");
    expect(within(card).getByText(/\/join\/test-token$/)).toBeInTheDocument();
    expect(within(card).queryByText(/For contracting/)).toBeNull();
  });

  it("Copy, Share, Text and Email sit in one row and each records a share, never a delivery", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    renderForm();
    await withDetails();
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Mary" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "mary@example.com" } });
    await pick("Licensed");
    fireEvent.click(make());
    const card = await screen.findByTestId("invitation-created");
    const url = `${window.location.origin}/hire/test-token`;

    fireEvent.click(within(card).getByRole("button", { name: "Share link" }));
    await waitFor(() => expect(share).toHaveBeenCalledWith({ title: "Join Galaxy Financial", text: "Hi Mary, here is your personal link to join Galaxy Financial:", url }));
    await waitFor(() => expect(shareCalls().map((c) => c.args?.p_channel)).toEqual(["share"]));

    // A computer has no Messages app: Text copies the whole message and says so.
    fireEvent.click(within(card).getByRole("button", { name: "Text the link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`Hi Mary, here is your personal link to join Galaxy Financial:\n${url}`));
    expect(toastMock.success).toHaveBeenCalledWith("Message copied. Paste it into a text.");

    const email = within(card).getByRole("link", { name: "Email the link" });
    expect(email.getAttribute("href")).toMatch(/^mailto:mary%40example\.com\?subject=Your%20invitation%20to%20Galaxy%20Financial/);
    // jsdom cannot open a mail app: keep the press, skip the navigation.
    const noNavigate = (e: Event) => e.preventDefault();
    document.addEventListener("click", noNavigate);
    fireEvent.click(email);
    document.removeEventListener("click", noNavigate);
    await waitFor(() => expect(shareCalls().map((c) => c.args?.p_channel)).toEqual(["share", "text", "email_draft"]));
    expect(calls.map((c) => c.fn)).not.toContain("send_invitation");
    Reflect.deleteProperty(navigator, "share");
  });
});

describe("InviteAgentForm one gold button per screen", () => {
  it("after making a link, its Copy is the gold button and Make link steps back until the form changes", async () => {
    renderForm();
    await withDetails();
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Jo" } });
    await pick("Licensed");
    expect(isGold(make())).toBe(true);

    fireEvent.click(make());
    await screen.findByTestId("invitation-created");
    expect(isGold(screen.getByRole("button", { name: "Copy link" }))).toBe(true);
    expect(isGold(make())).toBe(false);
    expect(make().className).toMatch(/\bbg-transparent\b/);

    // Typing the next person hands gold back to Make link and quiets the card's Copy: still one gold,
    // and the made link (its URL, its contracting values) is still there.
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Al" } });
    expect(isGold(make())).toBe(true);
    expect(isGold(screen.getByRole("button", { name: "Copy link" }))).toBe(false);
    expect(screen.getByTestId("invitation-created")).toBeInTheDocument();

    // Only one gold button on the screen at any point.
    expect(screen.getAllByRole("button").filter(isGold)).toHaveLength(1);
  });

  it("a page that holds its gold elsewhere passes quiet, and nothing in the form is gold", async () => {
    renderForm({ quiet: true });
    await pick("Licensed");
    await waitFor(() => expect(isGold(make())).toBe(false));
    fireEvent.click(make());
    await screen.findByTestId("invitation-created");
    expect(screen.getAllByRole("button").filter(isGold)).toHaveLength(0);
  });

  it("shows the page's license rule as the hint of the License step, and no second callout", async () => {
    const rule = "License status is always required. Pick one.";
    renderForm({ licenseHint: rule });
    await screen.findByRole("radio", { name: "Quick link" });
    expect(screen.getAllByText(rule)).toHaveLength(1);
    const step = screen.getByRole("region", { name: "License" });
    expect(step.textContent).toContain(rule);
  });
});

/**
 * Colour layer (2026-10-28): the celebration and the sounds mark only what the person just
 * completed, from the control they pressed; the step bubbles are decoration beside titles that
 * stay the accessible text.
 */
describe("InviteAgentForm colour, motion and sound", () => {
  it("celebrates once, from the Make link button, after a link exists, and never after a refused one", async () => {
    renderForm();
    await withDetails();
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Jo" } });
    await pick("Licensed");
    const button = make();
    fireEvent.click(button);
    await screen.findByTestId("invitation-created");
    expect(celebrate).toHaveBeenCalledTimes(1);
    expect(celebrate).toHaveBeenCalledWith("booked", button);
    // The card pops in; nothing else played (the chime is celebrate's own).
    expect(screen.getByTestId("invitation-created").className).toMatch(/\bapex-pop\b/);
    expect(playSoundEffect).not.toHaveBeenCalled();

    // The server refuses the next one: the error toast as before, no second celebration, no sound.
    createAnswer.error = { message: "That upline is not one you can place a recruit under." };
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Al" } });
    fireEvent.click(make());
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("That upline is not one you can place a recruit under."));
    expect(createCalls()).toHaveLength(2);
    expect(celebrate).toHaveBeenCalledTimes(1);
    expect(playSoundEffect).not.toHaveBeenCalled();
    // The earlier card is still there: a refusal never takes a made link away.
    expect(screen.getByTestId("invitation-created")).toBeInTheDocument();
  });

  it("Copy pops once the clipboard has the link, and stays silent with its message when the clipboard is blocked", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderForm();
    await pick("Licensed");
    fireEvent.click(make());
    await screen.findByTestId("invitation-created");

    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(playSoundEffect).toHaveBeenCalledWith("pop"));
    expect(playSoundEffect).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/hire/test-token`);
    expect(toastMock.success).toHaveBeenCalledWith("Link copied.");
    // Recorded as one share of this link, on the channel used.
    await waitFor(() => expect(shareCalls().map((c) => c.args?.p_channel)).toEqual(["copy"]));
    expect(String(shareCalls()[0].args?.p_id)).toMatch(/^inv-\d+$/);

    writeText.mockRejectedValueOnce(new Error("NotAllowedError"));
    fireEvent.click(screen.getByRole("button", { name: "Copied" }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Clipboard blocked. Select the link and copy it manually."));
    expect(playSoundEffect).toHaveBeenCalledTimes(1);
  });

  it("puts the step numbers in 44px bubbles hidden from assistive technology, keeps each title as the accessible text, and colours the step in hand gold and a step left in good order green", async () => {
    renderForm();
    await screen.findByRole("radio", { name: "Quick link" });
    const titles = ["Who are you inviting?", "License", "Link type", "Their team and offer"];
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

    // Moving on to the team step: step 1, a Quick link, is in good order and turns green with a
    // check; License, never touched and still unpicked, stays royal; the team step is in hand.
    fireEvent.focus(within(region(titles[3])).getByRole("button", { name: /Change/ }));
    expect(bubbleOf(titles[3]).className).toMatch(/\btext-tone-gold\b/);
    expect(bubbleOf(titles[0]).className).toMatch(/\btext-tone-good\b/);
    expect(bubbleOf(titles[0]).querySelector("svg")).not.toBeNull();
    expect(bubbleOf(titles[0]).textContent).toBe("");
    expect(bubbleOf(titles[1]).className).toMatch(/\btext-tone-royal\b/);
    expect(bubbleOf(titles[1]).textContent).toBe("2");

    // A step left with a problem in it is not done: a bad email takes step 1 back to royal, fixing it turns it green.
    fireEvent.click(screen.getByRole("radio", { name: "With details" }));
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
