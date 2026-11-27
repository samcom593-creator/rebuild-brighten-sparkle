import { forwardRef } from "react";
import { HandCoins, UserPlus } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import "./win-actions.css";

interface WinActionButtonProps extends Omit<ButtonProps, "children"> {
  kind: "deal" | "hire";
  compact?: boolean;
}

/** One accessible trigger style for the same two actions in the rail, mobile sheet and pages. */
export const WinActionButton = forwardRef<HTMLButtonElement, WinActionButtonProps>(
  ({ kind, compact = false, className, ...props }, ref) => {
    const label = kind === "hire" ? "Hire an Agent" : "Add a Deal";
    const Icon = kind === "hire" ? UserPlus : HandCoins;
    return (
      <Button
        ref={ref}
        type="button"
        variant="outline"
        aria-label={label}
        {...props}
        data-win-action={kind}
        className={cn("win-action h-11 gap-2 text-[15px]", compact && "win-action-compact", className)}
      >
        <span className="win-action-icon" aria-hidden="true">
          <Icon className={cn("h-4 w-4 shrink-0", kind === "hire" ? "text-tone-good" : "text-tone-gold")} />
        </span>
        {!compact && <span className="win-action-label">{label}</span>}
      </Button>
    );
  },
);
WinActionButton.displayName = "WinActionButton";
