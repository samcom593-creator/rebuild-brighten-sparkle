import { ReactNode } from "react";
import { EyeOff } from "lucide-react";
import { useHiddenCards } from "@/hooks/useHiddenCards";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface HideableCardProps {
  /** Stable key, e.g. "admin.manager-capacity" */
  cardKey: string;
  /** Friendly label used in the toast and unhide list */
  label: string;
  children: ReactNode;
  /** Optional className applied to the wrapper div */
  className?: string;
}

/**
 * Wraps a dashboard card and adds a small "hide" affordance.
 * If the card is hidden by the current user, renders nothing.
 *
 * The hide button appears in the top-right on hover (always on touch).
 * Use `HiddenCardsManager` to let users restore hidden cards.
 */
export function HideableCard({
  cardKey,
  label,
  children,
  className,
}: HideableCardProps) {
  const { isHidden, hide, show } = useHiddenCards();

  if (isHidden(cardKey)) return null;

  return (
    <div className={`group/hideable relative ${className ?? ""}`}>
      <Button
        variant="ghost"
        size="icon"
        type="button"
        aria-label={`Hide ${label}`}
        onClick={(e) => {
          e.stopPropagation();
          hide(cardKey);
          toast.success(`Hidden: ${label}`, {
            action: {
              label: "Undo",
              onClick: () => show(cardKey),
            },
          });
        }}
        className="absolute top-2 right-2 z-10 h-7 w-7 opacity-0 group-hover/hideable:opacity-100 focus:opacity-100 transition-opacity bg-background/60 hover:bg-background/90 backdrop-blur-sm"
      >
        <EyeOff className="h-3.5 w-3.5" />
      </Button>
      {children}
    </div>
  );
}
