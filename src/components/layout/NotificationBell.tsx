import { Bell } from "lucide-react";
import { Link } from "react-router-dom";
import { useUnreadNotifications } from "@/hooks/useUnreadNotifications";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

interface NotificationBellProps {
  collapsed?: boolean;
  className?: string;
}

/**
 * Bell icon with realtime unread badge. Routes to the inbox the current
 * role can actually open — /dashboard/inbox is admin-only and used to send
 * managers/agents into an access-denied page.
 */
export function NotificationBell({ collapsed, className }: NotificationBellProps) {
  const count = useUnreadNotifications();
  const { isAdmin } = useAuth();
  const display = count > 99 ? "99+" : String(count);
  const target = isAdmin ? "/dashboard/inbox" : "/dashboard/notifications/mine";

  return (
    <Link
      to={target}
      aria-label={`Inbox (${count} unread)`}
      className={cn(
        "relative inline-flex items-center justify-center rounded-lg transition-colors hover:bg-accent",
        collapsed ? "h-9 w-9" : "h-9 w-9",
        className
      )}
    >
      <Bell className="h-4 w-4" />
      {count > 0 && (
        <span
          className={cn(
            "absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full",
            "bg-destructive text-destructive-foreground text-[10px] font-bold",
            "flex items-center justify-center border border-background",
            "animate-in zoom-in-50"
          )}
        >
          {display}
        </span>
      )}
    </Link>
  );
}
