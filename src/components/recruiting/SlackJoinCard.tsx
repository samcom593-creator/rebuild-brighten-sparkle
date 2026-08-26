import { MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { resolveBrand } from "@/config/brand";
import { cn } from "@/lib/utils";

const BRAND = resolveBrand();

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
  const channel = licenseStatus === "pending" ? null : ROLE_CHANNELS[licenseStatus];

  return (
    <div className={cn("rounded-xl border border-primary/40 bg-primary/5 text-foreground", compact ? "p-4" : "p-5")}>
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
          <MessageSquare className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-primary">Your {BRAND.shortName} Slack access</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Approved active hires receive a verified workspace invite by email. Applicants and excluded roster members cannot use a shared join link.
            {channel ? <> After accepting, open <span className="font-semibold text-foreground">{channel.name}</span>.</> : null}
          </p>
          {channel ? (
            <div className="mt-3">
              <Button asChild size="sm" variant="outline">
                <a href={channel.url} target="_blank" rel="noopener noreferrer">
                  Open {channel.name}
                </a>
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
