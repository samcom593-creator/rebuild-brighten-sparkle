// APEX global celebration layer.
// Subscribes to Supabase realtime on bot_alerts WHERE severity='celebrate'
// and fires confetti + sound + toast when a new row arrives. Mounts once
// at the authenticated shell level.

import { useEffect, useRef } from "react";
import confetti from "canvas-confetti";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSoundEffects } from "@/hooks/useSoundEffects";

type CelebrateRow = {
  id: string;
  subject: string;
  sms_body: string | null;
  event_type: string;
  created_at: string;
};

const EVENT_COLORS: Record<string, string[]> = {
  big_deal:         ["#ef4444", "#f59e0b", "#eab308"],
  first_deal:       ["#10b981", "#34d399", "#6ee7b7"],
  mtd_milestone:    ["#3b82f6", "#8b5cf6", "#ec4899"],
  streak_7day:      ["#f97316", "#ea580c", "#dc2626"],
  applicant_contracted: ["#14b8a6", "#06b6d4", "#3b82f6"],
  default:          ["#6366f1", "#8b5cf6", "#ec4899"],
};

function burstConfetti(eventType: string) {
  const colors = EVENT_COLORS[eventType] ?? EVENT_COLORS.default;
  const duration = 2500;
  const end = Date.now() + duration;

  (function frame() {
    confetti({
      particleCount: 6,
      angle: 60,
      spread: 70,
      origin: { x: 0, y: 0.6 },
      colors,
      disableForReducedMotion: true,
    });
    confetti({
      particleCount: 6,
      angle: 120,
      spread: 70,
      origin: { x: 1, y: 0.6 },
      colors,
      disableForReducedMotion: true,
    });
    if (Date.now() < end) requestAnimationFrame(frame);
  })();

  // Big finale blast in the middle
  setTimeout(() => {
    confetti({
      particleCount: 180,
      spread: 140,
      startVelocity: 45,
      origin: { x: 0.5, y: 0.4 },
      colors,
      disableForReducedMotion: true,
    });
  }, 400);
}

export function CelebrationProvider() {
  const { playSound } = useSoundEffects();
  const seenIds = useRef<Set<string>>(new Set());
  const armedAt = useRef<number>(Date.now());

  useEffect(() => {
    const channel = supabase
      .channel("apex-celebrations")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "bot_alerts", filter: "severity=eq.celebrate" },
        (payload) => {
          const row = payload.new as CelebrateRow;
          if (!row?.id || seenIds.current.has(row.id)) return;
          // Ignore rows that existed before we armed (avoids page-load blast)
          if (new Date(row.created_at).getTime() < armedAt.current - 5_000) return;
          seenIds.current.add(row.id);

          burstConfetti(row.event_type);
          playSound("celebrate");

          toast.success(row.subject, {
            description: row.sms_body ?? undefined,
            duration: 6_000,
          });
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [playSound]);

  return null;
}
