/**
 * Social Command Center (src/pages/SocialCommandCenter.tsx), colour, motion and sound layer, 2026-10-28.
 *
 * The four tiles are the bucket counts and each opens exactly the rows it counts; the chips under them
 * keep their counts. A loading or failed read shows dashes and says why, never 0. A dead lane comes first
 * with its fix in the hot tone. Approve writes social_draft_set_status with the draft's id and celebrates
 * once from the button pressed, only after the save succeeded; a failed save is the error toast alone.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { celebrate } from "@/lib/celebrate";
import { playSoundEffect } from "@/hooks/useSoundEffects";
import type { CommandCenterPayload, DraftRow, InboxRow, LaneRow } from "@/lib/socialCommand";
import SocialCommandCenter from "@/pages/SocialCommandCenter";

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: true, user: { id: "sam" } }) }));
// CountUp reads prefersReducedMotion from the same module; true makes it paint the final number at once.
vi.mock("@/lib/celebrate", () => ({ celebrate: vi.fn(() => Promise.resolve()), prefersReducedMotion: () => true }));
vi.mock("@/hooks/useSoundEffects", () => ({ playSoundEffect: vi.fn(), useSoundEffects: () => ({ playSound: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

let n = 0;
const row = (over: Partial<InboxRow>): InboxRow => ({
  source: "instagram", sender_handle: `person${++n}`, sender_name: null, avatar: null, last_in: "2026-10-27T20:00:00Z", last_out: null,
  inbound_count: 1, last_intent: "casual", sam_touched: false, last_text: "hi", application_id: null, lead_score: null, media_id: null,
  waiting_on_us: true, bucket: "waiting", application_status: null, application_license: null, ...over,
});

const inbox: InboxRow[] = [
  row({ bucket: "hot", sender_name: "Marcus Powell", sender_handle: "marcus", last_intent: "licensed", last_in: "2026-10-27T22:00:00Z" }),
  row({ bucket: "hot", sender_name: "Kadin Price", sender_handle: "kadin", source: "tiktok", last_in: "2026-10-27T21:00:00Z" }),
  row({ bucket: "human_lane", sender_name: "Grace Coleman", sender_handle: "grace", sam_touched: true }),
  row({ bucket: "waiting", sender_name: "Patricia Jenkins", sender_handle: "patricia" }),
  row({ bucket: "waiting", sender_name: "Andre Perry", sender_handle: "andre", source: "youtube" }),
  row({ bucket: "waiting", sender_name: "Walter Sanders", sender_handle: "walter" }),
  row({ bucket: "booked", sender_name: "Hector Myers", sender_handle: "hector", application_status: "interview_scheduled" }),
  row({ bucket: "answered", sender_name: "Curtis Ross", sender_handle: "curtis", last_out: "2026-10-27T21:00:00Z", waiting_on_us: false }),
  row({ bucket: "silent", sender_name: "Spam Bot", sender_handle: "spam", last_intent: "spam", waiting_on_us: false }),
];

const aliveLane: LaneRow = { lane: "instagram_dm_in", tier: "page", last_seen: "2026-10-28T11:00:00Z", expires_at: null, owner: "ManyChat webhook", fix: null, verdict: "alive", hours_silent: 1, hours_left: null };
const deadLane: LaneRow = { lane: "youtube_oauth", tier: "page", last_seen: "2026-10-05T02:00:00Z", expires_at: null, owner: "Sam", fix: "Sign in with Google as the channel owner.", verdict: "dead", hours_silent: 559, hours_left: -5 };

const draft = (over: Partial<DraftRow> & { id: number }): DraftRow => ({
  draft_date: "2026-10-30", platform: "tiktok", slot: "morning", pillar: "licensing", title: "Untitled", hook: null, cta: null, status: "awaiting_approval",
  approved_at: null, shipped_at: null, notes: null, created_at: "2026-10-27T00:00:00Z", ...over,
});

const payload: CommandCenterPayload = {
  inbox,
  lanes: [aliveLane, deadLane],
  drafts: [draft({ id: 901, title: "What the exam asks", hook: "Nobody tells you this." }), draft({ id: 902, platform: "yt", title: "Ride-along" })],
  funnel: [
    { platform: "instagram", posts: 14, views: 182400, post_comments: 420, messages_in: 905, people_in: 566, people_replied: 65, partials_abandoned: 31, applications: 22, licensed: 6, booked_or_further: 9 },
    { platform: "tiktok", posts: 22, views: 410200, post_comments: 1203, messages_in: 310, people_in: 180, people_replied: 131, partials_abandoned: 12, applications: 9, licensed: 2, booked_or_further: 3 },
    { platform: "snapchat", posts: 6, views: 9800, post_comments: 0, messages_in: 0, people_in: 0, people_replied: 0, partials_abandoned: 0, applications: 1, licensed: 0, booked_or_further: 0 },
  ],
  pulls: [
    { platform: "instagram", lever: "Bio link", applications: 41, licensed: 12, booked_or_further: 15, last_30d: 11, last_application: "2026-10-27T00:00:00Z" },
    { platform: "untracked", lever: "No source on the application", applications: 63, licensed: 20, booked_or_further: 18, last_30d: 14, last_application: null },
  ],
  alarm: null,
  pools: { readymode_leads: 664, readymode_licensed: 75, readymode_never_contacted: 2, winback_agents: 66, winback_with_phone: 51, readymode_csv_url: "https://x/csv?list=readymode", winback_csv_url: "https://x/csv?list=winback" },
  youtube_reconnect_url: "https://accounts.example/consent",
  generated_at: "2026-10-28T12:00:00Z",
};

const db = {
  payload: payload as CommandCenterPayload,
  readError: null as null | { message: string },
  writeError: null as null | { message: string },
  pending: false,
  calls: [] as Array<{ fn: string; args: unknown }>,
};

beforeEach(() => {
  db.payload = payload;
  db.readError = null;
  db.writeError = null;
  db.pending = false;
  db.calls = [];
  vi.mocked(celebrate).mockClear();
  vi.mocked(playSoundEffect).mockClear();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  vi.mocked(supabase.rpc).mockReset();
  vi.mocked(supabase.rpc).mockImplementation(((fn: string, args?: unknown) => {
    db.calls.push({ fn, args });
    if (fn === "social_command_center") {
      if (db.pending) return new Promise(() => {});
      return Promise.resolve(db.readError ? { data: null, error: db.readError } : { data: db.payload, error: null });
    }
    if (fn === "social_draft_set_status") return Promise.resolve({ data: true, error: db.writeError });
    return Promise.resolve({ data: null, error: null });
  }) as never);
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/dashboard/social-command"]}><SocialCommandCenter /></MemoryRouter>
    </QueryClientProvider>,
  );
}

const TILES = ["Hot", "Waiting on us", "Booked", "Sam's threads"] as const;
const tile = (label: string) => within(screen.getByRole("region", { name: "Message numbers" })).getByRole("button", { name: (name) => name.startsWith(label) });
const chip = (label: string) => within(screen.getByRole("group", { name: "Bucket" })).getByRole("button", { name: (name) => name.startsWith(label) });
const messagesListed = () => within(screen.getByRole("region", { name: "Prioritized messages" })).getAllByRole("listitem").map((li) => li.getAttribute("aria-label") ?? "");
/** The "N people shown · Bucket" line; the N sits in its own span, so match the whole element's text. */
const shownLine = () => screen.getByText((_, el) => el?.tagName === "SPAN" && /^\d+ (person|people) shown · /.test(el.textContent ?? ""));
const writes = () => db.calls.filter((c) => c.fn === "social_draft_set_status").map((c) => c.args);

