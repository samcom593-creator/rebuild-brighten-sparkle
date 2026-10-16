/**
 * F39 (2026-10-14 Galaxy OS map): every label on MyReferralLinkCard passes
 * WCAG AA (4.5:1; all of its text is 12 to 14px) in the light and dark themes.
 *
 * Token math alone was wrong for this card. Measured in Chromium against the
 * compiled app CSS on 2026-10-15, the "live" badge rendered WHITE on the light
 * card (1.18:1): its bg-emerald-500/10 class matched the light-mode rule in
 * src/styles/apex-tokens.css that forces white text on any bg-emerald-*
 * element without a text-emerald-* class, so the text token the component
 * asked for never applied. The loading card's bg-card/80 was likewise
 * repainted pure white. So this file has two halves:
 *  1. Cascade guard: render the real card and fail when a theme rule (scoped
 *     to .light / .dark, or !important, so it beats a one-class utility) that
 *     sets a color or background matches any of its elements. The guard is
 *     shown failing on the old classes first.
 *  2. Token math: the ratios from the --card, --card-foreground,
 *     --muted-foreground and --primary values in src/index.css, which only
 *     describe what renders while the guard holds.
 */
import fs from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { supabase } from "@/integrations/supabase/client";

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "user-1" } }) }));

import { MyReferralLinkCard } from "@/components/agent/MyReferralLinkCard";

const root = path.resolve(__dirname, "../../..");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");
const STYLESHEETS = ["src/index.css", "src/styles/apex-tokens.css"];
const THEMES = ["light", "dark"] as const;
type Theme = (typeof THEMES)[number];
const AA_NORMAL_TEXT = 4.5;

// ── Stylesheet rules ────────────────────────────────────────────────────────

interface CssRule { file: string; selector: string; body: string }

function splitSelectorList(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if (ch === "(" || ch === "[") depth += 1;
    if (ch === ")" || ch === "]") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function flatRules(file: string): CssRule[] {
  const css = read(file).replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: CssRule[] = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectorText = match[1].trim();
    if (selectorText.startsWith("@")) continue;
    for (const selector of splitSelectorList(selectorText)) rules.push({ file, selector, body: match[2] });
  }
  return rules;
}

const SETS_COLOR = /(^|[\s;])(color|background|background-color)\s*:|@apply[^;]*(^|\s)(text|bg)-/;
const THEME_SCOPED = /\.(light|dark)(?![\w-])/;

/** Theme rules that set a color or background and outrank a one-class Tailwind utility. */
const overrideRules: CssRule[] = STYLESHEETS.flatMap(flatRules).filter(
  (rule) => SETS_COLOR.test(rule.body) && (THEME_SCOPED.test(rule.selector) || rule.body.includes("!important")),
);

/** Every override rule that matches an element under `container` with the theme class on <html>. */
function overrideHits(container: HTMLElement, theme: Theme): string[] {
  // A detached element has no :root ancestor, so every ":root.light ..." rule
  // would silently miss it and the guard would pass while checking nothing.
  if (!container.isConnected) throw new Error("overrideHits needs an element attached to the document.");
  const html = document.documentElement;
  const previous = html.className;
  html.className = theme;
  const hits: string[] = [];
  try {
    const elements = [container, ...Array.from(container.querySelectorAll<HTMLElement>("*"))];
    for (const rule of overrideRules) {
      // A pseudo-element selector styles generated content, never the element itself.
      if (rule.selector.includes("::")) continue;
      for (const el of elements) {
        if (el.matches(rule.selector)) hits.push(`${rule.file}: ${rule.selector} matches <${el.tagName.toLowerCase()} class="${el.getAttribute("class") ?? ""}">`);
      }
    }
  } finally {
    html.className = previous;
  }
  return hits;
}

// ── Token math ──────────────────────────────────────────────────────────────

type Rgb = [number, number, number];

function themeTokens(theme: Theme): Record<string, string> {
  const block = read("src/index.css").match(new RegExp(`^\\s*\\.${theme}\\s*\\{([^}]*)\\}`, "m"));
  if (!block) throw new Error(`No .${theme} token block in src/index.css`);
  const tokens: Record<string, string> = {};
  for (const m of block[1].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) tokens[m[1]] = m[2].trim();
  return tokens;
}

function hslToken(tokens: Record<string, string>, name: string): Rgb {
  const m = (tokens[name] ?? "").match(/^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/);
  if (!m) throw new Error(`--${name} is not a plain "H S% L%" token: ${tokens[name]}`);
  const [h, s, l] = [Number(m[1]), Number(m[2]) / 100, Number(m[3]) / 100];
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const base = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + base) * 255, (g + base) * 255, (b + base) * 255];
}

