/**
 * The switch for demo mode, so it is not URL-only.
 *
 * `?demo=1` still works and is the better thing to hand someone (a bookmark, a
 * link in a message), but a mode with no visible control is a mode people
 * forget they left on. This card states which way it is pointing right now and
 * flips it.
 *
 * Turning it on reloads deliberately: React Query already holds live rows in
 * cache, and flipping the flag without discarding them would leave real numbers
 * on screen underneath a banner promising they are fake — the failure that
 * matters most here, since it is the one that discloses the book while claiming
 * not to.
 */

import { EyeOff, Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { isDemoMode, setDemoMode } from "@/lib/demoMode";

export function DemoModeCard() {
  const on = isDemoMode();

  const flip = (next: boolean) => {
    setDemoMode(next);
    // Full reload, not a re-render: the cache must be dropped either way.
    window.location.href = `${window.location.pathname}${next ? "?demo=1" : ""}`;
  };

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            {on ? <EyeOff className="h-4 w-4 text-amber-400" /> : <Eye className="h-4 w-4 text-slate-400" />}
            <h3 className="font-semibold">Demo mode</h3>
            <Badge variant={on ? "default" : "secondary"}>{on ? "ON" : "OFF"}</Badge>
          </div>
          <p className="mt-2 text-sm text-slate-400">
            Replaces every number, client name, email and phone on screen with
            consistent fake data, so you can walk someone through the platform
            without showing them the live book. Pages, charts and flows behave
            exactly as they do normally.
          </p>
          <p className="mt-2 text-xs text-slate-500">
            Shareable link: <code>?demo=1</code> on any page. Anything you save
            while in demo mode still writes real data — this masks the display,
            it is not a sandbox.
          </p>
        </div>
        <Button variant={on ? "secondary" : "default"} onClick={() => flip(!on)} className="shrink-0">
          {on ? "Turn off" : "Turn on"}
        </Button>
      </div>
    </div>
  );
}
