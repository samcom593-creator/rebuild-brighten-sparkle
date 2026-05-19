import { Link, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { Compass, ArrowRight } from "lucide-react";

const suggestions: Array<{ label: string; to: string; kicker: string }> = [
  { label: "Apply", to: "/apply", kicker: "Start here" },
  { label: "Dashboard", to: "/dashboard", kicker: "Signed in?" },
  { label: "Get licensed", to: "/get-licensed", kicker: "Course path" },
];

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    // Not an error — just a user navigation away from a live route.
    console.info("[404] unknown route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/60 px-6">
      <div className="animate-fade-in w-full max-w-md">
        <div className="text-center mb-10">
          <div className="landing-scale-in inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 text-primary mb-5">
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
