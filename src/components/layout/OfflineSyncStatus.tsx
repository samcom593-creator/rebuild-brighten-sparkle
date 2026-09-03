import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CloudOff, CloudUpload, Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useBrand } from "@/hooks/useBrand";
import { supabase } from "@/integrations/supabase/client";
import { invalidateOperationalTruth } from "@/lib/invalidateOperationalTruth";
import {
  flushQueue,
  isParked,
  readQueueForUser,
  subscribe,
  type QueuedEntry,
  type SendResult,
} from "@/lib/offlineQueue";

type DealSubmitResponse = { dealId?: string; status?: string } | null;

async function sendQueuedEntry(entry: QueuedEntry): Promise<SendResult> {
  if (entry.kind !== "submit_apex_deal") {
    return { ok: false, error: `Unsupported queued operation: ${entry.kind}`, permanent: true };
  }
  const { data, error } = await (supabase.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: DealSubmitResponse; error: { message?: string } | null }>)(
    "submit_apex_deal",
    entry.args,
  );
  if (error) return { ok: false, error: error.message || "Server rejected the queued deal." };
  if (data?.dealId || data?.status === "already_recorded") return { ok: true };
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

  const flushNow = useCallback(async () => {
    if (!user?.id || flushingRef.current || (typeof navigator !== "undefined" && navigator.onLine === false)) return;
    flushingRef.current = true;
    setSyncing(true);
    try {
      const outcome = await flushQueue(sendQueuedEntry, user.id);
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
            {online
              ? `${brand.shortName} is reconnecting to the canonical deal ledger. Nothing is counted twice.`
              : "Previously opened pages remain available. New deals are stored on this device and sent when internet returns."}
          </p>
        </div>
      </div>
      {online && entries.length > 0 && parked < entries.length ? (
        <Button type="button" size="sm" variant="outline" className="h-10 shrink-0 gap-2" onClick={() => void flushNow()} disabled={syncing}>
          {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudUpload className="h-4 w-4" />}
          {syncing ? "Syncing…" : "Sync now"}
        </Button>
      ) : null}
    </div>
  );
}
