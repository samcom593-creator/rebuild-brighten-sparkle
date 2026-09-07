import { useEffect, useState } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  describeSessionFault, describeSkew, recordSessionAuthEvent,
  type SessionFault,
} from "@/lib/sessionClock";

/**
 * MP-366 — say why the session keeps resetting, instead of bouncing to /login.
 *
 * Edwin Ac-lumor told Sam "it keeps logging me out", and that was the entire
 * diagnostic surface: two days later somebody had to read Supabase's auth logs
 * to find 135 POST /token calls in 55 minutes ending in a rate limit. The agent
 * could not have reported anything more useful, because the app never told him
 * anything — it just returned him to the login page.
 *
 * A skewed device clock is a fact the browser can measure exactly (the gap
 * between the token's server-stamped `iat` and local time) and a fact only the
 * person sitting at that machine can fix. So it gets named, with the number, and
 * the reset button covers the other cause we know produces the same loop — a
 * stored session whose expiry no longer makes sense.
 *
 * Deliberately a banner and not a blocking dialog: a wrong clock does not stop
 * the app working, it only makes the session churn. Taking the screen away from
 * somebody mid-call to tell them about their clock would cost more than it saves.
 */
export function SessionClockBanner() {
  const [fault, setFault] = useState<SessionFault>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // SIGNED_IN can replay a stored session when a tab regains focus. Only a
    // completed token refresh proves the issue time is recent.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      recordSessionAuthEvent(event, session?.access_token, Date.now());
      setFault(describeSessionFault(Date.now()));
    });

    return () => { cancelled = true; subscription.unsubscribe(); };
  }, []);

  if (!fault || dismissed) return null;

  const resetSession = async () => {
    try {
      await supabase.auth.signOut({ scope: "local" });
    } finally {
      // Reload regardless: the point of the button is to leave this tab in a
      // known state, and a failed network sign-out must not strand the person
      // on the banner that told them to press it. A full reload rather than
      // useNavigate() is the whole remedy — the fault being cleared is stale
      // in-memory auth state, which a client-side route change preserves.
      window.location.assign("/login"); // internal-nav-href-allow: resetting a broken session requires a fresh tree, not a route change
    }
  };

  return (
    <div
      role="status"
      className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2"
    >
      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
      <p className="min-w-0 flex-1 text-xs leading-5 text-foreground">
        {fault.kind === "clock" ? (
          <>
            <span className="font-semibold">This device's clock is {describeSkew(fault.skewSeconds)}.</span>{" "}
            This can disrupt your session. Enable automatic date and time in
            your device settings, then reload.
          </>
        ) : (
          <>
            <span className="font-semibold">Your sign-in keeps resetting on this device.</span>{" "}
            It renewed {fault.refreshes} times in the last minute, which normally
            happens about once an hour. Resetting the session on this device
            usually clears it.
          </>
        )}
      </p>
      <span className="flex items-center gap-2">
        <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={resetSession}>
          <RotateCcw className="h-3.5 w-3.5" />
          Reset session
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setDismissed(true)}>
          Dismiss
        </Button>
      </span>
    </div>
  );
}

export default SessionClockBanner;
