import { Calculator, History, Shield, ArrowLeft, Crown } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

const navItems = [
  { icon: Calculator, label: "Quote", href: "/quote-engine" },
  { icon: History, label: "Saved Quotes", href: "/quote-engine/history" },
];

export function QuoteEngineSidebar() {
  const { isAdmin } = useAuth();

  return (
    <aside className="h-screen w-56 flex-shrink-0 border-r border-border bg-card flex flex-col">
      {/* Branding */}
      <div className="p-4 border-b border-border flex items-center gap-2">
        <div className="p-1.5 rounded-md bg-primary/10">
          <Calculator className="h-5 w-5 text-primary" />
        </div>
        <div className="leading-tight">
          <p className="text-sm font-bold text-foreground flex items-center gap-1">
            Quote Engine <Crown className="h-3 w-3 text-primary" />
          </p>
          <p className="text-[10px] text-muted-foreground">Apex Underwriting</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-2 space-y-0.5">
        {navItems.map((item) => (
          <NavLink
            key={item.href}
            to={item.href}
            end
            className="flex items-center gap-2.5 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted/50 transition-colors"
            activeClassName="bg-primary/10 text-primary font-medium"
          >
            <item.icon className="h-4 w-4" />
            <span>{item.label}</span>
          </NavLink>
        ))}

        {isAdmin && (
          <NavLink
            to="/quote-engine/admin"
            className="flex items-center gap-2.5 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted/50 transition-colors"
            activeClassName="bg-primary/10 text-primary font-medium"
          >
            <Shield className="h-4 w-4" />
            <span>Admin</span>
          </NavLink>
        )}
      </nav>

      {/* Footer */}
      <div className="p-3 border-t border-border">
        <NavLink
          to="/dashboard"
          className="flex items-center gap-2 px-3 py-2 rounded-md text-xs text-muted-foreground hover:bg-muted/50 transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to Dashboard</span>
        </NavLink>
      </div>
    </aside>
  );
}
