import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { filterActionableNotifications } from "@/lib/notificationFilters";

/**
 * Realtime hook returning the unread notification count for the current user.
 * Listens to inserts on `notification_log` filtered by recipient_user_id.
 */
export function useUnreadNotifications() {
  const { user } = useAuth();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!user?.id) {
      setCount(0);
      return;
    }

    let cancelled = false;

    const fetchCount = async () => {
      const { data } = await supabase
        .from("notification_log")
        .select("id, title, subject, body, message, error_message, notification_type, status")
        .eq("recipient_user_id", user.id)
        .is("opened_at", null)
        .in("status", ["sent", "delivered"])
        .limit(200);
      if (!cancelled) setCount(filterActionableNotifications((data ?? []) as Record<string, unknown>[]).length);
    };

    fetchCount();

    const channel = supabase
      .channel(`unread-notifs-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notification_log",
          filter: `recipient_user_id=eq.${user.id}`,
        },
        () => fetchCount()
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  return count;
}
