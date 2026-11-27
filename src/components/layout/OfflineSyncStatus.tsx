import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CloudOff, CloudUpload, Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useBrand } from "@/hooks/useBrand";
import { supabase } from "@/integrations/supabase/client";
import { invalidateOperationalTruth } from "@/lib/invalidateOperationalTruth";
import { announcePostedDealReceipt } from "@/lib/dealCelebrations";
import { readCoverageHold } from "@/lib/dealCoverageReview";
import {
  IN_PROGRESS_RETRY_MS,
  flushQueue,
  isParked,
  readQueueForUser,
  retryParkedDeals,
  subscribe,
  type QueuedEntry,
  type SendResult,
} from "@/lib/offlineQueue";

type DealSubmitResponse = { dealId?: string; status?: string; replayed?: boolean; ok?: boolean; reviewId?: string; reviewVersion?: number; matchCount?: number; idempotencyKey?: string } | null;

export async function sendQueuedEntry(entry: QueuedEntry): Promise<SendResult> {
  if (entry.kind !== "submit_apex_deal") {
    return { ok: false, error: `Unsupported queued operation: ${entry.kind}`, permanent: true };
  }
  const { data, error } = await (supabase.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: DealSubmitResponse; error: { message?: string; code?: string } | null }>)(
    "submit_apex_deal",
    entry.args,
  );
  // 55P03: the server's lock_timeout fired because another attempt for this key
  // holds its lock. Same meaning as in_progress: wait, keep the attempt.
  if (error?.code === "55P03") {
    return { ok: false, error: "An earlier attempt for this deal is still running on the server.", retryAfterMs: IN_PROGRESS_RETRY_MS };
  }
  if (error) return { ok: false, error: error.message || "Server rejected the queued deal." };
  const held = readCoverageHold(data);
  if (held) return { ok: false, permanent: true, error: held.status === "review_rejected"
    ? "Coverage review rejected this draft. Open Book of Business to review the decision; no deal was posted."
    : "Coverage review is required. Open Book of Business; no deal was posted." };
  // 2026-11-27: the server now refuses to run two attempts for one key at once
  // and answers {ok:false, status:'in_progress'} instead of queueing the second
  // behind the first until the statement timeout. That is "still saving", not a
  // failure: ask again after a short pause and burn no attempt.
  if (data && data.ok === false && data.status === "in_progress") {
    return { ok: false, error: "An earlier attempt for this deal is still running on the server.", retryAfterMs: IN_PROGRESS_RETRY_MS };
  }
  if (data?.dealId || data?.status === "already_recorded") {
    announcePostedDealReceipt(entry.ownerUserId, data);
    return { ok: true };
  }
  return { ok: false, error: "The server did not return a deal receipt." };
}

/**
 * One authenticated outbox monitor for the whole OS. It replays only the
 * current user's writes, only after connectivity returns, and removes nothing
 * until submit_apex_deal returns a durable receipt. The RPC's idempotency key
 * makes retries safe across reloads and uncertain network failures.
 */
export function OfflineSyncStatus() {
  const { user } = useAuth();
  const brand = useBrand();
  const queryClient = useQueryClient();
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine !== false);
  const [entries, setEntries] = useState<QueuedEntry[]>([]);
  const [syncing, setSyncing] = useState(false);
  const flushingRef = useRef(false);

  const refreshEntries = useCallback(() => {
    setEntries(user?.id ? readQueueForUser(user.id) : []);
  }, [user?.id]);

  // Timer and reconnect flushes respect each entry's backoff; a person pressing
  // "Sync now" does not have to wait it out (a key already in flight is still
  // never sent twice).
  const flushNow = useCallback(async (options?: { manual?: boolean }) => {
    if (!user?.id || flushingRef.current || (typeof navigator !== "undefined" && navigator.onLine === false)) return;
    flushingRef.current = true;
    setSyncing(true);
    try {
      const outcome = await flushQueue(sendQueuedEntry, user.id, { ignoreBackoff: Boolean(options?.manual) });
      refreshEntries();
      if (outcome.sent > 0) {
        invalidateOperationalTruth(queryClient);
        toast.success(`${outcome.sent} queued ${outcome.sent === 1 ? "deal" : "deals"} synced to ${brand.shortName}.`);
      }
    } finally {
      flushingRef.current = false;
      setSyncing(false);
    }
  }, [brand.shortName, queryClient, refreshEntries, user?.id]);

  useEffect(() => {
    refreshEntries();
    return subscribe(() => refreshEntries());
  }, [refreshEntries]);

  useEffect(() => {
    const handleOnline = () => {
      setOnline(true);
      void flushNow();
    };
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    if (navigator.onLine !== false) void flushNow();
    const interval = window.setInterval(() => {
      if (navigator.onLine !== false && readQueueForUser(user?.id ?? "").length > 0) void flushNow();
    }, 30_000);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.clearInterval(interval);
    };
  }, [flushNow, user?.id]);

  const parked = entries.filter(isParked).length;
  if (online && entries.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="mb-4 flex flex-col gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-2.5">
        {parked > 0 ? (
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        ) : online ? (
          <CloudUpload className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        ) : (
          <CloudOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        )}
        <div>
          <p className="font-semibold text-foreground">
            {parked > 0
              ? `${parked} ${parked === 1 ? "deal needs" : "deals need"} attention`
              : entries.length > 0
                ? `${entries.length} ${entries.length === 1 ? "deal is" : "deals are"} waiting to sync`
                : `${brand.shortName} is offline`}
          </p>
          <p className="text-xs text-muted-foreground">
            {parked > 0 ? "Saved deals need review or correction. They have not been posted by this device. Open coverage reviews, then retry only after the issue is resolved." : online
              ? `The server was busy or the connection dropped. ${brand.shortName} retries saved deals on its own, with a growing pause between tries. Nothing is counted twice.`
              : "Previously opened pages remain available. New deals are stored on this device and sent when internet returns."}
          </p>
        </div>
      </div>
      {parked > 0 && <div className="flex flex-wrap gap-2">
        <Button asChild type="button" size="sm" variant="outline"><Link to="/dashboard/production">Review saved deals</Link></Button>
        {online && <Button type="button" size="sm" variant="outline" disabled={syncing} onClick={() => {
          if (user?.id) retryParkedDeals(user.id);
          void flushNow({ manual: true });
        }}>{syncing ? "Checking…" : "Retry saved deals"}</Button>}
      </div>}
      {online && entries.length > 0 && parked < entries.length ? (
        <Button type="button" size="sm" variant="outline" className="h-10 shrink-0 gap-2" onClick={() => void flushNow({ manual: true })} disabled={syncing}>
          {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudUpload className="h-4 w-4" />}
          {syncing ? "Syncing…" : "Sync now"}
        </Button>
      ) : null}
    </div>
  );
}
