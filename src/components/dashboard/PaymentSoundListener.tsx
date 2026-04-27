import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useSoundEffects } from "@/hooks/useSoundEffects";

/**
 * Global listener — subscribes to inserts on public.offer_purchases and
 * fires a celebrate sound + a toast every time a new paid offer lands.
 *
 * Mounted once in App.tsx so it works across every dashboard page Sam may
 * have open. No-op for non-admin/non-manager users (RLS would block them
 * from seeing the row anyway, but we skip the channel to save bandwidth).
 *
 * Per-tab opt-out: localStorage["apex_payment_sound_enabled"] = "false".
 */
export function PaymentSoundListener() {
  const { isAdmin, isManager } = useAuth();
  const { playSound } = useSoundEffects();
  const seenIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!isAdmin && !isManager) return;
    let enabled = true;
    try { enabled = localStorage.getItem("apex_payment_sound_enabled") !== "false"; } catch {}

    const channel = supabase
      .channel("payment-sound-listener")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "offer_purchases" },
        (payload: any) => {
          const row = payload?.new;
          if (!row?.id || seenIds.current.has(row.id)) return;
          seenIds.current.add(row.id);
          if (row.status !== "paid") return;

          const dollars = Math.round((row.amount_cents || 0) / 100);
          const skuName = row.package_name || row.sku || "offer";
          if (enabled) playSound("celebrate");
          toast.success(`💰 +$${dollars.toLocaleString()} — ${skuName}`, {
            description: row.purchaser_email || row.purchaser_name || "new subscriber",
            duration: 8000,
          });
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [isAdmin, isManager, playSound]);

  return null;
}
