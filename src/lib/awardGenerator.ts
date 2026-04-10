// Pure SVG award graphics generator — no API keys needed, works everywhere
// Replaces the LOVABLE_API_KEY dependent version

export type AwardType =
  | "top_producer"
  | "leaderboard"
  | "first_deal"
  | "top_producer_week"
  | "most_hires_week"
  | "most_hires_month"
  | "hot_streak"
  | "on_fire"
  | "unstoppable"
  | "diamond_week"
  | "elite_producer"
  | "comeback";

interface AwardConfig {
  emoji: string;
  label: string;
  bg1: string;
  bg2: string;
  accent: string;
  textColor: string;
}

const AWARD_CONFIGS: Record<AwardType, AwardConfig> = {
  top_producer:      { emoji: "🏆", label: "TOP PRODUCER",      bg1: "#030712", bg2: "#0f172a", accent: "#f59e0b", textColor: "#f59e0b" },
  leaderboard:       { emoji: "📊", label: "LEADERBOARD",       bg1: "#030712", bg2: "#0f172a", accent: "#22d3a5", textColor: "#22d3a5" },
  first_deal:        { emoji: "🎯", label: "FIRST DEAL",        bg1: "#030712", bg2: "#0f172a", accent: "#22d3a5", textColor: "#22d3a5" },
  top_producer_week: { emoji: "🥇", label: "WEEKLY CHAMPION",   bg1: "#030712", bg2: "#0f172a", accent: "#f59e0b", textColor: "#f59e0b" },
  most_hires_week:   { emoji: "👥", label: "HIRING CHAMPION",   bg1: "#030712", bg2: "#0f172a", accent: "#a78bfa", textColor: "#a78bfa" },
  most_hires_month:  { emoji: "🤝", label: "RECRUITER OF MONTH",bg1: "#030712", bg2: "#0f172a", accent: "#a78bfa", textColor: "#a78bfa" },
  hot_streak:        { emoji: "🔥", label: "HOT STREAK",        bg1: "#030712", bg2: "#1a0a00", accent: "#f97316", textColor: "#f97316" },
  on_fire:           { emoji: "🔥🔥", label: "ON FIRE",         bg1: "#030712", bg2: "#1a0500", accent: "#ef4444", textColor: "#ef4444" },
  unstoppable:       { emoji: "⚡", label: "UNSTOPPABLE",       bg1: "#030712", bg2: "#0d0a1a", accent: "#8b5cf6", textColor: "#8b5cf6" },
  diamond_week:      { emoji: "💎", label: "DIAMOND WEEK",      bg1: "#030712", bg2: "#050f1a", accent: "#38bdf8", textColor: "#38bdf8" },
  elite_producer:    { emoji: "👑", label: "ELITE PRODUCER",    bg1: "#030712", bg2: "#0f0a00", accent: "#f59e0b", textColor: "#f59e0b" },
  comeback:          { emoji: "📈", label: "COMEBACK",          bg1: "#030712", bg2: "#001a0a", accent: "#22d3a5", textColor: "#22d3a5" },
};

export interface GenerateAwardOptions {
  awardType: AwardType;
  agentName: string;
  statValue: string;       // e.g. "$12,400" or "7 Day Streak"
  statLabel: string;       // e.g. "Weekly ALP" or "Consecutive Days"
  periodLabel: string;     // e.g. "This Week" or "January 2025"
  rank?: number;           // optional rank number
  agentPhotoUrl?: string;  // optional photo URL
  size?: number;           // default 1080
}

