import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";

const HEADHUNTER_ORIGIN = (
  import.meta.env.VITE_HEADHUNTER_URL || "https://headhunter-sand.vercel.app"
).replace(/\/$/, "");

export default function HeadhunterGateway() {
  const { session, user } = useAuth();
  const navigate = useNavigate();
  const formRef = useRef<HTMLFormElement>(null);
  const [launching, setLaunching] = useState(true);

  const launch = useCallback(() => {
    if (!session?.access_token || !formRef.current) {
      setLaunching(false);
      return;
    }
    setLaunching(true);
    formRef.current.requestSubmit();
  }, [session?.access_token]);

  useEffect(() => {
    if (!session?.access_token) {
      setLaunching(false);
      return;
    }
    const timer = window.setTimeout(launch, 450);
    return () => window.clearTimeout(timer);
  }, [launch, session?.access_token]);

  return (
    <main className="min-h-[calc(100dvh-5rem)] px-4 py-8 sm:px-6 lg:px-8">
      <form
        ref={formRef}
        method="post"
        action={`${HEADHUNTER_ORIGIN}/api/auth/apex`}
        className="hidden"
      >
        <input type="hidden" name="access_token" value={session?.access_token ?? ""} />
      </form>

      {/* 2026-08-16: was a rounded-3xl / backdrop-blur / gradient card — glassmorphism
          the rest of the app dropped long ago, and it is the first thing Sam sees every
          time he clicks Interviews. Flattened to the standard surface: 1px border,
          rounded-md, no blur, no gradient, and the two filler "feature" tiles removed
          since this screen exists only to hand off in ~450ms. */}
      <section className="mx-auto flex max-w-lg flex-col rounded-md border border-border bg-card p-6 shadow-sm sm:p-8">
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Users className="h-5 w-5" />
        </div>
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-foreground">
          Opening Headhunter
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Your interview pipeline — appointments, outcomes, follow-ups and hires. You are
          signed in automatically with your APEX identity.
        </p>

        <div
          aria-live="polite"
          className="mt-5 flex items-center gap-2.5 rounded-md border border-border/70 bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground"
        >
          <span className={`h-2 w-2 shrink-0 rounded-full ${launching ? "animate-pulse bg-primary" : "bg-amber-400"}`} />
          {launching
            ? `Signing in${user?.email ? ` as ${user.email}` : ""}…`
            : "Automatic sign-in didn’t start — use the button below."}
        </div>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button variant="outline" onClick={() => navigate("/dashboard")} className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Back to dashboard
          </Button>
          <Button onClick={launch} disabled={!session?.access_token || launching} className="gap-2">
            {launching ? "Opening…" : "Open Headhunter"}
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </section>
    </main>
  );
}