function over(top: Rgb, alpha: number, base: Rgb): Rgb {
  return [0, 1, 2].map((i) => alpha * top[i] + (1 - alpha) * base[i]) as Rgb;
}

function luminance([r, g, b]: Rgb): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// ── Rendering the real card ─────────────────────────────────────────────────

const ACTIVE_LINK = { active: true, ref_slug: "jontay-taylor-957597", link: "https://apex-financial.org/apply?ref=jontay-taylor-957597" };

function renderCard(result: Promise<unknown>) {
  vi.mocked(supabase.rpc).mockImplementation((() => result) as never);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MyReferralLinkCard />
    </QueryClientProvider>,
  );
}

async function renderActive() {
  const view = renderCard(Promise.resolve({ data: ACTIVE_LINK, error: null }));
  await screen.findByText("Your link in bio");
  return view;
}

async function renderLoading() {
  const view = renderCard(new Promise(() => undefined));
  await screen.findByText(/Loading your referral link/);
  return view;
}

function classesOf(el: Element | null): string[] {
  return (el?.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
}

afterEach(() => {
  vi.mocked(supabase.rpc).mockReset();
});

describe("MyReferralLinkCard contrast (F39)", () => {
  it("the cascade guard flags the classes that rendered white text and a white card", () => {
    const old = document.createElement("div");
    old.innerHTML = '<div class="border-border/60 bg-card/80"><p class="text-muted-foreground">Loading</p></div><div class="text-muted-foreground border-emerald-500/40 bg-emerald-500/10">live</div>';
    expect(() => overrideHits(old, "light")).toThrow(/attached/);
    document.body.appendChild(old);
    const hits = overrideHits(old, "light");
    old.remove();
    expect(hits.some((hit) => hit.includes('[class*="bg-emerald-"]:not([class*="text-emerald-"])'))).toBe(true);
    expect(hits.some((hit) => hit.includes(".bg-card\\/80"))).toBe(true);
    // The dark theme has no such rule, which is why the dark badge always read fine.
    document.body.appendChild(old);
    const darkHits = overrideHits(old, "dark");
    old.remove();
    expect(darkHits.filter((hit) => hit.includes("bg-emerald-") || hit.includes("bg-card\\/80"))).toEqual([]);
  });

  it("no theme rule repaints any element of the rendered card, active or loading, in either theme", async () => {
    const active = await renderActive();
    for (const theme of THEMES) expect(overrideHits(active.container, theme)).toEqual([]);
    active.unmount();
    const loading = await renderLoading();
    for (const theme of THEMES) expect(overrideHits(loading.container, theme)).toEqual([]);
  });

  it("each label clears 4.5:1 on its composited surface in both themes", async () => {
    const view = await renderActive();
    const card = view.container.querySelector(".apex-card");
    const eyebrow = screen.getByText("Your link in bio");
    const help = screen.getByText(/Put it in Instagram/);
    const badge = screen.getByText("live");
    // The token pairs the math below uses are the classes the card renders.
    expect(classesOf(card)).toContain("bg-card");
    expect(classesOf(eyebrow)).toContain("text-card-foreground");
    expect(classesOf(help)).toContain("text-muted-foreground");
    expect(classesOf(badge)).toContain("text-muted-foreground");
    const tint = classesOf(badge).map((c) => c.match(/^bg-primary\/(\d+)$/)).find(Boolean);
    expect(tint).toBeTruthy();
    const tintAlpha = Number(tint?.[1]) / 100;
    view.unmount();

    const loading = await renderLoading();
    const loadingText = screen.getByText(/Loading your referral link/);
    expect(classesOf(loadingText)).toContain("text-muted-foreground");
    expect(classesOf(loadingText.closest(".apex-card"))).toContain("bg-card");
    loading.unmount();

    for (const theme of THEMES) {
      const tokens = themeTokens(theme);
      const cardRgb = hslToken(tokens, "card");
      const muted = hslToken(tokens, "muted-foreground");
      const badgeSurface = over(hslToken(tokens, "primary"), tintAlpha, cardRgb);
      const ratios = {
        eyebrow: contrast(hslToken(tokens, "card-foreground"), cardRgb),
        helpAndLoading: contrast(muted, cardRgb),
        live: contrast(muted, badgeSurface),
      };
      for (const [label, ratio] of Object.entries(ratios)) {
        expect({ theme, label, passes: ratio >= AA_NORMAL_TEXT, ratio: Math.round(ratio * 100) / 100 }).toMatchObject({ theme, label, passes: true });
      }
    }
  });
});
