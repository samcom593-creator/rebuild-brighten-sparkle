import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Phone, X, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";

export function PhonePromptBanner() {
  const { profile, isManager, isAdmin } = useAuth();
  const [isDismissed, setIsDismissed] = useState(false);

  // Only show for managers/admins without a phone number
  const shouldShow = (isManager || isAdmin) && profile && !profile.phone && !isDismissed;

  // Check localStorage for dismissed state
  useEffect(() => {
    const dismissed = localStorage.getItem("apex-phone-banner-dismissed");
    if (dismissed) {
      setIsDismissed(true);
    }
  }, []);

  const handleDismiss = () => {
    setIsDismissed(true);
    localStorage.setItem("apex-phone-banner-dismissed", "true");
  };

  if (!shouldShow) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        className="mb-6 relative overflow-hidden rounded-xl bg-gradient-to-r from-amber-500/20 via-amber-500/10 to-transparent border border-amber-500/30"
      >
        <div className="flex items-center justify-between p-4">
          <div className="flex items-center gap-4">
            <div className="p-2 rounded-full bg-amber-500/20">
              <Phone className="h-5 w-5 text-amber-400" />
            </div>
            <div>
              <p className="font-medium text-amber-200">
                Add your phone number so recruits can reach you!
              </p>
              <p className="text-sm text-amber-300/70">
                Your contact info is included in emails sent to applicants who use your referral link.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/dashboard/settings">
              <Button size="sm" className="bg-amber-500 hover:bg-amber-600 text-black">
                Add Phone
                <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </Link>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleDismiss}
              className="text-amber-400 hover:text-amber-300 hover:bg-amber-500/10"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
