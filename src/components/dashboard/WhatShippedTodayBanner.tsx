import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, ChevronDown, ChevronUp, CheckCircle2, Rocket } from "lucide-react";

/**
 * WhatShippedTodayBanner — pinned to the very top of /dashboard so Sam
 * (and any admin reloading) sees explicit proof of what changed today
 * vs yesterday. Updates by editing the SHIPPED array on each commit.
 *
 * Why this exists: Sam reported on 2026-05-19 "everything still looks
 * the exact same as yesterday" despite 24+ commits shipping in 24h.
 * Browser cache + Vercel propagation hide most changes. This banner
 * makes the delta unmissable. Collapsible so it doesn't dominate the
 * page after he's read it.
 */

interface ShippedItem {
  ts: string;       // human readable
  label: string;
  detail: string;
  commit?: string;
}

// 2026-05-18 / 2026-05-19 receipts. Most-recent first. Update this on
// every meaningful ship so the dashboard always shows the latest delta.
const SHIPPED: ShippedItem[] = [
  {
    ts: "today",
    label: "Landing performance trimmed",
    detail: "Public home no longer pulls Framer Motion for the hero, nav, live counters, recent hires, or landing sections. CSS keyframes keep the polish while the motion runtime stays off the first-load path, with vendor chunks grouped tighter.",
  },
  {
    ts: "today",
    label: "Apply continue fixed + duplicate referral removed",
    detail: "Apply is back to 4 steps: agent credit is captured before submit, Continue Application routes straight to the success page, and manual referrers persist without a second referral screen.",
  },
  {
    ts: "today",
    label: "Apply submission unblocked",
    detail: "Applicants were stuck on step 5 with a red toast. Treat ALREADY_CLAIMED as success — they now land on /apply/success cleanly.",
    commit: "5e11e11e",
  },
  {
    ts: "today",
    label: "Unclaimed Leads card + XCEL Stalled card",
    detail: "319 status='new' applicants + 22 stalled pre-licensing students now live above this banner. One-tap Claim button.",
    commit: "b8324f4a",
  },
  {
    ts: "today",
    label: "SocialMediaBot crash fixed",
    detail: "21 React #31 crashes in 24h from passing icon components into ReactNode slots. All 5 EmptyState calls patched.",
    commit: "b0158068",
  },
  {
    ts: "today",
    label: "Live trust ribbon on /apply",
    detail: "Emerald-pulse ribbon at the top: '22 carriers · 95 active agents · Sam reviews every application'. White-shimmer skeleton killed too.",
    commit: "a79ee8f7",
  },
  {
    ts: "today",
    label: "Live counter strip on landing",
    detail: "3 animated count-up tiles below the public hero — Active agents · Apps · Carrier partners.",
    commit: "eb3594a9",
  },
  {
    ts: "yesterday",
    label: "Operating-system audit + 3 DB moves",
    detail: "v_xcel_pipeline view created (was missing — runtime-errored every load). Auto-advance trigger fixed 10 stuck licensed applicants. v_unclaimed_new_apps view + claim RPC.",
    commit: "ca3034d4",
  },
  {
    ts: "yesterday",
    label: "Tier-4 visible fixes",
    detail: "Killed white VSL screen, producing-agents 30d→10d, Activity+Referrals widget removed, Agency Command top widget rebuilt with gradient + amber-pulse live badge (no more green-on-green).",
    commit: "88c04ada",
  },
  {
    ts: "yesterday",
    label: "Tier-1/2/3 punch-list",
    detail: "License gate /schedule-call, IG Growth Buy CTA, Gold/Platinum auth-redirect, Sam-James name unify, Watch-demo gone, sidebar surgery (Conduct/Strikes/Accounts/Purchase Leads removed), Agent Pipeline → Client Pipeline rename, Notifications to bottom, Login white-bg killed.",
    commit: "0fdde41d",
  },
];

export function WhatShippedTodayBanner() {
  const [expanded, setExpanded] = useState(true);

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="relative overflow-hidden rounded-2xl border border-emerald-500/40 bg-gradient-to-br from-emerald-500/12 via-primary/5 to-transparent p-4 sm:p-5 shadow-[0_0_60px_hsl(168_80%_50%/0.12)]"
    >
      <div aria-hidden className="pointer-events-none absolute -top-12 -right-12 h-56 w-56 rounded-full bg-emerald-500/15 blur-3xl" />

      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="relative w-full flex items-center gap-3 text-left"
        aria-expanded={expanded}
      >
        <div className="h-10 w-10 rounded-full bg-gradient-to-br from-emerald-400 to-primary flex items-center justify-center shadow-[0_0_30px_hsl(168_80%_50%/0.4)] flex-shrink-0">
          <Rocket className="h-5 w-5 text-zinc-950" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-300">
            <Sparkles className="h-3 w-3" /> Shipped — receipts since you logged in last
          </div>
          <h2 className="text-base sm:text-lg font-bold text-foreground leading-tight">
            {SHIPPED.length} platform changes live · {SHIPPED.filter(s => s.ts === "today").length} pushed today
          </h2>
        </div>
        {expanded ? <ChevronUp className="h-5 w-5 text-muted-foreground" /> : <ChevronDown className="h-5 w-5 text-muted-foreground" />}
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.ul
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="relative mt-4 space-y-2 overflow-hidden"
          >
            {SHIPPED.map((item, i) => (
              <motion.li
                key={item.commit ?? i}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.03 }}
                className="flex items-start gap-3 rounded-xl border border-emerald-500/15 bg-zinc-900/40 px-3 py-2"
              >
                <CheckCircle2 className="h-4 w-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-foreground">{item.label}</span>
                    <span className="text-[10px] uppercase tracking-wider text-emerald-300/80">{item.ts}</span>
                    {item.commit && (
                      <a
                        href={`https://github.com/samcom593-creator/rebuild-brighten-sparkle/commit/${item.commit}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[10px] font-mono text-muted-foreground hover:text-foreground"
                      >
                        {item.commit}
                      </a>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground leading-snug mt-0.5">{item.detail}</p>
                </div>
              </motion.li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
