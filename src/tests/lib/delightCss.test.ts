/**
 * The motion layer's stylesheet (src/styles/delight.css) read as text: the rules the motion
 * review of 2026-10-28 settled, so a later edit cannot quietly drift back over the budget.
 * docs/audits/2026-10-28-motion-review.md has the reasoning and the numbers.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// vitest runs from the repo root; import.meta.url is not a file: URL under vite-node.
const css = readFileSync(resolve(process.cwd(), "src/styles/delight.css"), "utf8");

/** The text of one @keyframes block. */
function keyframes(name: string): string {
  const match = css.match(new RegExp(`@keyframes ${name}\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!match) throw new Error(`no @keyframes ${name}`);
  return match[1];
}

/** Read the actual ambient rules, including reduced-motion overrides, without requiring animation. */
const ambient = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter(([, selector]) => selector.trim().startsWith(".apex-ambient"))
  .map(([, , body]) => body)
  .join("\n");

describe("delight.css motion budget", () => {
  it("every one-shot animation is inside the 300ms UI budget and on the strong ease-out", () => {
    const oneShots = [...css.matchAll(/animation: apex-(rise|pop|bump|fade|dim) (\d+)ms ([^ ;]+)/g)];
    expect(oneShots.length).toBeGreaterThanOrEqual(5);
    for (const [, name, ms, ease] of oneShots) {
      expect(Number(ms), `${name} duration`).toBeLessThanOrEqual(300);
      expect(Number(ms), `${name} duration`).toBeGreaterThanOrEqual(200);
      expect(ease, `${name} easing`).not.toMatch(/ease-in\b|ease-in-out|linear/);
    }
    expect(css).toContain("--ease-out-strong: cubic-bezier(0.23, 1, 0.32, 1)");
  });

  it("entrances start from a visible shape, hold only their start state, and never animate layout", () => {
    expect(css).not.toMatch(/scale\(0\)/);
    expect(keyframes("apex-pop")).toMatch(/scale\(0\.9\d\)/);
    // `both` would pin the final transform and cancel every hover lift and press on a row or tile.
    expect(css).not.toMatch(/animation: apex-(rise|pop|fade) [^;]*\bboth\b/);
    expect(css).toMatch(/animation: apex-rise [^;]*backwards/);
    for (const name of ["apex-rise", "apex-pop", "apex-bump", "apex-breathe", "apex-fade", "apex-dim"]) {
      const body = keyframes(name);
      expect(body, `${name} animates composite-only properties`).not.toMatch(/box-shadow|filter|width|height|margin|padding|top:|left:/);
    }
    expect(css).not.toMatch(/transition:\s*all/);
  });

  it("the stagger is 30ms a row and stops at the fold", () => {
    expect(css).toContain(".apex-rise-list > :nth-child(2)  { animation-delay: 30ms; }");
    expect(css).toContain(".apex-rise-list > :nth-child(14) { animation-delay: 390ms; }");
    expect(css).toContain(".apex-rise-list > :nth-child(n + 15) { animation: none; }");
    expect(css).toContain("animation-delay: calc(min(var(--rise-i, 0), 8) * 30ms);");
  });

  it("hover motion is gated to a real pointer and every pressable presses in", () => {
    expect(css).toContain("@media (hover: hover) and (pointer: fine)");
    expect(css).not.toMatch(/@media \(hover: hover\) \{/);
    expect(css).toMatch(/\.apex-lift:active:not\(:disabled\),\s*\.apex-press:active:not\(:disabled\) \{ transform: scale\(0\.98\); \}/);
  });

  it("ambient paint is static, faint, fixed at the edges, and never intercepts controls", () => {
    expect(ambient).not.toContain("--tone-royal");
    const paints = [...ambient.matchAll(/(?:^|;)\s*background(?:-color|-image)?\s*:\s*([^;]+);/g)].map((m) => m[1].trim());
    expect(paints.length).toBeGreaterThan(0);
    for (const paint of paints) {
      const alpha = paint.match(/^hsl\(var\(--primary\)\s*\/\s*(0\.\d+)\)$/);
      expect(alpha, "ambient paint uses the brand token with an explicit low alpha").not.toBeNull();
      expect(Number(alpha?.[1])).toBeGreaterThan(0);
      expect(Number(alpha?.[1])).toBeLessThanOrEqual(0.16);
    }
    const animations = [...ambient.matchAll(/(?:^|;)\s*(animation(?:-[\w-]+)?)\s*:\s*([^;]+);/g)];
    for (const [, property, value] of animations) {
      expect(property).toBe("animation");
      expect(value.trim()).toBe("none");
    }
    expect(css).not.toContain("@keyframes apex-drift");
    expect(ambient).not.toMatch(/filter|backdrop|blur/);
    expect(ambient).toContain("pointer-events: none;");
    expect(ambient).toContain("position: fixed;");
    expect(ambient).toContain("overflow: hidden;");
    expect(ambient).toMatch(/\bright:\s*-\d+(?:\.\d+)?rem;/);
    expect(ambient).toMatch(/\bleft:\s*-\d+(?:\.\d+)?rem;/);
    expect(ambient).toMatch(/\btop:\s*\d+(?:\.\d+)?vh;/);
    expect(ambient).toMatch(/\bbottom:\s*\d+(?:\.\d+)?vh;/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.apex-ambient > span \{ animation: none; \}/);
  });

  it("reduced motion keeps a short fade and a dip, and drops every movement", () => {
    const block = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(block).toMatch(/animation: apex-fade 200ms ease-out backwards !important/);
    expect(block).toMatch(/\.apex-bump \{ animation: apex-dim 200ms ease-out !important; \}/);
    expect(block).toMatch(/\.apex-breathe::after \{ animation: none; opacity: 0; \}/);
    // The override must repeat the press selectors exactly: a shorter `.apex-press:active` has
    // lower specificity than `.apex-press:active:not(:disabled)` and the press kept scaling.
    expect(block).toMatch(/\.apex-lift:active:not\(:disabled\),\s*\.apex-press:active:not\(:disabled\) \{ transform: none; \}/);
    expect(keyframes("apex-fade")).not.toMatch(/transform/);
    expect(keyframes("apex-dim")).not.toMatch(/transform/);
  });

  it("the live indicator loops on a pseudo-element ring, one colour, transform and opacity only", () => {
    expect(css).toMatch(/\.apex-breathe::after \{[^}]*border: 2px solid currentColor;[^}]*animation: apex-breathe 1\.8s var\(--ease-out-strong\) infinite;/s);
    expect(keyframes("apex-breathe")).toMatch(/transform: scale\(1\.5\); opacity: 0;/);
  });
});