export function generateAwardSVG(opts: GenerateAwardOptions): string {
  const size = opts.size || 1080;
  const cfg = AWARD_CONFIGS[opts.awardType] || AWARD_CONFIGS.top_producer;
  const firstName = opts.agentName.split(" ")[0].toUpperCase();
  const lastName = opts.agentName.split(" ").slice(1).join(" ").toUpperCase();

  // Rank display
  const rankDisplay = opts.rank === 1 ? "🥇" : opts.rank === 2 ? "🥈" : opts.rank === 3 ? "🥉" : opts.rank ? `#${opts.rank}` : "";

  return `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${cfg.bg1}"/>
      <stop offset="100%" style="stop-color:${cfg.bg2}"/>
    </linearGradient>
    <linearGradient id="accentGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" style="stop-color:${cfg.accent};stop-opacity:1"/>
      <stop offset="100%" style="stop-color:${cfg.accent};stop-opacity:0.4"/>
    </linearGradient>
    <linearGradient id="glowGrad" x1="50%" y1="0%" x2="50%" y2="100%">
      <stop offset="0%" style="stop-color:${cfg.accent};stop-opacity:0.15"/>
      <stop offset="100%" style="stop-color:${cfg.accent};stop-opacity:0"/>
    </linearGradient>
    <filter id="glow">
      <feGaussianBlur stdDeviation="8" result="coloredBlur"/>
      <feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <clipPath id="photoClip">
      <circle cx="${size/2}" cy="${size * 0.38}" r="${size * 0.18}"/>
    </clipPath>
  </defs>

  <!-- Background -->
  <rect width="${size}" height="${size}" fill="url(#bgGrad)"/>

  <!-- Ambient glow circle -->
  <circle cx="${size/2}" cy="${size * 0.4}" r="${size * 0.45}" fill="url(#glowGrad)"/>

  <!-- Top accent bar -->
  <rect x="0" y="0" width="${size}" height="${size * 0.008}" fill="url(#accentGrad)"/>

  <!-- Decorative corner lines -->
  <rect x="${size * 0.06}" y="${size * 0.06}" width="${size * 0.08}" height="2" fill="${cfg.accent}" opacity="0.4"/>
  <rect x="${size * 0.06}" y="${size * 0.06}" width="2" height="${size * 0.08}" fill="${cfg.accent}" opacity="0.4"/>
  <rect x="${size * 0.86}" y="${size * 0.06}" width="${size * 0.08}" height="2" fill="${cfg.accent}" opacity="0.4"/>
  <rect x="${size * 0.92}" y="${size * 0.06}" width="2" height="${size * 0.08}" fill="${cfg.accent}" opacity="0.4"/>
  <rect x="${size * 0.06}" y="${size * 0.86}" width="${size * 0.08}" height="2" fill="${cfg.accent}" opacity="0.4"/>
  <rect x="${size * 0.06}" y="${size * 0.86}" width="2" height="${size * 0.08}" fill="${cfg.accent}" opacity="0.4"/>
  <rect x="${size * 0.86}" y="${size * 0.86}" width="${size * 0.08}" height="2" fill="${cfg.accent}" opacity="0.4"/>
  <rect x="${size * 0.92}" y="${size * 0.86}" width="2" height="${size * 0.08}" fill="${cfg.accent}" opacity="0.4"/>

  <!-- APEX branding top -->
  <text x="${size/2}" y="${size * 0.1}" text-anchor="middle" font-family="'Syne', Arial Black, sans-serif" font-weight="800" font-size="${size * 0.022}" fill="${cfg.accent}" letter-spacing="${size * 0.008}">APEX FINANCIAL</text>

  <!-- Agent photo circle or emoji fallback -->
  ${opts.agentPhotoUrl
    ? `<circle cx="${size/2}" cy="${size * 0.38}" r="${size * 0.185}" fill="${cfg.accent}" opacity="0.2"/>
       <image href="${opts.agentPhotoUrl}" x="${size/2 - size * 0.18}" y="${size * 0.38 - size * 0.18}" width="${size * 0.36}" height="${size * 0.36}" clip-path="url(#photoClip)" preserveAspectRatio="xMidYMid slice"/>
       <circle cx="${size/2}" cy="${size * 0.38}" r="${size * 0.185}" fill="none" stroke="${cfg.accent}" stroke-width="3" opacity="0.6"/>`
    : `<circle cx="${size/2}" cy="${size * 0.38}" r="${size * 0.18}" fill="${cfg.accent}" opacity="0.08"/>
       <circle cx="${size/2}" cy="${size * 0.38}" r="${size * 0.18}" fill="none" stroke="${cfg.accent}" stroke-width="2" opacity="0.3"/>
       <text x="${size/2}" y="${size * 0.38 + size * 0.065}" text-anchor="middle" font-size="${size * 0.12}">${cfg.emoji}</text>`
  }

  <!-- Award badge pill -->
  <rect x="${size * 0.28}" y="${size * 0.585}" width="${size * 0.44}" height="${size * 0.055}" rx="${size * 0.027}" fill="${cfg.accent}" opacity="0.15"/>
  <rect x="${size * 0.28}" y="${size * 0.585}" width="${size * 0.44}" height="${size * 0.055}" rx="${size * 0.027}" fill="none" stroke="${cfg.accent}" stroke-width="1.5" opacity="0.4"/>
  <text x="${size/2}" y="${size * 0.622}" text-anchor="middle" font-family="'Syne', Arial Black, sans-serif" font-weight="700" font-size="${size * 0.024}" fill="${cfg.accent}" letter-spacing="${size * 0.005}">${cfg.label}</text>

  <!-- Agent name -->
  <text x="${size/2}" y="${size * 0.71}" text-anchor="middle" font-family="'Syne', Arial Black, sans-serif" font-weight="800" font-size="${size * 0.072}" fill="white" filter="url(#glow)">${firstName}</text>
  ${lastName ? `<text x="${size/2}" y="${size * 0.775}" text-anchor="middle" font-family="'Syne', Arial Black, sans-serif" font-weight="400" font-size="${size * 0.038}" fill="rgba(255,255,255,0.5)">${lastName}</text>` : ""}

  <!-- Divider line -->
  <rect x="${size * 0.3}" y="${size * 0.805}" width="${size * 0.4}" height="1" fill="${cfg.accent}" opacity="0.3"/>

  <!-- Stat value (the big number) -->
  <text x="${size/2}" y="${size * 0.875}" text-anchor="middle" font-family="'Syne', Arial Black, sans-serif" font-weight="800" font-size="${size * 0.06}" fill="${cfg.accent}" filter="url(#glow)">${opts.statValue}</text>

  <!-- Stat label -->
  <text x="${size/2}" y="${size * 0.918}" text-anchor="middle" font-family="'DM Sans', Arial, sans-serif" font-weight="300" font-size="${size * 0.022}" fill="rgba(255,255,255,0.45)" letter-spacing="2">${opts.statLabel.toUpperCase()}</text>

  <!-- Period label -->
  <text x="${size/2}" y="${size * 0.952}" text-anchor="middle" font-family="'DM Sans', Arial, sans-serif" font-weight="400" font-size="${size * 0.018}" fill="rgba(255,255,255,0.25)">${opts.periodLabel}</text>

  <!-- Rank display -->
  ${rankDisplay ? `<text x="${size/2}" y="${size * 0.15}" text-anchor="middle" font-size="${size * 0.05}">${rankDisplay}</text>` : ""}

  <!-- Bottom accent bar -->
  <rect x="0" y="${size - size * 0.008}" width="${size}" height="${size * 0.008}" fill="url(#accentGrad)"/>

  <!-- Website watermark -->
  <text x="${size/2}" y="${size * 0.99}" text-anchor="middle" font-family="'DM Sans', Arial, sans-serif" font-size="${size * 0.014}" fill="rgba(255,255,255,0.15)">apex-financial.org</text>
</svg>`;
}

