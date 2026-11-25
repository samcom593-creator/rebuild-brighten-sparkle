import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CARD_H, CARD_W, buildAwardCopySummary, buildCaption, buildWinPostPresentation,
  fitWinPostText, loadCardImage, renderCardToCanvas, type WinPostItem,
} from "@/lib/winPostCard";

const WIN: WinPostItem = {
  kind: "win", tier: "A", date: "2026-11-24", agent_id: "synthetic-agent",
  agent_name: "Morgan Rivera", photo_url: null, instagram_handle: "@morgan.example",
  alp: 12_345.67, deals: 3, avg_alp: 4115, carrier: "Example Carrier", product: "Example Product",
};
const TROPHY: WinPostItem = {
  ...WIN, kind: "trophy", trophy: "club_50k", headline: "$50K CLUB", subline: "November production club",
  stats: [{ label: "Month ALP", value: "$56,300" }, { label: "Deals", value: "21" }, { label: "Month", value: "November 2026" }],
};

function withRuntimeValue(key: keyof WinPostItem, value: unknown): WinPostItem {
  const item = { ...WIN };
  Reflect.set(item, key, value);
  return item;
}

const monoMeasure = (text: string, fontSize: number) => Array.from(text).length * fontSize * 0.6;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("win post recorded facts and copy", () => {
  it("names premium, counts, and the recorded date without cash/rank/freshness claims", () => {
    const caption = buildCaption(WIN);
    expect(caption).toContain("ON THE BOARD.\nMorgan Rivera — $12,345.67 in Annual Life Premium (ALP).");
    expect(caption).toContain("3 deals.");
    expect(buildWinPostPresentation(WIN).title).toBe("ON THE BOARD");
    expect(caption).toContain("Date: Nov 24, 2026.");
    expect(caption).toContain("@morgan.example");
    expect(caption).toContain("#GalaxyFinancial");
    expect(caption).not.toMatch(/\b(earned|paid|cash|income|just|today|rank|leader|hiring)\b|#1/i);
    expect(caption).not.toContain("Example Carrier");
  });

  it("copies full facts and identifies the highest-premium deal attributes accurately", () => {
    const summary = buildAwardCopySummary(WIN);
    expect(summary).toContain("ALP (Annual Life Premium): $12,345.67");
    expect(summary).toContain("Deals: 3");
    expect(summary).toContain("Average ALP / deal (Annual Life Premium): $4,115");
    expect(summary).toContain("Largest deal carrier: Example Carrier");
    expect(summary).toContain("Largest deal product: Example Product");
    expect(summary).not.toMatch(/written with|all deals/i);
  });

  it.each([undefined, null, NaN, Infinity, -1, "12000", 0.001])("keeps absent/invalid premium %s unavailable instead of manufacturing $0", value => {
    const item = withRuntimeValue("alp", value);
    expect(buildWinPostPresentation(item).metric).toMatchObject({ value: "Not available", available: false, isPremium: true });
    expect(buildCaption(item)).toContain("ALP (Annual Life Premium): Not available");
    expect(buildAwardCopySummary(item)).not.toContain("$0");
  });

  it.each([undefined, null, NaN, Infinity, -1, 1.5, "3"])("keeps absent/invalid deal count %s unavailable", value => {
    const item = withRuntimeValue("deals", value);
    expect(buildWinPostPresentation(item).stats[0]).toMatchObject({ value: "Not available", available: false });
    expect(buildCaption(item)).toContain("Deal count: Not available.");
    expect(buildAwardCopySummary(item)).not.toContain("Deals: 0");
  });

  it("preserves actual recorded zeros and cents", () => {
    expect(buildWinPostPresentation({ ...WIN, alp: 0, deals: 0 }).metric.value).toBe("$0");
    expect(buildCaption({ ...WIN, alp: 0, deals: 0 })).toContain("0 deals.");
    expect(buildWinPostPresentation({ ...WIN, alp: 0.29 }).metric.value).toBe("$0.29");
  });

  it("does not calculate an average that the payload did not supply", () => {
    const stats = buildWinPostPresentation({ ...WIN, avg_alp: undefined }).stats;
    expect(stats.find(stat => stat.label === "Average ALP / deal")?.value).toBe("Not available");
  });

  it("validates the calendar date without rolling invalid dates into a different day", () => {
    expect(buildWinPostPresentation({ ...WIN, date: "2026-02-30" }).dateLabel).toBe("Not available");
    expect(buildWinPostPresentation({ ...WIN, date: "2024-02-29" }).dateLabel).toBe("Feb 29, 2024");
    expect(buildWinPostPresentation({ ...WIN, date: "2026-11-24T23:00:00Z" }).dateLabel).toBe("Not available");
  });

  it("uses the supplied trophy amount separately from the award's threshold title", () => {
    const view = buildWinPostPresentation(TROPHY);
    expect(view.title).toBe("$50K CLUB");
    expect(view.metric).toMatchObject({ label: "Month ALP", value: "$56,300", available: true });
    const caption = buildCaption(TROPHY);
    expect(caption).toContain("Month ALP (Annual Life Premium): $56,300");
    expect(caption).toContain("Month: November 2026");
    expect(caption).not.toMatch(/earned today|#1|rank|highest/i);
  });

  it("does not invent a trophy or amount from a win amount or tier", () => {
    const view = buildWinPostPresentation({ ...TROPHY, headline: undefined, trophy: undefined, stats: [] });
    expect(view.title).toBe("AWARD RECORDED");
    expect(view.metric.value).toBe("Not available");
    expect(buildCaption({ ...TROPHY, headline: undefined, trophy: undefined, stats: [] })).not.toContain("$50K");
  });

  it("handles invalid textual trophy metrics without zero or NaN output", () => {
    const view = buildWinPostPresentation({ ...TROPHY, stats: [{ label: "Month ALP", value: "$NaN" }, { label: "Deals", value: "-3" }] });
    expect(view.metric).toMatchObject({ value: "Not available", available: false });
    expect(view.stats[0].value).toBe("Not available");
    expect(buildAwardCopySummary({ ...TROPHY, stats: [{ label: "ALP", value: "$###" }] })).not.toMatch(/\$0|NaN|###/);
  });

  it("keeps the fast-start premium and deal-count windows distinct", () => {
    const item: WinPostItem = { ...TROPHY, trophy: "fast_start", headline: "$25K IN 30 DAYS", stats: [{ label: "ALP", value: "$27,100" }, { label: "Deals", value: "26" }, { label: "Days in", value: "42" }] };
    expect(buildWinPostPresentation(item).metric.label).toBe("ALP through day 30");
    expect(buildAwardCopySummary(item)).toContain("Deals through day 60: 26");
    expect(buildCaption(item)).not.toContain("26 deals in 30 days");
  });

  it("does not turn a calendar date comparison into an elapsed-24-hour claim", () => {
    const item = { ...TROPHY, trophy: "day_one", headline: "DAY ONE DEAL", subline: "First deal within 24 hrs of contracting" };
    expect(buildWinPostPresentation(item).subline).toBe("First recorded production day");
    expect(buildCaption(item)).not.toContain("24 hrs");
  });

  it("labels the legacy first-on-board report without asserting earliest sale time", () => {
    const item = { ...TROPHY, trophy: "first_on_board", subline: "First deal of the day" };
    expect(buildWinPostPresentation(item).subline).toBe("First qualifying daily report recorded");
    expect(buildCaption(item)).not.toContain("First deal of the day");
  });

  it("keeps complete long identity and stat text for copy while using honest identity fallback", () => {
    const name = "Alexandria " + "Extraordinarilylongsurname".repeat(8);
    const product = "Long product detail ".repeat(30).trim();
    const item = { ...WIN, agent_name: name, product };
    expect(buildAwardCopySummary(item)).toContain(`Agent: ${name}`);
    expect(buildAwardCopySummary(item)).toContain(`Largest deal product: ${product}`);
    expect(buildWinPostPresentation({ ...WIN, agent_name: " \n ", instagram_handle: "not a handle" })).toMatchObject({ agentName: "—", initials: "GF", handle: null });
  });

  it("does not mutate records, identity, trophy eligibility, or the input stat array", () => {
    const stats = TROPHY.stats!.map(stat => Object.freeze({ ...stat }));
    Object.freeze(stats);
    const item = Object.freeze({ ...TROPHY, stats });
    const before = JSON.stringify(item);
    buildWinPostPresentation(item);
    buildCaption(item);
    buildAwardCopySummary(item);
    expect(JSON.stringify(item)).toBe(before);
    expect([CARD_W, CARD_H]).toEqual([1080, 1350]);
  });
});

describe("win post measured text fitting", () => {
  it("keeps a short financial value complete at the intended display size", () => {
    const fit = fitWinPostText("$12,345", monoMeasure, { maxWidth: 912, fontSize: 162, minFontSize: 48 });
    expect(fit).toEqual({ lines: ["$12,345"], fontSize: 162, truncated: false });
  });

  it("wraps a complete name across the allowed lines before reducing its size", () => {
    const fit = fitWinPostText("MORGAN RIVERA", monoMeasure, { maxWidth: 500, fontSize: 80, minFontSize: 44, maxLines: 2 });
    expect(fit.lines).toEqual(["MORGAN", "RIVERA"]);
    expect(fit.fontSize).toBe(80);
    expect(fit.truncated).toBe(false);
  });

  it.each(["ALEXANDRIA " + "VERYLONGSURNAME".repeat(12), "SUPPORT LABEL ".repeat(40), "😀".repeat(90)])("bounds very long text without tiny fonts or broken surrogate pairs", text => {
    const fit = fitWinPostText(text, monoMeasure, { maxWidth: 684, fontSize: 82, minFontSize: 44, maxLines: 2 });
    expect(fit.lines.length).toBeLessThanOrEqual(2);
    expect(fit.fontSize).toBeGreaterThanOrEqual(44);
    expect(fit.lines.every(line => monoMeasure(line, fit.fontSize) <= 684)).toBe(true);
    expect(fit.lines[fit.lines.length - 1]).toMatch(/…$/);
    expect(fit.truncated).toBe(true);
    expect(fit.lines.join("")).not.toContain("�");
  });

  it("fits a large money value without changing its digits", () => {
    const value = "$90,071,992,547.99";
    const fit = fitWinPostText(value, monoMeasure, { maxWidth: 912, fontSize: 162, minFontSize: 48 });
    expect(fit.lines).toEqual([value]);
    expect(fit.truncated).toBe(false);
    expect(monoMeasure(value, fit.fontSize)).toBeLessThanOrEqual(912);
  });

  it("rejects invalid layout bounds and handles empty text explicitly", () => {
    expect(() => fitWinPostText("Name", monoMeasure, { maxWidth: 0, fontSize: 50, minFontSize: 40 })).toThrow(RangeError);
    expect(() => fitWinPostText("Name", monoMeasure, { maxWidth: 500, fontSize: 20, minFontSize: 40 })).toThrow(RangeError);
    expect(fitWinPostText("  ", monoMeasure, { maxWidth: 500, fontSize: 50, minFontSize: 40 })).toEqual({ lines: [], fontSize: 50, truncated: false });
  });
});

class ControlledImage {
  static created: ControlledImage[] = [];
  crossOrigin: string | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 240;
  naturalHeight = 240;
  src = "";
  constructor() { ControlledImage.created.push(this); }
}

function canvasFixture() {
  const canvas = document.createElement("canvas");
  const ctx = {
    canvas, font: "", fillStyle: "", strokeStyle: "", lineWidth: 0, textBaseline: "top",
    fillText: vi.fn(), fillRect: vi.fn(), drawImage: vi.fn(), save: vi.fn(), restore: vi.fn(),
    scale: vi.fn(), translate: vi.fn(), beginPath: vi.fn(), closePath: vi.fn(), moveTo: vi.fn(),
    lineTo: vi.fn(), fill: vi.fn(), stroke: vi.fn(), rect: vi.fn(), clip: vi.fn(),
    measureText: (value: string) => ({ width: value.length * 12 }),
  };
  // The test supplies only drawing methods used by this renderer.
  vi.spyOn(canvas, "getContext").mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  return { canvas, ctx };
}

describe("win post export rendering safety", () => {
  it("rejects a missing canvas context instead of reporting a successful blank export", async () => {
    const canvas = document.createElement("canvas");
    vi.spyOn(canvas, "getContext").mockReturnValue(null);
    await expect(renderCardToCanvas(canvas, WIN)).rejects.toThrow("Canvas rendering is unavailable");
  });

  it("lets only the latest item draw when an older image finishes last", async () => {
    ControlledImage.created = [];
    vi.stubGlobal("Image", ControlledImage);
    const { canvas, ctx } = canvasFixture();
    const oldRender = renderCardToCanvas(canvas, { ...WIN, agent_name: "Older Person", photo_url: "https://example.invalid/old-card-photo" }, 0.3);
    await Promise.resolve();
    expect(ControlledImage.created).toHaveLength(1);
    const newRender = renderCardToCanvas(canvas, { ...WIN, agent_name: "Current Person" }, 0.3);
    await newRender;
    expect([canvas.width, canvas.height]).toEqual([324, 405]);
    expect(vi.mocked(ctx.fillText).mock.calls.map(call => call[0]).join(" ")).toContain("CURRENT PERSON");
    const count = vi.mocked(ctx.fillText).mock.calls.length;
    ControlledImage.created[0].onload?.();
    await oldRender;
    expect(vi.mocked(ctx.fillText)).toHaveBeenCalledTimes(count);
    expect(vi.mocked(ctx.fillText).mock.calls.map(call => call[0]).join(" ")).not.toContain("OLDER PERSON");
  });

  it("bounds stalled image loads and keeps anonymous CORS/failure fallback", async () => {
    vi.useFakeTimers();
    ControlledImage.created = [];
    vi.stubGlobal("Image", ControlledImage);
    const stalled = loadCardImage("https://example.invalid/stalled-card-photo");
    expect(ControlledImage.created[0].crossOrigin).toBe("anonymous");
    await vi.advanceTimersByTimeAsync(8000);
    await expect(stalled).resolves.toBeNull();
    expect(ControlledImage.created[0].onload).toBeNull();
    const failed = loadCardImage("https://example.invalid/failed-card-photo");
    ControlledImage.created[1].onerror?.();
    await expect(failed).resolves.toBeNull();
  });
});
