import { useRef, useEffect, useState } from "react";

// Hand-rolled REST call to the public Supabase RPC so this component does NOT
// import the full supabase-js bundle (~170 kB). landing_deal_highlights is
// a SECURITY DEFINER RPC that returns sanitized first-name + 30-day ALP and
// is callable by anon, so we just need the anon apikey at request time.
const SUPABASE_URL = "https://xrzweoneiieddzxogewk.supabase.co";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// 2026-05-04: previously hardcoded fake names+amounts (Sam: "no fake"). Now
// pulls live top-13 producers from the last 30 days via a SECURITY DEFINER
// RPC that anon can call. Returns first-name only + rounded ALP — no PII.
type DealHighlight = { agent: string; amount: number };

const palette = [
  "#22d3a5", "#22d3ee", "#f59e0b", "#f43f5e", "#a78bfa",
  "#22d3a5", "#38bdf8", "#fb923c", "#ec4899", "#2dd4bf",
  "#84cc16", "#d946ef", "#818cf8",
];

const carriers = [
  "American National", "Mutual of Omaha", "Transamerica", "Foresters",
  "Athene", "National Life", "Americo", "F&G", "Prosperity",
  "American Equity", "North American", "Nationwide", "Ethos",
  "American Amicable", "Aflac", "American Home Life", "Royal Neighbors",
  "Guarantee Trust Life", "Newbridge",
];

type TickerItem =
  | { type: "deal"; agent: string; amount: string; color: string }
  | { type: "carrier"; name: string };

function buildTickerItems(deals: Array<{ agent: string; amount: string; color: string }>): TickerItem[] {
  const items: TickerItem[] = [];
  const maxLen = Math.max(deals.length, carriers.length);
  for (let i = 0; i < maxLen; i++) {
    if (i < deals.length) items.push({ type: "deal", ...deals[i] });
    if (i < carriers.length) items.push({ type: "carrier", name: carriers[i] });
  }
  return items;
}

export function DealsTicker() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [tickerItems, setTickerItems] = useState<TickerItem[]>(() =>
    // Carriers-only on first paint while the RPC resolves, so the bar never
    // shows fake numbers for even one frame.
    buildTickerItems([])
  );

  // Pull live top producers — sanitized first-name + 30d ALP, no PII.
  useEffect(() => {
    let cancelled = false;
    fetch(`${SUPABASE_URL}/rest/v1/rpc/landing_deal_highlights`, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: DealHighlight[] | null) => {
        if (cancelled || !data) return;
        const rows = data.map((d, i) => ({
          type: "deal" as const,
          agent: d.agent,
          amount: `$${d.amount.toLocaleString()}`,
          color: palette[i % palette.length],
        }));
        setTickerItems(buildTickerItems(rows));
      })
      .catch(() => { /* silent — carrier-only fallback already rendered */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf: number;
    let pos = 0;
    // PL-011: bumped from 0.5 → 1.2 px/frame so the ticker reads as
    // "live" instead of "frozen." Sam: "this part isn't moving at all."
    const speed = 1.2;

    const tick = () => {
      pos += speed;
      if (pos >= el.scrollWidth / 2) pos = 0;
      el.style.transform = `translateX(-${pos}px)`;
      raf = requestAnimationFrame(tick);
    };

    const handleVis = () => {
      if (document.hidden) cancelAnimationFrame(raf);
      else raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    document.addEventListener("visibilitychange", handleVis);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", handleVis);
    };
  }, [tickerItems]);

  const renderItem = (item: TickerItem, idx: number) => {
    if (item.type === "deal") {
      return (
        <span key={`d-${idx}`} className="inline-flex items-center gap-1.5 px-4 whitespace-nowrap">
          <span className="text-[#8395ab]" aria-hidden>🔥</span>
          <span className="font-bold font-display" style={{ color: item.color }}>{item.agent}</span>
          <span className="text-[#8395ab]">closed</span>
          <span className="font-black font-display" style={{ color: item.color }}>{item.amount}</span>
          <span className="text-[#8395ab]">ALP</span>
          <span className="text-[#1e293b] mx-2">|</span>
        </span>
      );
    }
    return (
      <span key={`c-${idx}`} className="inline-flex items-center gap-1.5 px-4 whitespace-nowrap">
        <span className="text-[#8395ab]">Our agents write with</span>
        <span className="text-[#22d3a5] font-bold font-display">{item.name}</span>
        <span className="text-[#1e293b] mx-2">|</span>
      </span>
    );
  };

  return (
    <div className="fixed top-0 left-0 right-0 z-[60] bg-white dark:bg-[#030712] h-8 overflow-hidden flex items-center border-b border-[#1e293b]/50">
      <div ref={scrollRef} className="flex items-center text-sm will-change-transform">
        {/* Duplicate for seamless loop */}
        {tickerItems.map((item, i) => renderItem(item, i))}
        {tickerItems.map((item, i) => renderItem(item, i + tickerItems.length))}
      </div>
    </div>
  );
}
