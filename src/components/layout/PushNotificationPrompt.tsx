import { useState, useEffect } from "react";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { useAuth } from "@/hooks/useAuth";
import { Bell, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";

const PROMPTED_KEY = "apex_push_prompted";
const PROMPT_DELAY_MS = 5000; // Show after 5s

export function PushNotificationPrompt() {
  const { user } = useAuth();
  const { supported, permission, isSubscribed, subscribe, loading } = usePushNotifications();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!user || !supported) return;
    if (permission !== "default") return; // already asked
    if (isSubscribed) return;

    const prompted = localStorage.getItem(PROMPTED_KEY);
    if (prompted) {
      // Don't re-prompt within 7 days
      const days = (Date.now() - Number(prompted)) / (1000 * 60 * 60 * 24);
      if (days < 7) return;
    }

    const timer = setTimeout(() => setVisible(true), PROMPT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [user, supported, permission, isSubscribed]);

  const handleEnable = async () => {
    const ok = await subscribe();
    localStorage.setItem(PROMPTED_KEY, String(Date.now()));
    setVisible(false);
    if (ok) {
      toast.success("🔔 Push notifications enabled!");
    } else {
      toast.info("Push notifications were not enabled. You can turn them on in Settings.");
    }
  };

  const handleDismiss = () => {
    localStorage.setItem(PROMPTED_KEY, String(Date.now()));
    setVisible(false);
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: -20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -20, scale: 0.95 }}
          transition={{ type: "spring", stiffness: 300, damping: 25 }}
          className="fixed top-4 right-4 z-50 max-w-sm rounded-xl border border-primary/30 bg-card/95 backdrop-blur-md shadow-xl p-4"
        >
          <button
            onClick={handleDismiss}
            className="absolute top-2 right-2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Bell className="h-5 w-5 text-primary" />
            </div>
            <div className="space-y-2">
              <p className="text-sm font-semibold">Enable Push Notifications</p>
              <p className="text-xs text-muted-foreground">
                Get instant alerts for new leads, team updates, and deals — right on your device.
              </p>
              <Button size="sm" onClick={handleEnable} disabled={loading} className="w-full">
                {loading ? "Enabling..." : "Enable Notifications"}
              </Button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
