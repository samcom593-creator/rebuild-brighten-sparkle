import { useState, useEffect } from "react";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { useAuth } from "@/hooks/useAuth";
import { Bell, BellOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";

const NOT_NOW_KEY = "push_prompt_not_now_at";
const RE_PROMPT_MS = 24 * 60 * 60 * 1000; // 24 hours

export function PushNotificationPrompt() {
  const { user } = useAuth();
  const { supported, permission, isSubscribed, subscribe, loading } = usePushNotifications();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!user || !supported) return;
    // Already granted/denied or subscribed — don't show
    if (permission === "granted" && isSubscribed) return;
    if (permission === "denied") return;

    // Check "Not Now" timestamp
    const notNowAt = localStorage.getItem(NOT_NOW_KEY);
    if (notNowAt) {
      const elapsed = Date.now() - parseInt(notNowAt, 10);
      if (elapsed < RE_PROMPT_MS) return; // Still within 24h cooldown
    }

    // Show immediately (small delay for page load)
    const timer = setTimeout(() => setVisible(true), 1500);
    return () => clearTimeout(timer);
  }, [user, supported, permission, isSubscribed]);

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

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
            className="mx-4 w-full max-w-md rounded-2xl border border-primary/30 bg-card shadow-2xl"
          >
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
              <div className="space-y-2 rounded-xl bg-muted/50 p-4">
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
                Not Now (ask again in 24h)
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
