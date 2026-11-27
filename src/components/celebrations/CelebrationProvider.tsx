import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useRolePreview } from "@/hooks/useRolePreview";
import { useSoundSession } from "@/hooks/useSoundSession";
import { playSoundEffect, getSoundReadiness, stopSoundEffects } from "@/lib/soundEngine";
import { isSoundEnabled, subscribeSoundPreference } from "@/lib/soundPreference";
import { isDemoMode, subscribeDemoMode } from "@/lib/demoMode";
import {
  addDealToBatch, DealCelebrationLedger, DEAL_BATCH_DELAY_MS, DEAL_CELEBRATION_DURATION_MS,
  DEAL_CELEBRATION_GAP_MS, isDealId, POSTED_DEAL_RECEIPT_EVENT, readPostedDeal, readRealtimePostedDeal, readCelebrationAgentNames,
  areDealCelebrationsSuppressed, subscribeDealCelebrationSuppression,
  type DealCelebrationBatch, type LocalDealReceiptDetail, type PostedDeal,
} from "@/lib/dealCelebrations";
import { DealCelebration } from "./DealCelebration";

type ActiveBatch = DealCelebrationBatch & { userId: string; agentNames: Record<string, string> };

/** One authorized native-deal stream for the authenticated shell, independent of the current route. */
export function CelebrationProvider() {
  const { user, isLoading } = useAuth();
  const { isPreviewing } = useRolePreview();
  const demoMode = useSyncExternalStore(subscribeDemoMode, isDemoMode, isDemoMode);
  const suppressed = useSyncExternalStore(subscribeDealCelebrationSuppression, areDealCelebrationsSuppressed, areDealCelebrationsSuppressed);
  useSoundSession();
  const [active, setActive] = useState<ActiveBatch | null>(null);
  const sessionLedger = useRef<{ userId: string; ledger: DealCelebrationLedger } | null>(null);
  const userId = user?.id;

  useEffect(() => {
    setActive(null);
    if (!userId) sessionLedger.current = null;
    if (!userId || isLoading || isPreviewing || demoMode) { stopSoundEffects("deal"); return; }
    const armedAt = Date.now();
    if (sessionLedger.current?.userId !== userId) sessionLedger.current = { userId, ledger: new DealCelebrationLedger(armedAt) };
    const ledger = sessionLedger.current.ledger;
    const inFlight = new Set<string>();
    let live = true;
    let batch: DealCelebrationBatch | null = null;
    let batchMaySound = false;
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    let dismissTimer: ReturnType<typeof setTimeout> | undefined;
    let lastShownAt = -Infinity;
    let visibleSince = armedAt;
    let visibilityEpoch = 0;
    let suppressionEpoch = 0;

    const clearPending = () => {
      clearTimeout(flushTimer);
      clearTimeout(dismissTimer);
      flushTimer = undefined;
      batch = null;
      batchMaySound = false;
      setActive(null);
    };
    const flush = () => {
      flushTimer = undefined;
      if (!live || isDemoMode() || areDealCelebrationsSuppressed() || document.visibilityState === "hidden" || !batch) { clearPending(); return; }
      const shown = batch;
      setActive({ ...shown, userId, agentNames: {} });
      const agentIds = Object.keys(shown.agentCounts);
      if (agentIds.length > 0) {
        const nameVisibility = visibilityEpoch;
        const nameSuppression = suppressionEpoch;
        // A name lookup decorates this already-confirmed receipt. It never
        // delays, creates, or replays a win if the lookup fails or arrives late.
        void (async () => {
          try {
            const { data, error } = await supabase.from("agents").select("id, display_name").in("id", agentIds);
            if (error || !live || nameVisibility !== visibilityEpoch || nameSuppression !== suppressionEpoch
              || isDemoMode() || areDealCelebrationsSuppressed() || document.visibilityState === "hidden") return;
            const agentNames = readCelebrationAgentNames(data, agentIds);
            setActive((current) => current?.key === shown.key && current.userId === userId ? { ...current, agentNames } : current);
          } catch {
            // The saved deal remains valid when optional name resolution is unavailable.
            return;
          }
        })();
      }
      lastShownAt = Date.now();
      // A pre-gesture or muted event stays silent even if the person enables
      // audio during the tiny aggregation window. There is no sound backlog.
      if (batchMaySound) playSoundEffect("deal");
      batch = null;
      batchMaySound = false;
      clearTimeout(dismissTimer);
      dismissTimer = setTimeout(() => setActive(null), DEAL_CELEBRATION_DURATION_MS);
    };
    const accept = (deal: PostedDeal | null) => {
      if (!live || !deal || !ledger.accept(deal)) return;
      // Remember hidden-tab events, but do not replay them when the tab returns.
      if (isDemoMode() || areDealCelebrationsSuppressed() || document.visibilityState === "hidden" || deal.postedAt < visibleSince) return;
      batch = addDealToBatch(batch, deal);
      batchMaySound ||= isSoundEnabled() && getSoundReadiness() === "ready";
      if (flushTimer === undefined) {
        flushTimer = setTimeout(flush, Math.max(DEAL_BATCH_DELAY_MS, lastShownAt + DEAL_CELEBRATION_GAP_MS - Date.now()));
      }
    };
    const onLocalReceipt = async (event: Event) => {
      const detail = (event as CustomEvent<LocalDealReceiptDetail>).detail;
      if (!detail || detail.userId !== userId || !isDealId(detail.dealId) || ledger.has(detail.dealId) || inFlight.has(detail.dealId)) return;
      if (isDemoMode() || areDealCelebrationsSuppressed() || document.visibilityState === "hidden") {
        // No read/amount claim while hidden. Consume the receipt ID so it
        // cannot be replayed when this screen becomes visible again.
        ledger.accept({ id: detail.dealId, postedAt: Date.now(), annualPremium: null });
        return;
      }
      const receiptVisibility = visibilityEpoch;
      const receiptSuppression = suppressionEpoch;
      inFlight.add(detail.dealId);
      try {
        // The receipt supplies no money/name/source claims. This narrow read
        // enforces the same current authorization as the book and realtime.
        const { data, error } = await supabase.from("deals")
          .select("id, source, status, posted_at, created_at, annual_premium, agent_id")
          .eq("id", detail.dealId).maybeSingle();
        if (!error && live) {
          const deal = readPostedDeal(data, armedAt, Date.now(), true);
          if (receiptVisibility === visibilityEpoch && receiptSuppression === suppressionEpoch) accept(deal);
          else if (deal) ledger.accept(deal);
        }
      } catch {
        // Optional feedback: the deal was already saved. A transport failure
        // must not turn that successful write into a retry or a fake receipt.
        return;
      } finally {
        inFlight.delete(detail.dealId);
      }
    };
    const onVisibility = () => {
      visibilityEpoch += 1;
      if (document.visibilityState === "hidden") clearPending();
      else visibleSince = Date.now();
    };
    const unsubscribeSuppression = subscribeDealCelebrationSuppression(() => {
      suppressionEpoch += 1;
      if (areDealCelebrationsSuppressed()) { clearPending(); stopSoundEffects("deal"); }
      else visibleSince = Date.now();
    });
    const unsubscribePreference = subscribeSoundPreference(() => { if (!isSoundEnabled()) batchMaySound = false; });
    const channel = supabase.channel(`galaxy-deal-celebrations:${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "deals", filter: "source=eq.apex_native" }, (payload) => {
        accept(readRealtimePostedDeal(payload, armedAt, Date.now()));
      }).subscribe();
    window.addEventListener(POSTED_DEAL_RECEIPT_EVENT, onLocalReceipt);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      live = false;
      clearPending();
      stopSoundEffects("deal");
      inFlight.clear();
      unsubscribePreference();
      unsubscribeSuppression();
      window.removeEventListener(POSTED_DEAL_RECEIPT_EVENT, onLocalReceipt);
      document.removeEventListener("visibilitychange", onVisibility);
      void supabase.removeChannel(channel);
    };
  }, [userId, isLoading, isPreviewing, demoMode]);

  if (!active || active.userId !== userId || isPreviewing || isLoading || demoMode || suppressed) return null;
  return <DealCelebration key={active.key} batch={active} agentNames={active.agentNames} onDismiss={() => setActive(null)} />;
}
