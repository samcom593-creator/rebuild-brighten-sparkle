import { cn } from "@/lib/utils";
import { CW_MODULES, type CwModuleKey } from "./modules";

interface Props {
  active: CwModuleKey;
  onSelect: (key: CwModuleKey) => void;
}

/**
 * Vertical sub-nav for the 12 ContentWheel modules.
 * Order = the cycle (see modules.ts). Persisted via ?m=<key> on the parent page.
 */
export function ContentWheelSubNav({ active, onSelect }: Props) {
  return (
    <nav className="rounded-xl border border-border bg-card/40 backdrop-blur-sm p-2 sticky top-4">
      <div className="px-3 py-2 border-b border-border/60 mb-2">
        <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">The Wheel</p>
        <p className="text-sm font-semibold text-foreground">12 Modules</p>
      </div>
      <ul className="space-y-0.5">
        {CW_MODULES.map((m) => {
          const Icon = m.icon;
          const isActive = m.key === active;
          const isShipped = m.phase === "P1";
          return (
            <li key={m.key}>
              <button
                type="button"
                onClick={() => onSelect(m.key)}
                className={cn(
                  "w-full flex items-start gap-3 rounded-lg px-3 py-2 text-left transition-colors",
                  isActive
                    ? "bg-primary/15 text-primary border border-primary/30"
                    : "hover:bg-muted/40 text-muted-foreground border border-transparent",
                )}
              >
                <span className="font-mono text-[10px] mt-1 w-7 shrink-0 opacity-60">{m.number}</span>
                <Icon className={cn("h-4 w-4 mt-0.5 shrink-0", isActive ? "text-primary" : "")} />
                <span className="flex-1 min-w-0">
                  <span className={cn("block text-sm font-medium leading-tight", isActive ? "text-foreground" : "")}>
                    {m.label}
                  </span>
                  <span className="block text-[11px] leading-snug text-muted-foreground/80 mt-0.5 truncate">
                    {m.short}
                  </span>
                </span>
                {!isShipped && (
                  <span className="text-[9px] uppercase tracking-wider font-mono mt-1 rounded-sm bg-muted/40 px-1.5 py-0.5 text-muted-foreground/70">
                    {m.phase}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="px-3 pt-3 mt-2 border-t border-border/60 text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 leading-snug">
        Hold the Standard.<br />Average is the disease.
      </div>
    </nav>
  );
}
