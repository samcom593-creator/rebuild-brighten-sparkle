/**
 * <Plaque /> — Wolfpack BIG SALE style card.
 *
 * Matches the red-gradient / giant-watermark / bottom-left info-chip
 * layout Sam uses for his team announcements. One reusable template,
 * parameterized. Renders as HTML + SVG text so it can be screenshotted
 * server-side or exported to PNG via html-to-image on the client.
 */

import { cn } from "@/lib/utils";

type PlaqueProps = {
  agentName: string;
  achievement: string;          // e.g. "Monthly Top Producer"
  date: string;
  rank?: number;
  subtitle?: string;            // e.g. "$5,200 Trustage Advantage WL 4/4"
  avatarUrl?: string | null;
  width?: number;
  height?: number;
  /** Big text shown as repeating background watermark. Defaults to "BIG SALE". */
  watermark?: string;
  /** Primary gradient color — default is Wolfpack red. */
  accentColor?: string;
};

export function Plaque({
  agentName,
  achievement,
  date,
  rank,
  subtitle,
  avatarUrl,
  width = 1024,
  height = 1280,           // portrait 4:5 (matches Sam's Wolfpack cards)
  watermark = "BIG SALE",
  accentColor = "#ff0033",
}: PlaqueProps) {
  const initials = agentName.split(" ").map(n => n[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
  // Split name for the neon-outline stack on the right
  const nameParts = agentName.trim().split(" ");
  const firstName = (nameParts[0] || "").toUpperCase();
  const lastName  = (nameParts.slice(1).join(" ") || "").toUpperCase();

  return (
    <div
      className="relative overflow-hidden rounded-md shadow-2xl select-none"
      style={{ width, height, background: "#000" }}
      data-plaque="wolfpack"
    >
      {/* 1. Red radial gradient background — darker top-left, bright red top-right */}
      {/* palette-allow:wolfpack-plaque-award-leather-gradient — physical-award visual, not brand chrome */}
      <div className="absolute inset-0"
        style={{
          background: `radial-gradient(circle at 75% 30%, ${accentColor} 0%, #6b0014 55%, #0a0000 100%)`,
        }} />

      {/* 2. Watermark — big repeating "BIG SALE" text at an angle */}
      <div className="absolute inset-0 pointer-events-none select-none overflow-hidden">
        <svg viewBox="0 0 1024 1280" width="100%" height="100%">
          <defs>
            <linearGradient id="wmGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="rgba(255,255,255,0.10)" />
              <stop offset="100%" stopColor="rgba(0,0,0,0)" />
            </linearGradient>
          </defs>
          <g fontFamily="'Anton', 'Bebas Neue', 'Impact', sans-serif" fontWeight="900"
             fill="url(#wmGrad)" letterSpacing="8">
            <text x="-100" y="260" fontSize="200">{watermark}</text>
            <text x="-50"  y="500" fontSize="200">{watermark}</text>
            <text x="-150" y="740" fontSize="200">{watermark}</text>
            <text x="-30"  y="980" fontSize="200">{watermark}</text>
          </g>
        </svg>
      </div>

      {/* 3. Agent photo — centered upper two-thirds, with red halo */}
      <div className="absolute inset-0 flex items-start justify-center pt-20">
        <div className="relative">
          <div
            className="absolute inset-0 rounded-full  opacity-60"
            style={{ background: accentColor, transform: "scale(1.2)" }}
          />
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={agentName}
              className="relative z-10 rounded-full object-cover"
              style={{ width: 560, height: 560, objectPosition: "center top" }}
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <div
              className="relative z-10 rounded-full flex items-center justify-center font-black text-white bg-white dark:bg-card"
              style={{ width: 560, height: 560, fontSize: 200 }}
            >
              {initials}
            </div>
          )}
        </div>
      </div>

      {/* 4. Bottom-left info chip (dark rounded card with agent handle + product/amount) */}
      <div className="absolute" style={{ left: 48, bottom: 96, maxWidth: 600 }}>
        <div
          className="flex items-center gap-4 px-6 py-5 rounded-md"
          style={{ background: "rgba(12,12,14,0.85)", backdropFilter: "blur(8px)" }}
        >
          <div
            className="flex items-center justify-center rounded-full text-muted-foreground bg-zinc-700/60"
            style={{ width: 72, height: 72 }}
          >
            <svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-4 0-8 2-8 5v3h16v-3c0-3-4-5-8-5z"/>
            </svg>
          </div>
          <div className="leading-tight text-white">
            <div className="text-2xl font-bold">{firstName || agentName}</div>
            {subtitle && <div className="text-sm opacity-80 mt-1">{subtitle}</div>}
            {!subtitle && achievement && <div className="text-sm opacity-80 mt-1">{achievement}</div>}
          </div>
        </div>
      </div>

      {/* 5. Bottom-right: Wolfpack-style logo tile + big outlined name */}
      <div className="absolute" style={{ right: 36, bottom: 40 }}>
        {/* Logo tile */}
        <div
          className="ml-auto mb-3 flex items-center justify-center rounded-md font-black"
          style={{
            width: 120, height: 120, background: "#0a0a0a",
            boxShadow: `0 0 22px ${accentColor}aa, 0 0 44px ${accentColor}55`,
            border: `2px solid ${accentColor}`,
          }}
        >
          <svg viewBox="0 0 24 24" width="64" height="64" fill={accentColor} aria-hidden>
            <path d="M4 4l4 6-3 2 2 2-1 3 4-1 2 3 2-3 4 1-1-3 2-2-3-2 4-6-6 2-2-3-2 3-6-2z"/>
          </svg>
        </div>
        {/* Big neon-outline name, stacked */}
        <div
          className="font-black leading-[0.9] text-right"
          style={{
            fontFamily: "'Anton', 'Bebas Neue', 'Impact', sans-serif",
            color: "#fff",
            fontSize: 108,
            letterSpacing: "0.02em",
            textShadow: `0 0 14px ${accentColor}, 0 0 28px ${accentColor}bb`,
          }}
        >
          <div>{firstName}</div>
          {lastName && <div>{lastName}</div>}
        </div>
      </div>

      {/* 6. Top-right rank or date stamp */}
      {rank && rank <= 3 && (
        <div
          className="absolute top-6 right-6 px-4 py-2 rounded-full text-white font-bold text-sm"
          style={{ background: `${accentColor}`, boxShadow: `0 0 20px ${accentColor}` }}
        >
          #{rank} • {achievement}
        </div>
      )}
      {!rank && (
        <div className="absolute top-6 right-6 text-white/80 text-xs tracking-widest uppercase font-semibold">
          {date}
        </div>
      )}
    </div>
  );
}

export default Plaque;
