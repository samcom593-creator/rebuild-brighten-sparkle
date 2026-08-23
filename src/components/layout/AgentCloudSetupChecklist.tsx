import { useMemo, useState } from "react";
import { Check, ChevronDown, ChevronUp, ClipboardCheck, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { resolveBrand } from "@/config/brand";
import { useAuth } from "@/hooks/useAuth";

const STORAGE_KEY = "agentcloud_setup_checklist_v1";

const STEPS = [
  { id: "account", label: "Confirm your account" },
  { id: "profile", label: "Complete producer profile" },
  { id: "agency", label: "Set agency branding" },
  { id: "calendar", label: "Connect calendar" },
  { id: "carrier", label: "Review carrier contracts" },
  { id: "invite", label: "Invite an agent" },
  { id: "client", label: "Add your first client" },
  { id: "deal", label: "Post a deal" },
  { id: "notifications", label: "Choose notifications" },
  { id: "training", label: "Review training resources" },
  { id: "finance", label: "Open finances" },
] as const;
const STEP_IDS = new Set<string>(STEPS.map((step) => step.id));

function loadCompleted(): string[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string" && STEP_IDS.has(value)) : [];
  } catch {
    return [];
  }
}

export function AgentCloudSetupChecklist() {
  const { user } = useAuth();
  const brand = resolveBrand();
  const [collapsed, setCollapsed] = useState(true);
  const [completed, setCompleted] = useState<string[]>(() => {
    const saved = loadCompleted();
    return user ? Array.from(new Set(["account", ...saved])) : saved;
  });

  const completedSet = useMemo(() => new Set(completed), [completed]);
  // 2026-08-21 audit: the checklist sat in the corner forever ("1 of 11 done"
  // on every route) and collided with the chat launcher. Dismiss is permanent
  // per browser; finishing every step also retires it.
  const [dismissed, setDismissed] = useState<boolean>(() => window.localStorage.getItem("apex.setup-checklist.dismissed") === "true");
  const progress = Math.round((completedSet.size / STEPS.length) * 100);

  const toggle = (id: string, checked: boolean) => {
    const next = checked
      ? Array.from(new Set([...completed, id]))
      : completed.filter((value) => value !== id);
    setCompleted(next);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  if (dismissed || completedSet.size === STEPS.length) return null;

  return (
    <aside className="fixed bottom-24 right-6 z-40 hidden w-80 overflow-hidden rounded-lg border border-border bg-card shadow-lg xl:block" aria-label="Setup checklist">
      <button
        type="button"
        aria-label="Dismiss setup checklist"
        className="absolute right-1.5 top-1.5 z-10 rounded p-1 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
        onClick={(e) => { e.stopPropagation(); window.localStorage.setItem("apex.setup-checklist.dismissed", "true"); setDismissed(true); }}
      >
        <X className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/40"
        onClick={() => setCollapsed((value) => !value)}
        aria-expanded={!collapsed}
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary"><ClipboardCheck className="h-4 w-4" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Set up {brand.platformName}</span>
          <span className="block text-xs text-muted-foreground">{completedSet.size} of {STEPS.length} done</span>
        </span>
        {completedSet.size === STEPS.length ? <Check className="h-4 w-4 text-emerald-500" /> : collapsed ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      {!collapsed && (
        <div className="border-t border-border px-4 pb-4 pt-3">
          <Progress value={progress} className="mb-3 h-1.5" />
          <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
            {STEPS.map((step) => (
              <label key={step.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-xs hover:bg-muted/40">
                <Checkbox checked={completedSet.has(step.id)} onCheckedChange={(value) => toggle(step.id, value === true)} />
                <span className={completedSet.has(step.id) ? "text-muted-foreground line-through" : "text-foreground"}>{step.label}</span>
              </label>
            ))}
          </div>
          <Button variant="ghost" size="sm" className="mt-2 w-full text-xs" onClick={() => setCollapsed(true)}>Keep working</Button>
        </div>
      )}
    </aside>
  );
}
