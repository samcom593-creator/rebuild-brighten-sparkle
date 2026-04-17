import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * Hook for hiding/showing dashboard cards.
 * Backed by `user_dashboard_prefs.hidden_cards` (text[]).
 *
 * Cards are identified by stable string keys (e.g. "admin.manager-capacity").
 * Use a namespaced convention: <page>.<card> so keys never collide.
 */
export function useHiddenCards() {
  const { user } = useAuth();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);

  // Load on mount / user change
  useEffect(() => {
    if (!user?.id) {
      setHidden(new Set());
      setLoaded(true);
      return;
    }
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from("user_dashboard_prefs")
        .select("hidden_cards")
        .eq("user_id", user.id)
        .maybeSingle();

      if (cancelled) return;
      if (error) {
        console.error("[useHiddenCards] load failed", error);
      }
      setHidden(new Set(data?.hidden_cards ?? []));
      setLoaded(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const persist = useCallback(
    async (next: Set<string>) => {
      if (!user?.id) return;
      const arr = Array.from(next);
      const { error } = await supabase
        .from("user_dashboard_prefs")
        .upsert(
          { user_id: user.id, hidden_cards: arr },
          { onConflict: "user_id" }
        );
      if (error) console.error("[useHiddenCards] persist failed", error);
    },
    [user?.id]
  );

  const isHidden = useCallback((key: string) => hidden.has(key), [hidden]);

  const hide = useCallback(
    (key: string) => {
      setHidden((prev) => {
        if (prev.has(key)) return prev;
        const next = new Set(prev);
        next.add(key);
        void persist(next);
        return next;
      });
    },
    [persist]
  );

  const show = useCallback(
    (key: string) => {
      setHidden((prev) => {
        if (!prev.has(key)) return prev;
        const next = new Set(prev);
        next.delete(key);
        void persist(next);
        return next;
      });
    },
    [persist]
  );

  const showAll = useCallback(() => {
    setHidden((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set<string>();
      void persist(next);
      return next;
    });
  }, [persist]);

  return { isHidden, hide, show, showAll, hiddenCount: hidden.size, loaded };
}
