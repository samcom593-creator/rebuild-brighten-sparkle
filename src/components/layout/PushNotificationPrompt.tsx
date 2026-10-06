import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { useAuth } from "@/hooks/useAuth";
import { Bell, BellOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const NOT_NOW_KEY = "push_prompt_not_now_at";
const RE_PROMPT_MS = 7 * 24 * 60 * 60 * 1000; // one ask per week, not per day // 7 days — don't nag

// Surfaces that exist to be screenshotted/presented — a modal over them ruins
// the capture, so the prompt never renders there.
const CAPTURE_SURFACES = ["/board"];

export function PushNotificationPrompt() {
  const { pathname } = useLocation();
  const { user, isVaManager, isVa } = useAuth();
  const { supported, permission, isSubscribed, subscribe, loading } = usePushNotifications();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // VA managers + VAs are back-office operators — the lead/deal/production
    // push prompt is irrelevant to them, so we never block their portal with it.
    if (!user || !supported || isVaManager || isVa) return;
    // Never cover a capture surface (the live production board gets posted).
    // Actively close it too, in case it was already open before navigating here.
    if (CAPTURE_SURFACES.some((r) => pathname.startsWith(r))) {
      setVisible(false);
      return;
    }
    // Already granted/denied or subscribed — don't show
    if (permission === "granted" && isSubscribed) return;
    if (permission === "denied") return;

    // Check "Not Now" timestamp
    const notNowAt = localStorage.getItem(NOT_NOW_KEY);
    if (notNowAt) {
      const elapsed = Date.now() - parseInt(notNowAt, 10);
      if (elapsed < RE_PROMPT_MS) return; // Still within the 7-day cooldown
    }

    // Home dashboard only: the 2026-08-20 UI audit saw this fire on all 9
    // routes it visited in one session, covering page CTAs bottom-right. One
    // surface is enough to ask on; the Settings page keeps the manual toggle.
    if (pathname !== "/dashboard") return;
    // Show after the page has settled (not an instant blocking pop).
    const timer = setTimeout(() => setVisible(true), 4000);
    return () => clearTimeout(timer);
  }, [user, supported, permission, isSubscribed, isVaManager, isVa, pathname]);

  const handleEnable = async () => {
    localStorage.removeItem(NOT_NOW_KEY);
    const ok = await subscribe();
    if (ok) {
      setVisible(false);
      toast.success("Alerts are on for this device.");
    } else {
      toast.info("Push notifications were not enabled. You can try again later.");
    }
  };

  const handleNotNow = () => {
    localStorage.setItem(NOT_NOW_KEY, Date.now().toString());
    setVisible(false);
  };

  if (!visible) return null;

  return (
    // One compact line in the corner: asking for permission should never cover the dashboard.
    <div className="animate-fade-in fixed bottom-4 right-4 z-40 w-[calc(100%-2rem)] max-w-sm" role="dialog" aria-label="Turn on device alerts">
      <div className="flex items-center gap-3 rounded-md border border-border bg-card p-3 shadow-lg">
        <Bell className="h-4 w-4 shrink-0 text-primary" aria-hidden />
        <p className="min-w-0 flex-1 text-sm text-foreground">Get deal and lead alerts on this device.</p>
        <Button size="sm" onClick={handleEnable} disabled={loading} className="h-8 shrink-0">
          {loading ? "Turning on…" : "Turn on"}
        </Button>
        <Button variant="ghost" size="sm" onClick={handleNotNow} className="h-8 shrink-0 text-muted-foreground" aria-label="Not now">
          <BellOff className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}
