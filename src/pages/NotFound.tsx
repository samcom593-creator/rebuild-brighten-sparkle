import { Link, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { Compass, ArrowRight } from "lucide-react";
import { logger } from "@/shared/lib/logger";

const suggestions: Array<{ label: string; to: string; kicker: string }> = [
  { label: "Apply", to: "/apply", kicker: "Start here" },
  { label: "Dashboard", to: "/dashboard", kicker: "Signed in?" },
  { label: "Get licensed", to: "/get-licensed", kicker: "Course path" },
];

/**
 * perf/site-wide-optimization (2026-08-06): three paths reach this catch-all
 * often enough to deserve a real answer instead of "that path doesn't exist".
 *
 * The alternative — registering a route for each — was rejected on purpose:
 *   - /mentorship has ZERO inbound links anywhere in src/, no page component,
 *     and the real mentorship page is deployed on a DIFFERENT property
 *     (samueljameshq.vercel.app). Adding a route here would mean inventing a
 *     sales surface inside the business dashboard and creating an orphan page
 *     that check:orphan-pages would then have to whitelist.
 *   - bare /status cannot resolve without an application id, and the only way
 *     to look one up would be a by-email RPC, which is an email-enumeration
 *     hole on an anon-callable endpoint. Not worth it for a path nothing links.
 *   - /leaderboard IS a real route, just behind ProtectedRoute — an unauth'd
 *     visitor bounces and previously landed on a bare 404 that told them
 *     nothing about why.
 *
 * So: keep the honest 404, make it explain itself. No orphan pages added.
 */
function explain(pathname: string): string | null {
  const p = pathname.toLowerCase().replace(/\/+$/, "");
  if (p === "/status") {
    return "Application status pages are personal. Open the status link from your confirmation email or text — it looks like /status/your-application-id.";
  }
  if (p === "/mentorship" || p.startsWith("/mentorship/")) {
    return "Mentorship isn't hosted on this site. Ask your manager for the current enrollment link.";
  }
  if (p === "/leaderboard" || p === "/dashboard/leaderboard") {
    return "The leaderboard is for signed-in agents. Sign in and it will load.";
  }
  return null;
}

const NotFound = () => {
  const location = useLocation();
  const hint = explain(location.pathname);

  useEffect(() => {
    logger.info("[404] unknown route", { path: location.pathname });
  }, [location.pathname]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-white dark:bg-slate-900 px-6">
      <div className="animate-fade-in w-full max-w-md">
        <div className="text-center mb-10">
          <div className="landing-scale-in inline-flex items-center justify-center w-16 h-16 rounded-md bg-primary/10 text-primary mb-5">
            <Compass className="w-8 h-8" />
          </div>
          <h1 className="text-sm font-bold tracking-[0.2em] text-muted-foreground uppercase mb-2">
            404 · not found
          </h1>
          <p className="text-2xl font-semibold text-foreground mb-2">
            That path doesn't exist.
          </p>
          <p className="text-sm text-muted-foreground font-mono break-all">
            {location.pathname}
          </p>
          {hint && (
            <p className="mt-4 text-sm text-foreground/80 leading-relaxed border-t border-border pt-4">
              {hint}
            </p>
          )}
        </div>

        <div className="space-y-2">
          {suggestions.map((s) => (
            <Link
              key={s.to}
              to={s.to}
              className="group flex items-center justify-between px-4 py-3 rounded-lg border border-border bg-card hover:bg-accent hover:border-primary/40 transition-colors"
            >
              <div>
                <div className="text-xs text-muted-foreground">{s.kicker}</div>
                <div className="font-semibold text-foreground">{s.label}</div>
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
            </Link>
          ))}
        </div>

        <p className="text-center text-xs text-muted-foreground mt-8">
          APEX Financial
        </p>
      </div>
    </div>
  );
};

export default NotFound;
