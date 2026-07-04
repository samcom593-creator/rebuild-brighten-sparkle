import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";

const KEY = "apex-v3-welcome-seen";
const VERSION = "v3";

// WelcomeToast fires once per user, on first authenticated load after the v3
// visual overhaul. Saved in localStorage so it doesn't spam. Resets if VERSION
// changes so future overhauls can re-announce.
export function WelcomeToast() {
  const navigate = useNavigate();
  useEffect(() => {
    let cancelled = false;
    const seen = localStorage.getItem(KEY);
    if (seen === VERSION) return;
    const t = setTimeout(() => {
      if (cancelled) return;
      toast(
        <span className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span>
            <strong className="font-semibold">Apex v3 just landed.</strong>{" "}
            <span className="text-muted-foreground">
              Aurora background, real-time conduct center, strikes + charges audit.
            </span>
          </span>
        </span>,
        {
          duration: 9000,
          action: {
            label: "Open",
            onClick: () => {
              navigate("/dashboard/strikes");
            },
          },
        },
      );
      localStorage.setItem(KEY, VERSION);
    }, 1400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [navigate]);

  return null;
}
