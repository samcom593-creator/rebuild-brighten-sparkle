import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useBrand } from "@/hooks/useBrand";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface SupportRequest {
  id: string;
  category: string;
  subject: string;
  details: string;
  priority: "low" | "normal" | "high" | "urgent";
  status: "open" | "in_progress" | "waiting_on_requester" | "resolved" | "closed";
  resolution_note: string | null;
  created_at: string;
  updated_at: string;
  requester_name: string;
  requester_email: string;
}

const CATEGORIES = [
  ["website", "Website / UI"], ["contracting", "Contracting"], ["readymode", "ReadyMode"],
  ["recruiting", "Recruiting / interviews"], ["licensing_training", "Licensing / training"],
  ["sales_deals", "Sales / post a deal"], ["account_access", "Account / password"], ["other", "Other"],
] as const;
const STATUSES = ["open", "in_progress", "waiting_on_requester", "resolved", "closed"] as const;

export function SupportDesk() {
  const { user, isAdmin } = useAuth();
  const brand = useBrand();
  const queryClient = useQueryClient();
  const [category, setCategory] = useState("website");
  const [priority, setPriority] = useState("normal");
  const [subject, setSubject] = useState("");
  const [details, setDetails] = useState("");

  const requests = useQuery({
    queryKey: ["apex-support-requests", user?.id, isAdmin],
    enabled: Boolean(user?.id),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("apex_support_requests" as never, { p_limit: 100 } as never);
      if (error) throw error;
      return (data ?? []) as unknown as SupportRequest[];
    },
  });

  const submit = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("apex_submit_support_request" as never, {
        p_category: category, p_subject: subject.trim(), p_details: details.trim(), p_priority: priority,
      } as never);
      if (error) throw error;
    },
    onSuccess: async () => {
      setSubject(""); setDetails(""); setPriority("normal");
      await queryClient.invalidateQueries({ queryKey: ["apex-support-requests"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-operations-command-center"] });
      toast.success(`Request sent to ${brand.shortName} support`);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not send request"),
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.rpc("apex_update_support_request" as never, {
        p_id: id, p_status: status, p_resolution_note: null,
      } as never);
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["apex-support-requests"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-operations-command-center"] });
      toast.success("Support status updated");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not update request"),
  });

  const canSubmit = subject.trim().length >= 3 && details.trim().length >= 10;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,430px)_minmax(0,1fr)]">
      <Card className="h-fit">
        <CardContent className="space-y-4 p-5">
          <div><h2 className="text-base font-semibold">Ask {brand.shortName}</h2><p className="text-xs text-muted-foreground">Website, contracting, ReadyMode, recruiting, training, deal, or account problem. This creates a tracked request and alerts admins.</p></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>Area</Label><Select value={category} onValueChange={setCategory}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{CATEGORIES.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1.5"><Label>Priority</Label><Select value={priority} onValueChange={setPriority}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="low">Low</SelectItem><SelectItem value="normal">Normal</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="urgent">Urgent — blocked now</SelectItem></SelectContent></Select></div>
          </div>
          <div className="space-y-1.5"><Label htmlFor="support-subject">What do you need?</Label><Input id="support-subject" value={subject} maxLength={160} onChange={(event) => setSubject(event.target.value)} placeholder="Example: carrier contract will not submit" /></div>
          <div className="space-y-1.5"><Label htmlFor="support-details">What happened?</Label><Textarea id="support-details" value={details} maxLength={5000} rows={6} onChange={(event) => setDetails(event.target.value)} placeholder="Page, person, action, expected result, and exact error. Do not include passwords." /></div>
          <Button className="w-full" disabled={!canSubmit || submit.isPending} onClick={() => submit.mutate()}>{submit.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Send tracked request</Button>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3"><div><h2 className="text-base font-semibold">{isAdmin ? "Support queue" : "My requests"}</h2><p className="text-xs text-muted-foreground">{isAdmin ? "All agency requests, urgent first." : "Status and response history."}</p></div><Badge variant="outline">{requests.data?.length ?? 0}</Badge></div>
        {requests.isLoading ? <Card><CardContent className="flex items-center justify-center p-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></CardContent></Card> : requests.isError ? <Card className="border-rose-500/35"><CardContent className="flex items-center gap-2 p-4 text-sm"><AlertTriangle className="h-4 w-4 text-rose-400" />Support queue could not load.</CardContent></Card> : requests.data?.length === 0 ? <Card><CardContent className="flex flex-col items-center gap-2 p-10 text-center"><CheckCircle2 className="h-6 w-6 text-emerald-500" /><p className="text-sm font-medium">No support requests</p><p className="text-xs text-muted-foreground">Everything reported here will stay tracked until resolved.</p></CardContent></Card> : requests.data?.map((request) => (
          <Card key={request.id} className={cn(request.priority === "urgent" && request.status !== "resolved" && request.status !== "closed" && "border-rose-500/40")}>
            <CardContent className="p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0"><div className="flex flex-wrap items-center gap-1.5"><Badge variant="outline" className="capitalize">{request.category.replaceAll("_", " ")}</Badge><Badge variant="outline" className={cn("capitalize", request.priority === "urgent" && "border-rose-500/40 text-rose-400")}>{request.priority}</Badge></div><h3 className="mt-2 font-semibold">{request.subject}</h3><p className="mt-1 whitespace-pre-wrap text-sm text-foreground/80">{request.details}</p><p className="mt-2 text-[11px] text-muted-foreground">{isAdmin ? `${request.requester_name} · ${request.requester_email} · ` : ""}{new Date(request.created_at).toLocaleString()}</p>{request.resolution_note && <p className="mt-2 rounded-md bg-muted p-2 text-xs"><span className="font-semibold">Resolution:</span> {request.resolution_note}</p>}</div>
                {isAdmin ? <Select value={request.status} onValueChange={(status) => updateStatus.mutate({ id: request.id, status })} disabled={updateStatus.isPending}><SelectTrigger className="w-full sm:w-[190px]"><SelectValue /></SelectTrigger><SelectContent>{STATUSES.map((status) => <SelectItem key={status} value={status}>{status.replaceAll("_", " ")}</SelectItem>)}</SelectContent></Select> : <Badge className="w-fit capitalize" variant={request.status === "resolved" || request.status === "closed" ? "secondary" : "default"}>{request.status.replaceAll("_", " ")}</Badge>}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
