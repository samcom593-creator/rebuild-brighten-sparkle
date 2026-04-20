import { Copy, Smartphone } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const HOST = "https://apex-financial.org";

const SHORTCUTS = [
  { name: "Morning Brief", description: "Open the admin dashboard", path: "/dashboard",      emoji: "☀️" },
  { name: "Log Deal",      description: "Jump straight to the deal entry",  path: "/numbers",        emoji: "💰" },
  { name: "New Recruit",   description: "Open CRM to add a recruit",        path: "/dashboard/crm",  emoji: "🎯" },
  { name: "Send Blast",    description: "Open the inbox to send a blast",   path: "/dashboard/inbox", emoji: "📣" },
];

export function IPhoneShortcutsSection() {
  const copy = async (name: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(`${name} link copied — paste into Shortcuts on iPhone`);
    } catch {
      toast.error(`Copy failed. URL: ${url}`);
    }
  };

  return (
    <GlassCard className="p-5">
      <div className="flex items-center gap-2 mb-1">
        <Smartphone className="h-5 w-5 text-primary" />
        <h3 className="text-base font-semibold">iPhone Shortcuts</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Tap the link on your iPhone to open directly — or copy it into the Shortcuts app
        (<em>Open URL</em> action) to add a one-tap home-screen button.
      </p>

      <div className="grid gap-2">
        {SHORTCUTS.map(s => {
          const url = `${HOST}${s.path}`;
          return (
            <div key={s.path} className="flex items-center gap-3 p-3 rounded-lg border border-border/40 bg-background/40">
              <div className="text-xl" aria-hidden>{s.emoji}</div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold">{s.name}</div>
                <div className="text-xs text-muted-foreground truncate">{s.description}</div>
                <code className="text-[11px] text-muted-foreground/70 truncate block">{url}</code>
              </div>
              <Button size="sm" variant="outline" onClick={() => copy(s.name, url)} className="shrink-0">
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-muted-foreground/70 mt-4 leading-relaxed">
        <strong>How to add:</strong> Open <em>Shortcuts</em> → + → <em>Add Action</em> → search "Open URL" →
        paste link → name it → share to Home Screen.
      </p>
    </GlassCard>
  );
}
