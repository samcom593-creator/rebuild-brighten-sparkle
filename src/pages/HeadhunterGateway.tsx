import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, ShieldCheck, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

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

      <section className="mx-auto flex max-w-2xl flex-col overflow-hidden rounded-3xl border border-primary/25 bg-card/90 shadow-lg backdrop-blur">
        <div className="border-b border-border/70 bg-gradient-to-br from-primary/15 via-background to-background px-6 py-8 sm:px-9">
          <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <Users className="h-6 w-6" />
          </div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            APEX recruiting
          </p>
          <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Opening Headhunter
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
            One interview pipeline for appointments, outcomes, follow-ups, and hires. Your APEX identity signs you in automatically.
          </p>
        </div>

        <div className="space-y-5 px-6 py-7 sm:px-9">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex gap-3 rounded-2xl border border-border/70 bg-background/60 p-4">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
              <div>
                <p className="text-sm font-semibold text-foreground">Secure handoff</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">The session is sent by encrypted POST, never placed in the URL.</p>
              </div>
            </div>
            <div className="flex gap-3 rounded-2xl border border-border/70 bg-background/60 p-4">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <div>
                <p className="text-sm font-semibold text-foreground">Same live workflow</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">Existing applicant history and permissions stay intact.</p>
              </div>
            </div>
          </div>

          <div aria-live="polite" className="flex items-center gap-3 rounded-2xl bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
            <span className={`h-2.5 w-2.5 rounded-full ${launching ? "animate-pulse bg-primary" : "bg-amber-400"}`} />
            {launching ? `Signing in${user?.email ? ` as ${user.email}` : ""}…` : "Automatic sign-in is ready to retry."}
          </div>

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
            <button
              type="button"
              onClick={() => navigate("/dashboard")}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-muted-foreground transition hover:border-primary/50 hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to dashboard
            </button>
            <button
              type="button"
              onClick={launch}
              disabled={!session?.access_token || launching}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {launching ? "Opening…" : "Open Headhunter"}
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
