import { useRef, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

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
    supabase.rpc("landing_deal_highlights" as any).then(({ data, error }) => {
      if (cancelled || error || !data) return;
      const rows = (data as DealHighlight[]).map((d, i) => ({
        type: "deal" as const,
        agent: d.agent,
        amount: `$${d.amount.toLocaleString()}`,
        color: palette[i % palette.length],
      }));
      setTickerItems(buildTickerItems(rows));
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf: number;
    let pos = 0;
    const speed = 0.5; // px per frame

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
          <span className="text-[#64748b]">🔥</span>
          <span className="font-bold font-display" style={{ color: item.color }}>{item.agent}</span>
          <span className="text-[#64748b]">closed</span>
          <span className="font-black font-display" style={{ color: item.color }}>{item.amount}</span>
          <span className="text-[#64748b]">ALP</span>
          <span className="text-[#1e293b] mx-2">|</span>
        </span>
      );
    }
    return (
      <span key={`c-${idx}`} className="inline-flex items-center gap-1.5 px-4 whitespace-nowrap">
        <span className="text-[#64748b]">Our agents write with</span>
        <span className="text-[#22d3a5] font-bold font-display">{item.name}</span>
        <span className="text-[#1e293b] mx-2">|</span>
      </span>
    );
  };

  return (
    <div className="fixed top-0 left-0 right-0 z-[60] bg-[#030712] h-8 overflow-hidden flex items-center border-b border-[#1e293b]/50">
      <div ref={scrollRef} className="flex items-center text-sm will-change-transform">
        {/* Duplicate for seamless loop */}
        {tickerItems.map((item, i) => renderItem(item, i))}
        {tickerItems.map((item, i) => renderItem(item, i + tickerItems.length))}
      </div>
    </div>
  );
}
