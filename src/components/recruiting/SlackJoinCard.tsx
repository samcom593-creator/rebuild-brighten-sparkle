import { ExternalLink, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { resolveBrand } from "@/config/brand";

export const APEX_SLACK_INVITE_URL = "https://join.slack.com/t/apex-financial-co/shared_invite/zt-47rdeq1fr-ETmj8yGBgRcoYVkwfc3DBQ";

const ROLE_CHANNELS = {
  licensed: {
    name: "#general-licensed",
    url: "https://apex-financial-co.slack.com/archives/C0BS9F2M35M",
  },
  unlicensed: {
    name: "#general-unlicensed",
    url: "https://apex-financial-co.slack.com/archives/C0BSUGBR62G",
  },
} as const;

export function SlackJoinCard({
  licenseStatus,
  compact = false,
}: {
  licenseStatus: "licensed" | "unlicensed" | "pending";
  compact?: boolean;
}) {
  const brand = resolveBrand();
  const channel = licenseStatus === "pending" ? null : ROLE_CHANNELS[licenseStatus];

  return (
    <div className={cn("rounded-xl border border-primary/40 bg-primary/5 text-foreground", compact ? "p-4" : "p-5")}>
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
          <MessageSquare className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-primary">Step 1: Join your team in Slack</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Get daily huddles, contracting help, live scripts, training support, and real-time sales wins.
            {channel ? <> After joining, open <span className="font-semibold text-foreground">{channel.name}</span>.</> : null}
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Button asChild size="sm" className="font-bold">
              <a href={APEX_SLACK_INVITE_URL} target="_blank" rel="noopener noreferrer">
                Join {brand.shortName} Slack
                <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
              </a>
            </Button>
            {channel ? (
              <Button asChild size="sm" variant="outline">
                <a href={channel.url} target="_blank" rel="noopener noreferrer">
                  Open {channel.name}
                </a>
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
