// FocusNow — one big card that shows Sam's #1 action right now.
// Reads bot_priorities.rank=1 for today. Subscribes to realtime so it
// flips the moment the 7am brief rewrites priorities. Dismissing
// stamps a "done" row in localStorage for the day so it doesn't re-show.

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Target, ExternalLink, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Priority = {
  id: string;
  for_date: string;
  rank: number;
  title: string;
  body: string | null;
  action_link: string | null;
  sub_bot: string | null;
};

const TODAY_ISO = () => new Date().toISOString().slice(0, 10);
// Per-rank dismissal so marking #1 done auto-promotes to #2, then #3.
const DISMISS_KEY = (rank: number) => `apex-focus-done-${TODAY_ISO()}-r${rank}`;

async function fetchNextPriority(): Promise<Priority | null> {
  const { data } = await supabase
    .from("bot_priorities")
    .select("id, for_date, rank, title, body, action_link, sub_bot")
    .eq("for_date", TODAY_ISO())
    .order("rank", { ascending: true });
  for (const p of (data ?? []) as Priority[]) {
    if (localStorage.getItem(DISMISS_KEY(p.rank)) !== "1") return p;
  }
  return null;
}

export function FocusNow() {
  const [priority, setPriority] = useState<Priority | null>(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      const p = await fetchNextPriority();
      if (!cancel) setPriority(p);
    })();
    return () => { cancel = true; };
  }, []);

  // Realtime: any bot_priorities change today → re-resolve the next visible item
  useEffect(() => {
    const ch = supabase
      .channel("apex-focus-now")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bot_priorities", filter: `for_date=eq.${TODAY_ISO()}` },
        async () => setPriority(await fetchNextPriority()),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  if (!priority) return null;

  const markDone = async () => {
    localStorage.setItem(DISMISS_KEY(priority.rank), "1");
    setPriority(await fetchNextPriority());
  };

  return (
    <AnimatePresence>
      <motion.div
        layout
        initial={{ opacity: 0, y: -8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96, y: -8 }}
        transition={{ type: "spring", stiffness: 200, damping: 22 }}
        className="relative overflow-hidden rounded-2xl border-2 border-primary/30 bg-gradient-to-br from-primary/10 via-background to-background shadow-lg mb-5 p-5"
      >
        {/* Animated corner glow */}
        <motion.div
          animate={{ opacity: [0.4, 0.65, 0.4] }}
          transition={{ duration: 2.6, repeat: Infinity }}
          className="absolute -top-12 -right-12 w-40 h-40 rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle, hsl(var(--primary)/0.28), transparent 70%)" }}
        />

        <div className="flex items-start gap-4 relative">
          <motion.div
            animate={{ rotate: [0, -3, 3, 0] }}
            transition={{ duration: 2.4, repeat: Infinity, repeatDelay: 1.2 }}
            className="w-11 h-11 rounded-xl bg-primary/15 text-primary flex items-center justify-center shrink-0"
          >
            <Target className="w-5 h-5" />
          </motion.div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-primary">
                FOCUS {priority.rank > 1 ? `#${priority.rank}` : "NOW"}
              </span>
              {priority.sub_bot && (
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  · {priority.sub_bot.replace(/_/g, " ")}
                </span>
              )}
            </div>
            <div className="text-base font-semibold leading-snug">
              {priority.title}
            </div>
            {priority.body && (
              <div className="text-sm text-muted-foreground mt-1">
                → {priority.body}
              </div>
            )}

            <div className="flex items-center gap-2 mt-3">
              {priority.action_link && (
                <a
                  href={priority.action_link}
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
                >
                  Open in APEX <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
              <button
                onClick={markDone}
                className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Mark focus item as done for today"
              >
                <Check className="w-3.5 h-3.5" />
                mark done
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
