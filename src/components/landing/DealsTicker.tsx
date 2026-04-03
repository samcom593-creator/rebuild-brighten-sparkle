import { useRef, useEffect } from "react";

const deals = [
  { agent: "MOODY", amount: "$3,324", color: "#22d3a5" },
  { agent: "CHUDI", amount: "$2,575", color: "#22d3ee" },
  { agent: "KJ", amount: "$3,441", color: "#f59e0b" },
  { agent: "OBI", amount: "$5,189", color: "#f43f5e" },
  { agent: "JACOB", amount: "$4,174", color: "#a78bfa" },
  { agent: "AISHA", amount: "$1,559", color: "#22d3a5" },
  { agent: "XAVIAR", amount: "$2,483", color: "#38bdf8" },
  { agent: "SAMUEL", amount: "$1,430", color: "#fb923c" },
  { agent: "DALTON", amount: "$1,430", color: "#ec4899" },
  { agent: "MARCOS", amount: "$1,775", color: "#2dd4bf" },
  { agent: "WENDELL", amount: "$1,325", color: "#84cc16" },
  { agent: "LUIS", amount: "$840", color: "#d946ef" },
  { agent: "DUDLEY", amount: "$1,847", color: "#818cf8" },
];

const carriers = [
  "American National", "Mutual of Omaha", "Transamerica", "Foresters",
  "Athene", "National Life", "Americo", "F&G", "Prosperity",
  "American Equity", "North American", "Nationwide", "Ethos",
  "American Amicable", "Aflac", "American Home Life", "Royal Neighbors",
  "Guarantee Trust Life", "Newbridge",
];

// Build ticker items: interleave deals with carrier mentions
function buildTickerItems() {
  const items: Array<{ type: "deal"; agent: string; amount: string; color: string } | { type: "carrier"; name: string }> = [];
  const maxLen = Math.max(deals.length, carriers.length);
  for (let i = 0; i < maxLen; i++) {
    if (i < deals.length) items.push({ type: "deal", ...deals[i] });
    if (i < carriers.length) items.push({ type: "carrier", name: carriers[i] });
  }
  return items;
}

const tickerItems = buildTickerItems();

export function DealsTicker() {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf: number;
    let pos = 0;
    const speed = 0.5; // px per frame

    const tick = () => {
      pos += speed;
      // When we've scrolled past the first copy, reset
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
  }, []);

  const renderItem = (item: (typeof tickerItems)[number], idx: number) => {
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
