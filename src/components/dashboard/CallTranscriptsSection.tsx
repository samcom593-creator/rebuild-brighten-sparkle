import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Mic, Sparkles, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface Props {
  applicationId?: string;
  agentId?: string;
}

export function CallTranscriptsSection({ applicationId, agentId }: Props) {
  const qc = useQueryClient();
  const [transcript, setTranscript] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: transcripts = [], isLoading } = useQuery({
    queryKey: ["call-transcripts", applicationId, agentId],
    enabled: !!(applicationId || agentId),
    queryFn: async () => {
      let q = supabase
        .from("call_transcripts")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      if (applicationId) q = q.eq("application_id", applicationId);
      else if (agentId) q = q.eq("agent_id", agentId);
      const { data } = await q;
      return data || [];
    },
  });

  const handleSubmit = async () => {
    if (transcript.trim().length < 10) {
      toast.error("Transcript too short");
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("transcribe-call", {
        body: {
          transcript: transcript.trim(),
          applicationId: applicationId || null,
          agentId: agentId || null,
        },
      });
      if (error) throw error;
      if (data?.error && data?.status === "failed") {
        toast.warning("Saved transcript, but AI analysis failed");
      } else {
        toast.success("Transcript saved & analyzed by AI");
      }
      setTranscript("");
      qc.invalidateQueries({ queryKey: ["call-transcripts", applicationId, agentId] });
    } catch (err: any) {
      toast.error(err.message || "Failed to save transcript");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-3 p-3 rounded-lg bg-muted/30 border border-border">
      <Label className="flex items-center gap-2">
        <Mic className="h-4 w-4 text-primary" />
        Call Transcripts
        <Badge variant="outline" className="ml-auto text-[10px] gap-1">
          <Sparkles className="h-2.5 w-2.5" /> AI Analyzed
        </Badge>
      </Label>

      <div className="space-y-2">
        <Textarea
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          placeholder="Paste a call transcript here. AI will summarize and detect sentiment automatically…"
          rows={4}
          className="text-sm"
        />
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={submitting || transcript.trim().length < 10}
          className="w-full"
        >
          {submitting ? (
            <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Analyzing with AI…</>
          ) : (
            <><Sparkles className="h-3.5 w-3.5 mr-1.5" /> Save & Analyze</>
          )}
        </Button>
      </div>

      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : transcripts.length > 0 ? (
        <div className="space-y-1.5">
          {transcripts.map((t: any) => {
            const expanded = expandedId === t.id;
            return (
              <div
                key={t.id}
                className="rounded-md border border-border bg-background text-sm overflow-hidden"
              >
                <button
                  onClick={() => setExpandedId(expanded ? null : t.id)}
                  className="w-full flex items-center justify-between gap-2 p-2 hover:bg-muted/40 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px] shrink-0",
                        t.sentiment === "positive" && "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
                        t.sentiment === "negative" && "bg-red-500/10 text-red-400 border-red-500/30",
                        t.sentiment === "neutral" && "bg-muted text-muted-foreground"
                      )}
                    >
                      {t.sentiment || "—"}
                    </Badge>
                    {t.call_outcome && (
                      <Badge variant="outline" className="text-[10px] shrink-0">{t.call_outcome}</Badge>
                    )}
                    <span className="text-xs text-muted-foreground truncate">
                      {format(new Date(t.created_at), "MMM d, h:mm a")}
                    </span>
                  </div>
                  {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </button>
                {expanded && (
                  <div className="p-3 pt-0 space-y-2 border-t border-border">
                    {t.summary && (
                      <div>
                        <div className="text-[10px] uppercase text-muted-foreground mb-1">AI Summary</div>
                        <p className="text-xs">{t.summary}</p>
                      </div>
                    )}
                    {t.transcript && (
                      <div>
                        <div className="text-[10px] uppercase text-muted-foreground mb-1">Transcript</div>
                        <p className="text-xs text-muted-foreground whitespace-pre-wrap max-h-48 overflow-y-auto">
                          {t.transcript}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground italic">No transcripts yet</p>
      )}
    </div>
  );
}
