import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, ChevronDown, ChevronUp, CheckCircle2, Rocket, Loader2 } from "lucide-react";
import type { ShippedItem } from "@/data/shipped-data";

/**
 * WhatShippedTodayBanner — pinned to the top of /dashboard so Sam sees
 * explicit proof of what changed.
 *
 * 2026-07-25: the SHIPPED array had grown to 261 entries / 722 KB of prose,
 * which made this component the single largest chunk on the site (710 KB) and
 * rendered every entry on load with a staggered animation — the last item was
 * delayed i*0.03 = 7.8s. On a dashboard that is supposed to feel instant.
 * The data now lives in ./shipped-data and is dynamically imported only when
 * the panel is opened, so the dashboard ships none of it.
 */

// Counted at split time from shipped-data.ts. Kept as a plain number so the
// header can render without pulling in the payload — importing the array to
// call .length would undo the 710 KB chunk split this file exists to preserve.
//
// wave-vault-source-parity 2026-08-07: the tradeoff is that this constant is
// hand-maintained, and it had silently drifted to 273 against 293 real entries
// — the banner told Sam "273 platform changes live" while under-reporting his
// own shipped work by 19. A hardcoded mirror of a number nobody re-derives is
// the same disease as every other stale metric on this platform, so
// check-metric-truth.mjs now recounts shipped-data.ts at commit time and fails
// if this number disagrees. Do not hand-bump it past the real count again;
// the guard prints the value to use.
const SHIPPED_TOTAL = 344;

// Newest entries render first; the rest stay behind an explicit action so a
// long history can never slow the first paint again.
const INITIAL_VISIBLE = 15;
const MAX_STAGGER_S = 0.24;

export function WhatShippedTodayBanner() {
  const [expanded, setExpanded] = useState(false);
  const [items, setItems] = useState<ShippedItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [failed, setFailed] = useState(false);

  const toggle = async () => {
    const next = !expanded;
    setExpanded(next);
    if (!next || items || loading) return;
    setLoading(true);
    setFailed(false);
    try {
      const mod = await import("@/data/shipped-data");
      setItems(mod.SHIPPED);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  const visible = items ? (showAll ? items : items.slice(0, INITIAL_VISIBLE)) : [];

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="relative overflow-hidden rounded-md border border-emerald-500/40 bg-white dark:bg-card p-4 sm:p-5 "
    >
      <div aria-hidden className="pointer-events-none absolute -top-12 -right-12 h-56 w-56 rounded-full bg-emerald-500/15 " />

      <button
        type="button"
        onClick={toggle}
        className="relative w-full flex items-center gap-3 text-left"
        aria-expanded={expanded}
      >
        <div className="h-10 w-10 rounded-full bg-white dark:bg-card flex items-center justify-center  flex-shrink-0">
          <Rocket className="h-5 w-5 text-zinc-950" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-300">
            <Sparkles className="h-3 w-3" /> Shipped — build receipts
          </div>
          <h2 className="text-base sm:text-lg font-bold text-foreground leading-tight">
            {SHIPPED_TOTAL} platform changes live
          </h2>
        </div>
        {loading
          ? <Loader2 className="h-5 w-5 text-muted-foreground animate-spin" />
          : expanded
            ? <ChevronUp className="h-5 w-5 text-muted-foreground" />
            : <ChevronDown className="h-5 w-5 text-muted-foreground" />}
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="relative mt-4 overflow-hidden"
          >
            {loading && (
              <p className="text-xs text-muted-foreground py-2">Loading receipts…</p>
            )}

            {failed && (
              <p className="text-xs text-amber-500 py-2">
                Couldn’t load the receipts. Close and reopen to retry.
              </p>
            )}

            {!loading && !failed && items && (
              <>
                <ul className="space-y-2">
                  {visible.map((item, i) => (
                    <motion.li
                      key={item.commit ?? `${item.ts}-${i}`}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: Math.min(i * 0.03, MAX_STAGGER_S) }}
                      className="flex items-start gap-3 rounded-md border border-emerald-500/15 bg-white dark:bg-card/40 px-3 py-2"
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
                </ul>

                {!showAll && items.length > INITIAL_VISIBLE && (
                  <button
                    type="button"
                    onClick={() => setShowAll(true)}
                    className="mt-3 text-xs font-semibold text-emerald-400 hover:text-emerald-300"
                  >
                    Show all {items.length} receipts
                  </button>
                )}
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
