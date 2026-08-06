/**
 * APEX Game FX — fire-and-forget celebration hooks.
 *
 * Usage (from any component):
 *
 *   import { coinRain, levelUpBanner, screenFlash } from "@/lib/gameFx";
 *
 *   coinRain(24);                      // 24 gold coins falling
 *   levelUpBanner("$10K CLUB");        // gold banner at the top for 4s
 *   screenFlash("emerald", 600);       // brief emerald flash
 *
 * Everything is plain DOM — no providers, no context. Respects
 * prefers-reduced-motion automatically by reading user preference.
 */

function reducedMotion(): boolean {
  return typeof window !== "undefined"
    && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

export function coinRain(count = 20, durationMs = 2800): void {
  if (typeof document === "undefined" || reducedMotion()) return;
  const symbols = ["💰", "💵", "$"];
  const host = document.createElement("div");
  host.className = "coin-rain";
  host.setAttribute("aria-hidden", "true");
  for (let i = 0; i < count; i++) {
    const coin = document.createElement("span");
    coin.textContent = symbols[Math.floor(Math.random() * symbols.length)];
    coin.style.left = `${Math.random() * 100}%`;
    coin.style.animationDelay = `${Math.random() * 0.8}s`;
    coin.style.animationDuration = `${1.8 + Math.random() * 1.6}s`;
    coin.style.fontSize = `${1.4 + Math.random() * 2}rem`;
    host.appendChild(coin);
  }
  document.body.appendChild(host);
  setTimeout(() => host.remove(), durationMs + 400);
}

export function levelUpBanner(text: string, durationMs = 4000): void {
  if (typeof document === "undefined" || reducedMotion()) return;
  // only one banner at a time
  document.querySelectorAll(".level-up-banner").forEach(n => n.remove());
  const el = document.createElement("div");
  el.className = "level-up-banner";
  el.textContent = text;
  el.setAttribute("aria-live", "polite");
  document.body.appendChild(el);
  setTimeout(() => el.remove(), durationMs);
}

export function screenFlash(color: "emerald" | "gold" | "rose" = "emerald", durationMs = 500): void {
  if (typeof document === "undefined" || reducedMotion()) return;
  const palette: Record<string, string> = {
    // 2026-08-06: the "emerald" key kept its pre-rebrand teal flash. The name
    // is load-bearing (callers pass the string) so it stays; the colour is now
    // brand gold like every other celebratory surface.
    emerald: "hsl(var(--primary) / 0.22)",
    gold:    "hsl(42 95% 55% / 0.22)",
    rose:    "hsl(350 75% 55% / 0.22)",
  };
  const flash = document.createElement("div");
  flash.style.position = "fixed";
  flash.style.inset = "0";
  flash.style.background = palette[color];
  flash.style.pointerEvents = "none";
  flash.style.zIndex = "9998";
  flash.style.transition = `opacity ${durationMs}ms ease-out`;
  flash.style.opacity = "1";
  document.body.appendChild(flash);
  requestAnimationFrame(() => { flash.style.opacity = "0"; });
  setTimeout(() => flash.remove(), durationMs + 50);
}

/**
 * Celebrate a closed deal — coin rain + gold flash + banner.
 * Pass the amount (monthly premium) and it sizes the party to match.
 */
export function celebrateDeal(amountMonthly: number): void {
  const intensity = amountMonthly >= 5000 ? 60 : amountMonthly >= 3000 ? 40 : amountMonthly >= 1000 ? 28 : 14;
  coinRain(intensity);
  screenFlash("gold", 600);
  const label = amountMonthly >= 5000 ? "PLATINUM DEAL"
              : amountMonthly >= 3000 ? "GOLD DEAL"
              : amountMonthly >= 1000 ? "BRONZE DEAL"
              : "DEAL CLOSED";
  levelUpBanner(label, 3600);
}

/**
 * Attach a ripple origin handler so .btn-ripple animates from the click point.
 * Call once in App root: installRippleOrigin();
 */
export function installRippleOrigin(): void {
  if (typeof document === "undefined") return;
  if ((window as any).__apexRippleInstalled) return;
  (window as any).__apexRippleInstalled = true;
  document.addEventListener("pointerdown", (e) => {
    const target = (e.target as HTMLElement | null)?.closest(".btn-ripple") as HTMLElement | null;
    if (!target) return;
    const rect = target.getBoundingClientRect();
    target.style.setProperty("--ripple-x", `${e.clientX - rect.left}px`);
    target.style.setProperty("--ripple-y", `${e.clientY - rect.top}px`);
  }, { passive: true });
}

/**
 * Observe elements with `.reveal` and add `.in-view` when they scroll
 * into sight. Call once in App root: installRevealObserver();
 */
export function installRevealObserver(): void {
  if (typeof document === "undefined" || reducedMotion()) return;
  if ((window as any).__apexRevealInstalled) return;
  (window as any).__apexRevealInstalled = true;
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add("in-view");
        io.unobserve(entry.target);
      }
    }
  }, { threshold: 0.12, rootMargin: "0px 0px -60px 0px" });
  const wireAll = () => document.querySelectorAll(".reveal:not(.in-view)").forEach(el => io.observe(el));
  wireAll();
  const mo = new MutationObserver(wireAll);
  mo.observe(document.body, { childList: true, subtree: true });
}
