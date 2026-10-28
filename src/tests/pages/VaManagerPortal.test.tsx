/**
 * Staff accounts (src/pages/VaManagerPortal.tsx), Grow review fixes 2026-10-28.
 *
 * The subtitle fits a 390px phone whole (11). The counts render only once the list has
 * loaded: a read that is still running shows a skeleton, a failed read shows the reason with
 * Retry, and neither one ever says "0 accounts" (31). The dialog speaks of an assistant, makes
 * a 14-character password in the browser, sends it to create-va-account and shows the one the
 * server stored exactly once, with a Copy button (32). Rows are cards under sm and a table from
 * sm up, status is words, and the one access button per row is a 44px outline Turn off in red
 * behind a confirm (33). One control scale: h-12 primary, h-11 everything else, nothing under
 * 13px (34). Every count equals the rows shown. The two edge-function contracts are unchanged.
 *
 * Colour layer (2026-10-28): the state is a pill in the shared tones (Active good, Turned off
 * quiet slate, like Inactive on the Pipeline), each row opens with an initials bubble in that
 * tone, the rows rise in once, a created login celebrates once from Create login after the
 * server answered and never after a refusal, a copied password pops, a changed access ticks.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "@/integrations/supabase/client";

const auth = vi.hoisted(() => ({ current: { isAdmin: true, isVaManager: false } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth.current }));
const confirmMock = vi.hoisted(() => vi.fn(async (_opts: unknown) => true));
vi.mock("@/hooks/useConfirm", () => ({ useConfirm: () => confirmMock }));
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));
// The colour layer's side effects are observed, never run: canvas-confetti has no canvas in jsdom,
// and with reduced motion CountUp shows a changed number at once instead of tweening on jsdom's
// animation-frame clock (which does not share performance.now()'s base).
vi.mock("@/lib/celebrate", () => ({ celebrate: vi.fn(() => Promise.resolve()), prefersReducedMotion: () => true }));
vi.mock("@/hooks/useSoundEffects", () => ({ playSoundEffect: vi.fn(), useSoundEffects: () => ({ playSound: vi.fn() }) }));

import VaManagerPortal, { generateLoginPassword } from "@/pages/VaManagerPortal";
import { celebrate } from "@/lib/celebrate";
import { playSoundEffect } from "@/hooks/useSoundEffects";

type VaRow = {
  user_id: string;
  email: string | null;
  full_name: string | null;
  created_at: string | null;
  last_sign_in_at: string | null;
  disabled: boolean;
};
type RpcAnswer = { data: VaRow[] | null; error: null | { message: string } };

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();

// Ana: active, signed in 10 days ago. Bo: turned off, never signed in.
const ANA: VaRow = { user_id: "va-1", email: "ana@example.test", full_name: "Ana Ruiz", created_at: daysAgo(30), last_sign_in_at: daysAgo(10), disabled: false };
const BO: VaRow = { user_id: "va-2", email: "bo@example.test", full_name: "Bo Lee", created_at: daysAgo(20), last_sign_in_at: null, disabled: true };
const TWO: RpcAnswer = { data: [ANA, BO], error: null };

const rpc = () => vi.mocked(supabase.rpc);
const invoke = () => vi.mocked(supabase.functions.invoke);
const clipboard = { writeText: vi.fn() };

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <VaManagerPortal />
    </QueryClientProvider>,
  );
}

const header = () => screen.getByRole("heading", { level: 1, name: "Staff accounts" }).closest("header") as HTMLElement;
const goldButtons = (root: ParentNode = document) =>
  Array.from(root.querySelectorAll("button, a")).filter((el) => /\bbg-primary\b(?!\/)/.test(el.className));
const page = () => screen.getByRole("heading", { level: 1 }).closest(".page-enter") as HTMLElement;
// The number sits in its own <span>, so the line is found by the paragraph's whole text.
const COUNTS = /^\d+ accounts? · \d+ active/;
const findCountsLine = () => Array.from(page().querySelectorAll("p")).find((el) => COUNTS.test(el.textContent ?? ""));
const countsLine = () => {
  const line = findCountsLine();
  if (!line) throw new Error("The counts line is not on the page.");
  return line;
};
const waitForCounts = () => waitFor(() => countsLine());
const expectNoNumbers = () => {
  expect(findCountsLine()).toBeUndefined();
  expect(page().textContent).not.toMatch(/\d+ (accounts?|active|turned off)/);
};

function expectControlScale(root: HTMLElement) {
  expect(root.querySelectorAll('[class*="text-xs"], [class*="text-[12px]"], [class*="text-[11px]"], [class*="text-[10px]"]')).toHaveLength(0);
  for (const control of root.querySelectorAll("button, a, input, [role=combobox]")) {
    expect(control.className).toMatch(/\bh-1[12]\b/);
  }
}

beforeEach(() => {
  auth.current = { isAdmin: true, isVaManager: false };
  confirmMock.mockReset();
  confirmMock.mockResolvedValue(true);
  toastMock.success.mockReset();
  toastMock.error.mockReset();
  vi.mocked(celebrate).mockClear();
  vi.mocked(playSoundEffect).mockClear();
  rpc().mockReset();
  rpc().mockResolvedValue(TWO as never);
  invoke().mockReset();
  clipboard.writeText.mockReset();
  clipboard.writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });
});

describe("Staff accounts", () => {
  it("sits in the standard frame: one plain title, a subtitle that fits a phone whole, one gold button at 48px", async () => {
    renderPage();
    await waitForCounts();
    expect(document.title).toBe("Staff accounts · Galaxy");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    const subtitle = within(header()).getByText("Add logins and turn them on or off.");
    expect(subtitle.textContent!.split(/[.!?]\s/).length).toBe(1);
    // 11: 15px text on a 390px phone holds about 46 characters on one line, and about 36 beside the
    // header's 48px bubble (2026-10-28 colour layer); the old 97-character sentence was clamped to
    // "…they last…", and the 45-character one that followed clamped to "…on or…" once the bubble arrived.
    expect(subtitle.textContent!.length).toBeLessThanOrEqual(36);
    // The bubble is decoration beside the title: hidden from assistive technology, in the cool tone.
    const bubble = Array.from(header().querySelectorAll('[aria-hidden="true"]')).find((el) => el.querySelector("svg")) as HTMLElement;
    expect(bubble).toBeDefined();
    expect(bubble.className).toMatch(/\btext-tone-cool\b/);

    const gold = goldButtons();
    expect(gold).toHaveLength(1);
    expect(gold[0]).toHaveTextContent("New assistant");
    expect(gold[0].className).toMatch(/\bh-12\b/);
    expect(gold[0].className).toMatch(/\btext-base\b/);
    expectControlScale(page());
    expect(document.body.innerHTML).not.toMatch(/rose-/);
  });

  it("shows no number while the list is loading and none after a failed read; Retry loads it (31)", async () => {
    let answer: (value: RpcAnswer) => void = () => undefined;
    rpc().mockImplementationOnce(() => new Promise<RpcAnswer>((resolve) => { answer = resolve; }) as never);
    renderPage();

    // Loading: a skeleton line and a spoken status, never "0 accounts".
    expect(screen.getByRole("status")).toHaveTextContent("Loading accounts.");
    expectNoNumbers();
    expect(screen.queryByRole("table")).toBeNull();

    // Failed: the reason in a sentence, with Retry at 44px. Still no number.
    answer({ data: null, error: { message: "permission denied for function list_my_vas" } });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The accounts did not load: permission denied for function list_my_vas.");
    expectNoNumbers();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    const retry = within(alert).getByRole("button", { name: "Retry" });
    expect(retry.className).toMatch(/\bh-11\b/);
    expect(rpc()).toHaveBeenCalledTimes(1);

    // Retry re-reads and the counts appear only then.
    fireEvent.click(retry);
    await waitForCounts();
    expect(rpc()).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(countsLine().textContent).toBe("2 accounts · 1 active · 1 turned off");
  });

  it("the counts are the rows shown, in the phone cards and in the table, with status in words (33)", async () => {
    renderPage();
    await waitForCounts();
    expect(countsLine().textContent).toBe("2 accounts · 1 active · 1 turned off");
    expect(countsLine().className).toMatch(/\btext-base\b/);

    // Phone layout: one card per person, nothing truncated.
    const list = screen.getByRole("list", { name: "Assistant accounts" });
    const cards = within(list).getAllByRole("listitem");
    expect(cards).toHaveLength(2);
    expect(within(cards[0]).getByText("Ana Ruiz").className).toMatch(/\btext-base\b/);
    expect(within(cards[0]).getByText("ana@example.test").className).toMatch(/\bbreak-all\b/);
    expect(within(cards[0]).getByText("Active")).toBeInTheDocument();
    expect(within(cards[0]).getByText("Last signed in 10 days ago")).toBeInTheDocument();
    // The state is words in the shared tones (src/lib/tones.ts): an account that can sign in is going
    // well (good); one turned off is quiet (slate), the same tone as Inactive on the Pipeline. A tint
    // and a hairline, never a solid fill behind the word.
    expect(within(cards[0]).getByText("Active").className).toMatch(/\btext-tone-good\b/);
    expect(within(cards[0]).getByText("Active").className).toMatch(/\bbg-tone-good\/12\b/);
    expect(within(cards[1]).getByText("Turned off").className).toMatch(/\btext-tone-slate\b/);
    expect(within(cards[1]).getByText("Never signed in")).toBeInTheDocument();
    expect(list.className).toMatch(/\bsm:hidden\b/);
    // Each card opens with the person's initials in the colour of their state: decoration, hidden
    // from assistive technology, with the name right beside it.
    const bubbleOf = (card: HTMLElement) => card.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(bubbleOf(cards[0])).toHaveTextContent("AR");
    expect(bubbleOf(cards[0]).className).toMatch(/\btext-tone-good\b/);
    expect(bubbleOf(cards[0]).className).toMatch(/\bh-11\b/);
    expect(bubbleOf(cards[1])).toHaveTextContent("BL");
    expect(bubbleOf(cards[1]).className).toMatch(/\btext-tone-slate\b/);
    // The rows rise in once; nothing played on load.
    expect(list.className).toMatch(/\bapex-rise-list\b/);
    expect(playSoundEffect).not.toHaveBeenCalled();
    expect(celebrate).not.toHaveBeenCalled();

    const turnOff = within(cards[0]).getByRole("button", { name: "Turn off" });
    expect(turnOff.className).toMatch(/\bh-11\b/);
    expect(turnOff.className).toMatch(/\btext-destructive\b/);
    expect(turnOff.className).toMatch(/\bborder\b/);
    expect(turnOff.className).not.toMatch(/\bbg-primary\b/);
    const turnOn = within(cards[1]).getByRole("button", { name: "Turn on" });
    expect(turnOn.className).toMatch(/\bh-11\b/);
    expect(turnOn.className).not.toMatch(/text-destructive/);

    // Table layout from sm up: the same two people, same words, same 44px buttons.
    const table = screen.getByRole("table");
    expect((table.parentElement as HTMLElement).className).toMatch(/\bhidden\b.*\bsm:block\b/);
    expect(within(table).getAllByRole("columnheader").map((th) => th.textContent)).toEqual(["Name", "Email", "Created", "Last sign-in", "Status", "Access"]);
    const bodyRows = within(table.querySelector("tbody") as HTMLElement).getAllByRole("row");
    expect((table.querySelector("tbody") as HTMLElement).className).toMatch(/\bapex-rise-list\b/);
    expect(bodyRows).toHaveLength(2);
    expect(within(bodyRows[0]).getByText("10 days ago")).toBeInTheDocument();
    expect(within(bodyRows[1]).getByText("Never")).toBeInTheDocument();
    expect(within(bodyRows[1]).getByText("Turned off").className).toMatch(/\btext-tone-slate\b/);
    expect(within(bodyRows[0]).getByRole("button", { name: "Turn off" }).className).toMatch(/\bh-11\b/);
    expect(within(bodyRows[1]).getByRole("button", { name: "Turn on" }).className).toMatch(/\bh-11\b/);

    // Old words and colours are gone; the scale holds everywhere on the page.
    expect(screen.queryByRole("button", { name: /^(Disable|Enable)$/ })).toBeNull();
    expect(document.body.innerHTML).not.toMatch(/rose-|text-success|bg-success/);
    expectControlScale(page());
    expect(goldButtons()).toHaveLength(1);
  });

  it("turning someone off is two steps: nothing is sent until the confirm is accepted, then set-va-account is called unchanged", async () => {
    renderPage();
    await waitForCounts();
    const cards = within(screen.getByRole("list", { name: "Assistant accounts" })).getAllByRole("listitem");

    confirmMock.mockResolvedValueOnce(false);
    fireEvent.click(within(cards[0]).getByRole("button", { name: "Turn off" }));
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
    expect(confirmMock.mock.calls[0][0]).toMatchObject({ title: "Turn off Ana Ruiz?", confirmText: "Turn off", tone: "danger" });
    expect(invoke()).not.toHaveBeenCalled();
    // Nothing changed, so nothing played.
    expect(playSoundEffect).not.toHaveBeenCalled();

    invoke().mockResolvedValue({ data: { ok: true, disabled: true }, error: null } as never);
    rpc().mockResolvedValue({ data: [{ ...ANA, disabled: true }, BO], error: null } as never);
    fireEvent.click(within(cards[0]).getByRole("button", { name: "Turn off" }));
    await waitFor(() => expect(invoke()).toHaveBeenCalledTimes(1));
    expect(invoke().mock.calls[0]).toEqual(["set-va-account", { body: { va_user_id: "va-1", action: "disable" } }]);
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Ana Ruiz is turned off."));
    await waitFor(() => expect(countsLine().textContent).toBe("2 accounts · 0 active · 2 turned off"));
    // Access moved: one tick, after the server said so; an access change is never a celebration.
    expect(playSoundEffect).toHaveBeenCalledTimes(1);
    expect(playSoundEffect).toHaveBeenCalledWith("tick");
    expect(celebrate).not.toHaveBeenCalled();

    // Turning back on asks too, in the primary tone, and sends "enable".
    fireEvent.click(within(cards[1]).getByRole("button", { name: "Turn on" }));
    await waitFor(() => expect(invoke()).toHaveBeenCalledTimes(2));
    expect(confirmMock.mock.calls[2][0]).toMatchObject({ title: "Turn Bo Lee back on?", confirmText: "Turn on", tone: "primary" });
    expect(invoke().mock.calls[1]).toEqual(["set-va-account", { body: { va_user_id: "va-2", action: "enable" } }]);
  });

  it("the dialog speaks of an assistant, makes the password itself, and shows it once with a Copy button (32)", async () => {
    renderPage();
    await waitForCounts();
    fireEvent.click(screen.getByRole("button", { name: "New assistant" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Create an assistant login" })).toBeInTheDocument();
    expect(dialog.textContent).not.toMatch(/\bVAs?\b/);
    expect(dialog.textContent).not.toMatch(/123456/);
    expect(within(dialog).queryByLabelText(/password/i)).toBeNull();
    expect(within(dialog).getByText("We make the password. It is shown once, right after you tap Create login.")).toBeInTheDocument();
    for (const label of ["Full name", "Email"]) {
      const field = within(dialog).getByLabelText(label);
      expect(field.className).toMatch(/\bh-12\b/);
      expect(field.className).toMatch(/\btext-base\b/);
      expect(field.className).toMatch(/\bmd:text-base\b/);
    }
    const create = within(dialog).getByRole("button", { name: "Create login" });
    expect(create.className).toMatch(/\bh-12\b/);
    expect(goldButtons(dialog)).toEqual([create]);
    expect(within(dialog).getByRole("button", { name: "Cancel" }).className).toMatch(/\bh-11\b/);
    expectControlScale(dialog);

    // Nothing is sent for an empty form; the reason is on the page in words.
    fireEvent.click(create);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Enter their full name and email.");
    expect(invoke()).not.toHaveBeenCalled();

    // The server stores the password it is sent and echoes it back.
    invoke().mockImplementationOnce(async (_fn: string, opts?: { body?: { email: string; password: string } }) => ({
      data: { ok: true, user_id: "va-9", email: opts?.body?.email, password: opts?.body?.password },
      error: null,
    }) as never);
    fireEvent.change(within(dialog).getByLabelText("Full name"), { target: { value: " Cy Dunn " } });
    fireEvent.change(within(dialog).getByLabelText("Email"), { target: { value: "Cy@Example.test" } });
    fireEvent.click(create);
    await waitFor(() => expect(invoke()).toHaveBeenCalledTimes(1));
    const [fn, call] = invoke().mock.calls[0] as [string, { body: { full_name: string; email: string; password: string } }];
    expect(fn).toBe("create-va-account");
    expect(call.body.full_name).toBe("Cy Dunn");
    expect(call.body.email).toBe("cy@example.test");
    const sent = call.body.password;
    expect(sent.length).toBeGreaterThanOrEqual(12);
    expect(sent).toMatch(/^[abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/);

    // Shown once: the password, a Copy button, the sentence, and one gold Done at 48px.
    expect(await within(dialog).findByRole("heading", { name: "Login created" })).toBeInTheDocument();
    expect(within(dialog).getByText("cy@example.test")).toBeInTheDocument();
    expect(within(dialog).getByText(sent).className).toMatch(/\bfont-mono\b/);
    expect(within(dialog).getByText("This password will not be shown again. Copy it now or write it down.")).toBeInTheDocument();
    const copy = within(dialog).getByRole("button", { name: "Copy password" });
    expect(copy.className).toMatch(/\bh-11\b/);
    fireEvent.click(copy);
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith(sent));
    expect(toastMock.success).toHaveBeenCalledWith("Password copied.");
    const done = within(dialog).getByRole("button", { name: "Done" });
    expect(done.className).toMatch(/\bh-12\b/);
    expect(goldButtons(dialog)).toEqual([done]);
    expectControlScale(dialog);
    expect(rpc().mock.calls.length).toBeGreaterThanOrEqual(2);

    // Done closes it and the password is gone; the next New assistant starts a fresh form.
    fireEvent.click(done);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "New assistant" }));
    const again = await screen.findByRole("dialog");
    expect(within(again).getByRole("heading", { name: "Create an assistant login" })).toBeInTheDocument();
    expect(again.textContent).not.toContain(sent);
    expect(within(again).getByLabelText("Full name")).toHaveValue("");
  });

  it("shows the password the server stored, even when it differs from the one sent", async () => {
    renderPage();
    await waitForCounts();
    fireEvent.click(screen.getByRole("button", { name: "New assistant" }));
    const dialog = await screen.findByRole("dialog");
    invoke().mockResolvedValueOnce({ data: { ok: true, user_id: "va-9", email: "di@example.test", password: "server-kept-this-one" }, error: null } as never);
    fireEvent.change(within(dialog).getByLabelText("Full name"), { target: { value: "Di Park" } });
    fireEvent.change(within(dialog).getByLabelText("Email"), { target: { value: "di@example.test" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create login" }));
    expect(await within(dialog).findByText("server-kept-this-one")).toBeInTheDocument();
    const sent = (invoke().mock.calls[0][1] as { body: { password: string } }).body.password;
    expect(dialog.textContent).not.toContain(sent);
  });

  it("celebrates once, from Create login, after the server stored the login, and never after a refusal; Copy password pops only once the clipboard has it", async () => {
    renderPage();
    await waitForCounts();
    fireEvent.click(screen.getByRole("button", { name: "New assistant" }));
    const dialog = await screen.findByRole("dialog");
    const create = within(dialog).getByRole("button", { name: "Create login" });

    // Refused: the reason on the page as before, and no celebration.
    invoke().mockResolvedValueOnce({
      data: null,
      error: { message: "Edge Function returned a non-2xx status code", context: { json: async () => ({ error: "That email is already registered." }) } },
    } as never);
    fireEvent.change(within(dialog).getByLabelText("Full name"), { target: { value: "Ed Kim" } });
    fireEvent.change(within(dialog).getByLabelText("Email"), { target: { value: "ana@example.test" } });
    fireEvent.click(create);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("The login was not created: That email is already registered.");
    expect(celebrate).not.toHaveBeenCalled();
    expect(playSoundEffect).not.toHaveBeenCalled();

    // Stored: one celebration, from the Create login button that was pressed, and the login pops in.
    invoke().mockResolvedValueOnce({ data: { ok: true, user_id: "va-9", email: "ed@example.test", password: "kept-by-server" }, error: null } as never);
    fireEvent.change(within(dialog).getByLabelText("Email"), { target: { value: "ed@example.test" } });
    fireEvent.click(create);
    const createdHeading = await within(dialog).findByRole("heading", { name: "Login created" });
    expect(celebrate).toHaveBeenCalledTimes(1);
    expect(celebrate).toHaveBeenCalledWith("save", create);
    expect(within(dialog).getByText("kept-by-server").closest(".apex-pop")).not.toBeNull();
    expect(createdHeading).toBeInTheDocument();

    // Copy pops once the clipboard has the password, and stays silent with its message when it is blocked.
    fireEvent.click(within(dialog).getByRole("button", { name: "Copy password" }));
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith("kept-by-server"));
    await waitFor(() => expect(playSoundEffect).toHaveBeenCalledWith("pop"));
    expect(playSoundEffect).toHaveBeenCalledTimes(1);
    clipboard.writeText.mockRejectedValueOnce(new Error("blocked"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Copy password" }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Copy is blocked here. Write the password down instead."));
    expect(playSoundEffect).toHaveBeenCalledTimes(1);
    expect(celebrate).toHaveBeenCalledTimes(1);
  });

  it("a failed create keeps what was typed and says the server's reason on the page", async () => {
    renderPage();
    await waitForCounts();
    fireEvent.click(screen.getByRole("button", { name: "New assistant" }));
    const dialog = await screen.findByRole("dialog");
    invoke().mockResolvedValueOnce({
      data: null,
      error: { message: "Edge Function returned a non-2xx status code", context: { json: async () => ({ error: "That email is already registered." }) } },
    } as never);
    fireEvent.change(within(dialog).getByLabelText("Full name"), { target: { value: "Ed Kim" } });
    fireEvent.change(within(dialog).getByLabelText("Email"), { target: { value: "ana@example.test" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create login" }));

    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent("The login was not created: That email is already registered.");
    expect(alert.className).toMatch(/\btext-sm\b/);
    expect(alert.className).toMatch(/\btext-destructive\b/);
    expect(toastMock.error).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByLabelText("Full name")).toHaveValue("Ed Kim");
    expect(within(dialog).getByLabelText("Email")).toHaveValue("ana@example.test");
    expect(within(dialog).getByRole("button", { name: "Create login" })).toBeEnabled();
    expect(within(dialog).queryByRole("heading", { name: "Login created" })).toBeNull();
  });

  it("generateLoginPassword: 14 characters from the look-alike-free alphabet, every class present, never the same twice", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      const password = generateLoginPassword();
      expect(password).toHaveLength(14);
      expect(password).toMatch(/^[abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/);
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/\d/);
      seen.add(password);
    }
    expect(seen.size).toBe(50);
    expect(generateLoginPassword(20)).toHaveLength(20);
  });

  it("an empty list says so in words, and the zero it shows is a loaded zero", async () => {
    rpc().mockResolvedValue({ data: [], error: null } as never);
    renderPage();
    expect(await screen.findByText(/No assistants yet\./)).toBeInTheDocument();
    expect(countsLine().textContent).toBe("0 accounts · 0 active");
    expect(screen.queryByRole("table")).toBeNull();
    expect(goldButtons()).toHaveLength(1);
  });

  it("someone without the role sees a plain sentence and no read is made", () => {
    auth.current = { isAdmin: false, isVaManager: false };
    renderPage();
    expect(screen.getByText("You don't have access to Staff accounts.").className).toMatch(/\btext-base\b/);
    expect(rpc()).not.toHaveBeenCalled();
  });
});