// Convert SVG to PNG data URL using Canvas (browser only)
export async function svgToPngDataUrl(svgString: string, size = 1080): Promise<string> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) { reject(new Error("No canvas context")); return; }

    const img = new Image();
    const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    img.onload = () => {
      ctx.drawImage(img, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/png", 1.0));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("SVG load failed")); };
    img.src = url;
  });
}

// Download award as PNG
export async function downloadAward(opts: GenerateAwardOptions, filename?: string): Promise<void> {
  const svg = generateAwardSVG(opts);
  const png = await svgToPngDataUrl(svg, opts.size || 1080);
  const a = document.createElement("a");
  a.href = png;
  a.download = filename || `apex-award-${opts.agentName.replace(/\s+/g, "-").toLowerCase()}.png`;
  a.click();
}

// Get Instagram caption for award
export function getAwardCaption(opts: GenerateAwardOptions): string {
  const { agentName, awardType, statValue } = opts;
  const firstName = agentName.split(" ")[0];
  const captions: Record<AwardType, string> = {
    top_producer:      `🏆 ${agentName} is the TOP PRODUCER at APEX Financial with ${statValue}! This is what elite execution looks like. Ready to build like this? Apply → apex-financial.org/apply #APEXFinancial #TopProducer #InsuranceSales`,
    leaderboard:       `📊 ${agentName} is leading the leaderboard at APEX Financial — ${statValue}! The grind is real. #APEXFinancial #Leaderboard #Insurance`,
    first_deal:        `🎯 ${firstName} just closed their FIRST deal at APEX Financial! Every expert started exactly here. The journey begins. #APEXFinancial #FirstDeal #InsuranceSales`,
    top_producer_week: `🥇 ${agentName} is the WEEKLY CHAMPION at APEX Financial — ${statValue} this week! Consistency builds empires. #APEXFinancial #WeeklyChampion`,
    most_hires_week:   `👥 ${agentName} is the HIRING CHAMPION this week at APEX Financial! Building a team = multiplying your income. #APEXFinancial #Recruiting`,
    most_hires_month:  `🤝 ${agentName} is RECRUITER OF THE MONTH at APEX Financial! Leaders build leaders. #APEXFinancial #Leadership`,
    hot_streak:        `🔥 ${firstName} is on a HOT STREAK — ${statValue} consecutive days closing at APEX Financial! Don't break the chain. #APEXFinancial #HotStreak`,
    on_fire:           `🔥🔥 ${firstName} is literally ON FIRE — ${statValue} days straight closing deals at APEX Financial! This is what all-in looks like. #APEXFinancial #OnFire`,
    unstoppable:       `⚡ ${firstName} is UNSTOPPABLE — ${statValue} consecutive closing days at APEX Financial! 20 days. No days off. #APEXFinancial #Unstoppable`,
    diamond_week:      `💎 ${firstName} just had a DIAMOND WEEK at APEX Financial — ${statValue} ALP in 7 days! This is what $10K weeks look like. Apply → apex-financial.org/apply #APEXFinancial #DiamondWeek`,
    elite_producer:    `👑 ${agentName} is an ELITE PRODUCER at APEX Financial — ${statValue} this month! Ready to earn like this? apex-financial.org/apply #APEXFinancial #EliteProducer`,
    comeback:          `📈 ${firstName} just made a COMEBACK at APEX Financial — ${statValue}! Champions don't quit, they reload. #APEXFinancial #Comeback`,
  };
  return captions[awardType] || `🏆 ${agentName} just earned a major achievement at APEX Financial — ${statValue}! #APEXFinancial`;
}
