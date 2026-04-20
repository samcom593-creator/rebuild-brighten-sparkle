import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar, Copy, ExternalLink, RefreshCw } from "lucide-react";
import { toast } from "sonner";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

export function CalendarSyncSection() {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Try to load existing token on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("ics_feed_tokens" as any)
        .select("token")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!cancelled && data) setToken((data as any).token);
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
          <Calendar className="h-5 w-5 text-primary" /> Apple Calendar Sync
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Subscribe to your APEX tasks feed in Apple Calendar. Tasks auto-sync to iPhone, iPad, and Mac. Refreshes every 15 minutes.
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
