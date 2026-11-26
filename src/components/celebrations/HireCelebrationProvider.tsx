import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useRolePreview } from "@/hooks/useRolePreview";
import { playSoundEffect, getSoundReadiness, stopSoundEffects } from "@/lib/soundEngine";
import { isSoundEnabled, subscribeSoundPreference } from "@/lib/soundPreference";
import { isDemoMode, subscribeDemoMode } from "@/lib/demoMode";
import { DealCelebrationLedger, areDealCelebrationsSuppressed, subscribeDealCelebrationSuppression } from "@/lib/dealCelebrations";
import {
  addHireToBatch, canViewHire, HIRE_BATCH_DELAY_MS, HIRE_CELEBRATION_DURATION_MS, HIRE_CELEBRATION_GAP_MS,
  readRealtimeHire, type Hire, type HireCelebrationBatch,
} from "@/lib/hireCelebrations";
import { HireCelebration } from "./HireCelebration";

type ActiveBatch = HireCelebrationBatch & { userId: string; managerNames: Record<string, string> };

/**
 * One hire stream for the authenticated shell (MP-HIRE-CELEBRATION). Mirrors the
 * deal stream in CelebrationProvider: the same per-login ledger, aggregation
 * window, hidden-tab rule, demo/preview gates and the SAME suppression lease
 * (a screen that hides figures also hides names). Mounted by CelebrationProvider.
 */
export function HireCelebrationProvider() {
  const { user, isLoading, isAdmin, isManager } = useAuth();
  const { isPreviewing } = useRolePreview();
  const demoMode = useSyncExternalStore(subscribeDemoMode, isDemoMode, isDemoMode);
  const suppressed = useSyncExternalStore(subscribeDealCelebrationSuppression, areDealCelebrationsSuppressed, areDealCelebrationsSuppressed);
  const [active, setActive] = useState<ActiveBatch | null>(null);
  const sessionLedger = useRef<{ userId: string; ledger: DealCelebrationLedger } | null>(null);
  const userId = user?.id;

  useEffect(() => {
    setActive(null);
    if (!userId) sessionLedger.current = null;
    if (!userId || isLoading || isPreviewing || demoMode) { stopSoundEffects("fanfare"); return; }
    const armedAt = Date.now();
    if (sessionLedger.current?.userId !== userId) sessionLedger.current = { userId, ledger: new DealCelebrationLedger(armedAt) };
    const ledger = sessionLedger.current.ledger;
    let live = true;
    // The viewer's own agent row(s): a plain agent sees only the hires they recruited.
    let viewerAgentIds: ReadonlySet<string> = new Set<string>();
    let batch: HireCelebrationBatch | null = null;
    let batchMaySound = false;
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    let dismissTimer: ReturnType<typeof setTimeout> | undefined;
    let lastShownAt = -Infinity;
    let visibleSince = armedAt;

    const clearPending = () => {
      clearTimeout(flushTimer);
      clearTimeout(dismissTimer);
      flushTimer = undefined;
      batch = null;
      batchMaySound = false;
      setActive(null);
    };
    const managerNamesFor = async (hires: Hire[]): Promise<Record<string, string>> => {
      const ids = [...new Set(hires.flatMap((hire) => hire.managerIds))];
      if (ids.length === 0) return {};
      // A narrow read under the viewer's own RLS; a failed lookup just drops the
      // "Recruited by" chip, it never invents a name.
      const { data, error } = await supabase.from("agents").select("id, display_name").in("id", ids);
      if (error || !data) return {};
      const names: Record<string, string> = {};
      for (const row of data) if (typeof row.display_name === "string" && row.display_name.trim()) names[row.id] = row.display_name.trim();
      return names;
    };
    // Read through a call on purpose: the tab can go hidden DURING the awaited
    // name read below, and a bare property read would be narrowed to "visible"
    // by the first guard (TS2367 on the second check).
    const tabHidden = () => document.visibilityState === "hidden";
    const flush = async () => {
      flushTimer = undefined;
      if (!live || isDemoMode() || areDealCelebrationsSuppressed() || tabHidden() || !batch) { clearPending(); return; }
      const shown = batch;
      const maySound = batchMaySound;
      batch = null;
      batchMaySound = false;
      const managerNames = await managerNamesFor(shown.hires);
      if (!live || isDemoMode() || areDealCelebrationsSuppressed() || tabHidden()) return;
      setActive({ ...shown, userId, managerNames });
      lastShownAt = Date.now();
      // A pre-gesture or muted event stays silent even if audio is enabled during
      // the aggregation window. There is no sound backlog.
      if (maySound) playSoundEffect("fanfare");
      clearTimeout(dismissTimer);
      dismissTimer = setTimeout(() => setActive(null), HIRE_CELEBRATION_DURATION_MS);
    };
    const accept = (hire: Hire | null) => {
      if (!live || !hire) return;
      if (!canViewHire({ isAdmin, isManager, agentIds: viewerAgentIds }, hire)) return;
      if (!ledger.accept({ id: hire.id, postedAt: hire.hiredAt, annualPremium: null })) return;
      // Remember hidden-tab events, but do not replay them when the tab returns.
      if (isDemoMode() || areDealCelebrationsSuppressed() || document.visibilityState === "hidden" || hire.hiredAt < visibleSince) return;
      batch = addHireToBatch(batch, hire);
      batchMaySound ||= isSoundEnabled() && getSoundReadiness() === "ready";
      if (flushTimer === undefined) {
        flushTimer = setTimeout(() => { void flush(); }, Math.max(HIRE_BATCH_DELAY_MS, lastShownAt + HIRE_CELEBRATION_GAP_MS - Date.now()));
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") clearPending();
      else visibleSince = Date.now();
    };
    const unsubscribeSuppression = subscribeDealCelebrationSuppression(() => {
      if (areDealCelebrationsSuppressed()) { clearPending(); stopSoundEffects("fanfare"); }
      else visibleSince = Date.now();
    });
    const unsubscribePreference = subscribeSoundPreference(() => { if (!isSoundEnabled()) batchMaySound = false; });
    void supabase.from("agents").select("id").eq("user_id", userId).limit(5).then(({ data, error }) => {
      if (!live || error || !data) return;
      viewerAgentIds = new Set(data.map((row) => row.id));
    });
    // INSERT only, no server-side filter: hires are rare, and readRealtimeHire
    // applies the full predicate (active, not deactivated, not GHOST_, fresh).
    const channel = supabase.channel(`galaxy-hire-celebrations:${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "agents" }, (payload) => {
        accept(readRealtimeHire(payload, armedAt, Date.now()));
      }).subscribe();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      live = false;
      clearPending();
      stopSoundEffects("fanfare");
      unsubscribePreference();
      unsubscribeSuppression();
      document.removeEventListener("visibilitychange", onVisibility);
      void supabase.removeChannel(channel);
    };
  }, [userId, isLoading, isPreviewing, demoMode, isAdmin, isManager]);

  if (!active || active.userId !== userId || isPreviewing || isLoading || demoMode || suppressed) return null;
  return <HireCelebration key={active.key} batch={active} managerNames={active.managerNames} onDismiss={() => setActive(null)} />;
}