describe("Social Command Center", () => {
  it("shows the four bucket counts as tiles, and Hot opens exactly the hot rows", async () => {
    renderPage();
    await screen.findByText("Marcus Powell");
    expect(screen.getByRole("heading", { level: 1, name: "Social Command Center" })).toBeInTheDocument();
    expect(tile("Hot")).toHaveTextContent(/^Hot\s*2\s*Business intent, nobody answered$/);
    expect(tile("Waiting on us")).toHaveTextContent(/^Waiting on us\s*3\s*They wrote, we owe a reply$/);
    expect(tile("Booked")).toHaveTextContent(/^Booked\s*1\s*Interview on the calendar$/);
    expect(tile("Sam's threads")).toHaveTextContent(/^Sam's threads\s*1\s*Only Sam answers these$/);
    for (const label of TILES) expect(tile(label)).toHaveAttribute("aria-pressed", "false");
    // "All open" is every row except the silent-by-design one, as the list shows.
    expect(chip("All open")).toHaveTextContent(/^All open\s*8$/);
    expect(chip("All open")).toHaveAttribute("aria-pressed", "true");
    expect(chip("Answered")).toHaveTextContent(/^Answered\s*1$/);
    expect(chip("Silent by design")).toHaveTextContent(/^Silent by design\s*1$/);
    expect(messagesListed()).toHaveLength(8);
    expect(shownLine()).toHaveTextContent("8 people shown · All open");

    fireEvent.click(tile("Hot"));
    expect(tile("Hot")).toHaveAttribute("aria-pressed", "true");
    expect(tile("Waiting on us")).toHaveAttribute("aria-pressed", "false");
    expect(chip("All open")).toHaveAttribute("aria-pressed", "false");
    expect(messagesListed()).toEqual(["Hot: marcus", "Hot: kadin"]);
    expect(shownLine()).toHaveTextContent("2 people shown · Hot");

    fireEvent.click(tile("Booked"));
    expect(messagesListed()).toEqual(["Booked: hector"]);
    expect(shownLine()).toHaveTextContent("1 person shown · Booked");

    fireEvent.click(chip("Silent by design"));
    expect(messagesListed()).toEqual(["Silent by design: spam"]);
    expect(chip("Silent by design")).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Show all open" }));
    expect(messagesListed()).toHaveLength(8);
    expect(chip("All open")).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps the platform chips and search working on the picked bucket", async () => {
    renderPage();
    await screen.findByText("Marcus Powell");
    fireEvent.click(tile("Hot"));
    fireEvent.click(screen.getByRole("button", { name: "TikTok" }));
    expect(screen.getByRole("button", { name: "TikTok" })).toHaveAttribute("aria-pressed", "true");
    expect(messagesListed()).toEqual(["Hot: kadin"]);
    expect(shownLine()).toHaveTextContent("1 person shown · Hot · TikTok");
    fireEvent.change(screen.getByRole("textbox", { name: "Search messages" }), { target: { value: "nobody" } });
    expect(screen.getByText("Nobody matches these filters.")).toBeInTheDocument();
  });

  it("shows dashes and says the numbers are loading, never 0", async () => {
    db.pending = true;
    renderPage();
    expect(await screen.findByText(/Loading the messages/)).toBeInTheDocument();
    for (const label of TILES) {
      expect(tile(label)).toHaveTextContent("—");
      expect(tile(label)).not.toHaveTextContent(/\d/);
    }
    for (const label of ["All open", "Answered", "Silent by design"]) {
      expect(chip(label)).toHaveTextContent("—");
      expect(chip(label)).toBeDisabled();
    }
    expect(screen.queryByText(/0 people/)).toBeNull();
  });

  it("shows dashes, the reason and Try again when the read fails, then recovers", async () => {
    db.readError = { message: "permission denied" };
    renderPage();
    expect(await screen.findByText("Could not load the command center")).toBeInTheDocument();
    expect(screen.getByText("permission denied")).toBeInTheDocument();
    expect(screen.getByText(/numbers are hidden rather than shown as 0/)).toBeInTheDocument();
    for (const label of TILES) {
      expect(tile(label)).toHaveTextContent("—");
      expect(tile(label)).not.toHaveTextContent(/\d/);
    }
    expect(chip("All open")).toBeDisabled();

    db.readError = null;
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    await screen.findByText("Marcus Powell");
    expect(tile("Hot")).toHaveTextContent(/^Hot\s*2/);
    expect(screen.queryByText(/numbers are hidden/)).toBeNull();
  });

  it("puts the dead lane first with its fix in the hot tone, and the live lane in the good tone", async () => {
    renderPage();
    await screen.findByText("Marcus Powell");
    const region = screen.getByRole("region", { name: "Lane health" });
    const items = within(region).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent(/youtube oauth/);
    expect(items[0]).toHaveTextContent("dead · token expired");
    expect(items[0]).toHaveTextContent("Sign in with Google as the channel owner.");
    expect(items[0]).toHaveTextContent("Sam · pages Sam");
    expect(within(items[0]).getByText("Dead").className).toMatch(/text-tone-hot/);
    expect(items[0].className).toMatch(/border-tone-hot/);
    const link = within(items[0]).getByRole("link", { name: /Reconnect YouTube/ });
    expect(link).toHaveAttribute("href", "https://accounts.example/consent");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(items[1]).toHaveTextContent(/instagram dm in/);
    expect(items[1]).toHaveTextContent("ok · 1h ago");
    expect(within(items[1]).getByText("Alive").className).toMatch(/text-tone-good/);
    expect(within(items[1]).queryByRole("link")).toBeNull();
    expect(within(region).getByText("1 of 2 lanes need a fix.")).toBeInTheDocument();
    expect(within(region).queryByText("Every lane is alive.")).toBeNull();
    expect(region.querySelector(".apex-breathe")).toBeNull();
  });

  it("breathes one good dot only when every lane is alive", async () => {
    db.payload = { ...payload, lanes: [aliveLane] };
    renderPage();
    await screen.findByText("Marcus Powell");
    const region = screen.getByRole("region", { name: "Lane health" });
    expect(within(region).getByText("Every lane is alive.")).toBeInTheDocument();
    expect(region.querySelectorAll(".apex-breathe")).toHaveLength(1);
    expect(region.querySelector(".apex-breathe")).toHaveAttribute("aria-hidden", "true");
  });

  it("names each platform beside its bubble and reads the reply rate as a tone pill with the percentage", async () => {
    renderPage();
    await screen.findByText("Marcus Powell");
    const conversions = screen.getByRole("region", { name: "Conversions by platform" });
    expect(within(conversions).getByText("Instagram")).toBeInTheDocument();
    expect(within(conversions).getByText("11%").className).toMatch(/text-tone-hot/); // 65 of 566
    expect(within(conversions).getByText("73%").className).toMatch(/text-tone-good/); // 131 of 180
    expect(within(conversions).getByText("Nobody wrote in").className).toMatch(/text-tone-slate/);
    const instagramRow = within(conversions).getByText("Instagram").closest("tr") as HTMLElement;
    expect(within(instagramRow).getByText("22").className).toMatch(/font-bold/); // Applications, bold; TikTok's 22 posts live in another row
    const pulls = screen.getByRole("region", { name: "What pulls applications" });
    expect(within(pulls).getByText("Untracked").className).toMatch(/text-muted-foreground/);
    expect(within(pulls).getByText("63")).toBeInTheDocument();
    // Bubbles are decoration: hidden from assistive technology, the words carry the meaning.
    for (const bubble of conversions.querySelectorAll("span[aria-hidden='true'].rounded-full")) expect(bubble.textContent === "" || bubble.textContent?.length === 1).toBe(true);
  });

  it("Approve writes social_draft_set_status with the draft's id and celebrates once, after the save succeeded", async () => {
    renderPage();
    const approve = await screen.findByRole("button", { name: "Approve What the exam asks" });
    expect(approve.className).toMatch(/\bh-11\b/);
    fireEvent.click(approve);
    await waitFor(() => expect(writes()).toEqual([{ p_id: 901, p_status: "approved" }]));
    await waitFor(() => expect(celebrate).toHaveBeenCalledTimes(1));
    expect(celebrate).toHaveBeenCalledWith("save", approve);
    expect(toast.success).toHaveBeenCalledWith("What the exam asks: approved");
    expect(toast.error).not.toHaveBeenCalled();
    expect(playSoundEffect).not.toHaveBeenCalled();
  });

  it("does not celebrate when the save fails: only the error toast", async () => {
    db.writeError = { message: "not allowed" };
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Approve What the exam asks" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not update draft: not allowed"));
    expect(writes()).toEqual([{ p_id: 901, p_status: "approved" }]);
    expect(celebrate).not.toHaveBeenCalled();
    expect(playSoundEffect).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("Archive plays a whoosh and Reject a tick, each after its own save", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Archive What the exam asks" }));
    await waitFor(() => expect(playSoundEffect).toHaveBeenCalledWith("whoosh"));
    fireEvent.click(screen.getByRole("button", { name: "Reject Ride-along" }));
    await waitFor(() => expect(playSoundEffect).toHaveBeenCalledWith("tick"));
    expect(writes()).toEqual([{ p_id: 901, p_status: "archived" }, { p_id: 902, p_status: "rejected" }]);
    expect(celebrate).not.toHaveBeenCalled();
  });

  it("keeps every control at 44px, every link to another site safe, and nothing under 13px", async () => {
    renderPage();
    await screen.findByText("Marcus Powell");
    for (const label of ["All open", "Answered", "Silent by design"]) expect(chip(label).className).toMatch(/\bh-11\b/);
    for (const name of ["All platforms", "Instagram", "TikTok", "YouTube"]) expect(screen.getByRole("button", { name }).className).toMatch(/\bh-11\b/);
    expect(screen.getByRole("textbox", { name: "Search messages" }).className).toMatch(/\bh-11\b/);
    for (const name of ["Download CSV, ReadyMode: old applicants", "Download CSV, Win-back: former agents"]) {
      expect(screen.getByRole("link", { name }).className).toMatch(/\bh-11\b/);
    }
    for (const name of ["Archive What the exam asks", "Reject What the exam asks"]) expect(screen.getByRole("button", { name }).className).toMatch(/\bh-11\b/);
    const profile = screen.getByRole("link", { name: "Marcus Powell" });
    expect(profile).toHaveAttribute("href", "https://www.instagram.com/marcus/");
    expect(profile).toHaveAttribute("rel", "noopener noreferrer");
    expect(profile.className).toMatch(/\bmin-h-11\b/);
    expect(document.body.innerHTML).not.toMatch(/text-\[1[0-2]px\]|\btext-1[12]\b/);
  });
});
