import { useEffect, useState } from "react";
import { BUSINESS_TZ } from "@/lib/calendarTime";
import { businessDateKey, msUntilNextBusinessMidnight, resolveZone } from "@/lib/businessClock";

/** Fired a little after midnight so one timer, not two, crosses the boundary. */
const AFTER_MIDNIGHT_CUSHION_MS = 250;

/**
 * Today's business date key ("YYYY-MM-DD") in the business zone, kept
 * current for the life of the component: it re-renders at the next midnight
 * in that zone (then re-arms for the one after), and re-checks whenever the
 * document becomes visible again, so a tab left open overnight or woken from
 * a sleeping laptop does not keep yesterday's key (F32).
 *
 * The default zone is calendarTime.BUSINESS_TZ (America/Phoenix). The legacy
 * Chicago dashboards pass dateUtils.BUSINESS_TIMEZONE explicitly.
 */
export function useBusinessToday(tz: string = BUSINESS_TZ): string {
  const zone = resolveZone(tz);
  const [todayKey, setTodayKey] = useState(() => businessDateKey(Date.now(), zone));

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    // Same value => React bails out, so a redundant sync never re-renders.
    const sync = () => setTodayKey(businessDateKey(Date.now(), zone));
    const arm = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        sync();
        arm();
      }, msUntilNextBusinessMidnight(Date.now(), zone) + AFTER_MIDNIGHT_CUSHION_MS);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        sync();
        arm();
      }
    };

    sync();
    arm();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [zone]);

  return todayKey;
}
