import { Link } from "react-router-dom";
import { ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * AccessDeniedPanel: what a signed-in person sees when a route's role gate
 * refuses them. It names the page, says which account kind can open it and
 * offers one safe destination. It replaces a silent redirect to another home
 * (2026-10-15), which left someone following a shared link with no idea why
 * they landed somewhere else. Protected data is never rendered here; the
 * server enforces access on its own.
 */
export interface AccessDeniedPanelProps {
  /** The path that was refused, shown so the person can report or request it. */
  pathname: string;
  /** From describeAccessRequirement: "an admin or manager account". */
  requirement: string;
  /** A destination the person can always open. */
  homeHref: string;
}

export function AccessDeniedPanel({ pathname, requirement, homeHref }: AccessDeniedPanelProps) {
  return (
    <section role="alert" aria-labelledby="access-denied-title" className="mx-auto w-full max-w-xl px-4 py-10 sm:px-6">
      <Card className="bg-card">
        <CardContent className="space-y-4 p-6">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="space-y-1">
              <h1 id="access-denied-title" className="text-base font-semibold text-card-foreground">
                You do not have access to this page
              </h1>
              <p className="text-sm text-muted-foreground">
                <span className="break-all font-mono text-card-foreground">{pathname}</span> needs {requirement}. You are
                signed in, but your account does not carry that access. If someone sent you this link, ask them for a
                page you can open, or ask an admin to change your role.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm">
              <Link to={homeHref}>Go to Home</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

export default AccessDeniedPanel;
