import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar, Copy, ExternalLink, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { formatTimeAgo } from "@/lib/dateUtils";

// Honest label (redesign section 7): ics-feed serves the user's agent_tasks
// with a due date, NOT calendar appointments or interviews. The card used to be
// titled "Apple Calendar Sync", which read as "my appointments are on my phone".
// It also shows when a device last fetched the feed, the only delivery signal
// this feed has.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

export function CalendarSyncSection() {
  const [token, setToken] = useState<string | null>(null);
  const [lastPolled, setLastPolled] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Try to load existing token on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("ics_feed_tokens" as any)
        .select("token, last_accessed_at")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!cancelled && data) {
        const row = data as unknown as { token: string; last_accessed_at: string | null };
        setToken(row.token);
        setLastPolled(row.last_accessed_at);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const generate = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("get_or_create_ics_token" as any);
      if (error) throw error;
      setToken(data as string);
      toast.success("Feed URL ready");
    } catch (e: any) {
      toast.error(e.message || "Failed to generate token");
    } finally {
      setLoading(false);
    }
  };

  const httpsUrl = token ? `${SUPABASE_URL}/functions/v1/ics-feed?token=${token}` : null;
  const webcalUrl = httpsUrl ? httpsUrl.replace(/^https:/, "webcal:") : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Calendar className="h-5 w-5 text-primary" /> Task feed for your phone calendar
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Subscribes Apple, Google or Outlook Calendar to your open tasks due in the next 60 days. Interviews and
          appointments are not in this feed — they live on the Calendar page. Your calendar app decides how often it
          refreshes.
        </p>

        {!token ? (
          <Button onClick={generate} disabled={loading}>
            {loading ? (<><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Generating...</>) : "Generate Feed URL"}
          </Button>
        ) : (
          <>
            <div className="p-3 bg-muted/30 rounded-lg break-all text-xs font-mono border border-border">
              {httpsUrl}
            </div>
            <p className="text-xs text-muted-foreground">
              {lastPolled
                ? `Last fetched by a device: ${formatTimeAgo(lastPolled)}.`
                : "No device has fetched this feed yet."}
            </p>
            <div className="flex gap-2 flex-wrap">
              <Button
                size="sm"
                onClick={() => {
                  if (httpsUrl) {
                    navigator.clipboard.writeText(httpsUrl);
                    toast.success("Copied");
                  }
                }}
              >
                <Copy className="h-4 w-4 mr-1" /> Copy URL
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => { if (webcalUrl) window.location.href = webcalUrl; }}
              >
                <ExternalLink className="h-4 w-4 mr-1" /> Open in Calendar
              </Button>
            </div>
            <div className="text-xs text-muted-foreground space-y-1 pt-2 border-t border-border">
              <p className="font-semibold text-foreground">On iPhone / iPad:</p>
              <p>Tap "Open in Calendar" above, then tap Subscribe.</p>
              <p className="font-semibold text-foreground mt-2">On Mac:</p>
              <p>Calendar → File → New Calendar Subscription → paste the URL.</p>
              <p className="font-semibold text-foreground mt-2">On Google Calendar:</p>
              <p>Settings → Add calendar → From URL → paste the URL.</p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
