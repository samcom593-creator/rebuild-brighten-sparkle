import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { useAuth } from "@/hooks/useAuth";
import { Bell, BellOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const NOT_NOW_KEY = "push_prompt_not_now_at";
const RE_PROMPT_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — don't nag

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
      if (elapsed < RE_PROMPT_MS) return; // Still within 24h cooldown
    }

    // Show after the page has settled (not an instant blocking pop).
    const timer = setTimeout(() => setVisible(true), 4000);
    return () => clearTimeout(timer);
  }, [user, supported, permission, isSubscribed, isVaManager, isVa, pathname]);

  const handleEnable = async () => {
    localStorage.removeItem(NOT_NOW_KEY);
    const ok = await subscribe();
    if (ok) {
      setVisible(false);
      toast.success("🔔 Push notifications enabled!");
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
    // Non-blocking corner card — does NOT cover the dashboard. Was a full-screen
    // inset-0 overlay that blocked the whole page on every load.
    <div className="animate-fade-in fixed bottom-4 right-4 z-[60] w-full max-w-sm">
      <div className="landing-scale-in w-full rounded-md border border-primary/30 bg-card shadow-2xl">
        {/* Header */}
        <div className="flex flex-col items-center gap-3 p-6 pb-2 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <Bell className="h-8 w-8 text-primary" />
          </div>
          <h2 className="text-xl font-bold text-foreground">
            Enable Push Notifications
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Get instant alerts for new leads, deal closings, team updates, and important reminders — right on your device.
          </p>
        </div>

        {/* Benefits */}
        <div className="px-6 py-3">
          <div className="space-y-2 rounded-md bg-muted/50 p-4">
            {[
              "📥 New lead assignments",
              "🔥 Deal alerts from your team",
              "📊 Production reminders",
              "🎉 Milestone celebrations",
            ].map((item) => (
              <div key={item} className="flex items-center gap-2 text-sm text-foreground">
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2 p-6 pt-3">
          <Button
            size="lg"
            onClick={handleEnable}
            disabled={loading}
            className="w-full text-base font-semibold"
          >
            {loading ? "Enabling..." : "🔔 Enable Notifications"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleNotNow}
            className="w-full text-muted-foreground hover:text-foreground"
          >
            <BellOff className="mr-2 h-4 w-4" />
            Not Now
          </Button>
        </div>
      </div>
    </div>
  );
}
