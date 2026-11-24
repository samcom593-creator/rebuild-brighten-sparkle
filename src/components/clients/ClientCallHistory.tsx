import { useEffect, useId, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FileText, LockKeyhole, PhoneCall } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { looseSupabase } from "@/lib/looseSupabase";
import { externalHref } from "@/lib/externalHref";
import { CALL_CATEGORIES, clientCallsSchema, type ClientCall, type ClientCallCategory } from "@/lib/producerWorkspace";

const selectClass = "min-h-11 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
type Cursor = { at: string; key: string } | null;

function callDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Phoenix" }).format(new Date(value));
}

function CallRecord({ call, rawAccess, onCategory, pending }: {
  call: ClientCall; rawAccess: boolean; onCategory: (call: ClientCall, category: ClientCallCategory) => void; pending: boolean;
}) {
  const [category, setCategory] = useState(call.category);
  const categoryId = useId();
  useEffect(() => setCategory(call.category), [call.category]);
  // Check both response-level and row-level permissions before rendering text or URLs.
  const restricted = call.transcript_access === "restricted" || (call.source === "readymode" && !rawAccess);
  const transcript = !restricted && call.transcript_access === "available" ? call.transcript : null;
  const recording = !restricted && rawAccess && call.source === "readymode" ? externalHref(call.audio_url) : null;
  return (
    <li className="space-y-3 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{call.outcome || "Call recorded"}</p>
          <p className="text-xs text-muted-foreground">{callDate(call.happened_at)} · {call.source === "readymode" ? "ReadyMode" : "Saved transcript"}{call.duration_seconds !== null ? ` · ${Math.floor(call.duration_seconds / 60)}m ${Math.floor(call.duration_seconds % 60)}s` : ""}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor={categoryId} className="sr-only">Category for {call.outcome || "recorded call"}</Label>
          <select id={categoryId} className={selectClass} value={category} onChange={(e) => setCategory(e.target.value as ClientCallCategory)} disabled={pending}>
            {CALL_CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          {category !== call.category && <Button type="button" variant="outline" disabled={pending} onClick={() => onCategory(call, category)}>{pending ? "Saving…" : "Save category"}</Button>}
        </div>
      </div>
      {restricted ? (
        <p className="flex gap-2 text-sm text-muted-foreground"><LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />Raw provider transcripts and audio require existing call-access permission. Call details and categories remain available.</p>
      ) : transcript ? (
        <details><summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">Read transcript</summary><p className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-3 text-sm">{transcript}</p></details>
      ) : <p className="text-sm text-muted-foreground">A transcript has not been recorded for this call.</p>}
      {recording && <a className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4" href={recording} target="_blank" rel="noopener noreferrer">Open recording</a>}
    </li>
  );
}

export function ClientCallHistory({ clientId }: { clientId: string }) {
  const { user } = useAuth();
  return <ClientHistoryWorkspace key={`${user?.id ?? "signed-out"}:${clientId}`} clientId={clientId} />;
}

function ClientHistoryWorkspace({ clientId }: { clientId: string }) {
  const { user } = useAuth();
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const qc = useQueryClient();
  const formId = useId();
  const [filter, setFilter] = useState<ClientCallCategory | "all">("all");
  const [category, setCategory] = useState<ClientCallCategory>("discovery");
  const [transcript, setTranscript] = useState("");
  const [outcome, setOutcome] = useState("");
  const history = useInfiniteQuery({
    // User identity is part of the key, so an account change cannot reuse another login's transcript cache.
    queryKey: ["producer-client-calls", clientId, user?.id, filter],
    enabled: Boolean(user?.id), staleTime: 60_000, retry: false,
    initialPageParam: null as Cursor,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await looseSupabase.rpc("producer_client_calls", {
        p_client_id: clientId, p_category: filter === "all" ? null : filter,
        p_before_at: pageParam?.at ?? null, p_before_key: pageParam?.key ?? null,
      });
      if (error) throw error;
      const result = clientCallsSchema.parse(data);
      if (result.client_id !== clientId) throw new Error("Client history could not be verified.");
      return result;
    },
    getNextPageParam: (last) => last.next_cursor,
  });
  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["producer-client-calls", clientId] }),
      qc.invalidateQueries({ queryKey: ["client-pipeline-activity", clientId] }),
    ]);
  };
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await looseSupabase.rpc("producer_save_client_transcript", {
        p_client_id: clientId, p_transcript: transcript.trim(), p_category: category, p_outcome: outcome.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      if (active.current) {
        setTranscript(""); setOutcome(""); setFilter("all");
        toast.success("Transcript saved to this client.");
      }
      await refresh();
    },
    onError: (e: Error) => { if (active.current) toast.error(e.message || "Transcript could not be saved."); },
  });
  const tag = useMutation({
    mutationFn: async ({ call, value }: { call: ClientCall; value: ClientCallCategory }) => {
      const { error } = await looseSupabase.rpc("producer_tag_client_call", { p_client_id: clientId, p_source: call.source, p_source_id: call.source_id, p_category: value });
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: (e: Error) => { if (active.current) toast.error(e.message || "Call category could not be saved."); },
  });
  const pages = history.data?.pages ?? [];
  const calls = pages.flatMap((page) => page.calls);
  const denied = history.isError && /access denied|permission denied/i.test(history.error?.message ?? "");
  return (
    <section aria-label="Client calls and transcripts" className="space-y-4 rounded-md border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><PhoneCall className="h-4 w-4" aria-hidden="true" /> Calls and transcripts</h3>
        <div className="flex items-center gap-2">
          <Label htmlFor={`${formId}-filter`}>Show</Label>
          <select id={`${formId}-filter`} value={filter} onChange={(e) => setFilter(e.target.value as ClientCallCategory | "all")} className={selectClass}>
            <option value="all">All categories</option>
            {CALL_CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </div>
      </div>
      {!user ? <p className="text-sm text-muted-foreground">Sign in to view this client’s history.</p> : history.isPending ? <Skeleton className="h-28 w-full" aria-label="Loading client calls" /> : history.isError ? (
        <div role="alert" className="space-y-2">
          <p className="text-sm">{denied ? "This call history is available to the client’s producer and authorized administrators. Your current account does not have access." : "Client calls could not be loaded. Saved history is hidden until access and data are verified."}</p>
          <Button variant="outline" onClick={() => void history.refetch()}>Retry history</Button>
        </div>
      ) : <>
        <p className="text-xs text-muted-foreground">Calls are matched within this producer’s own clients. Dates use Phoenix time.</p>
        {pages.some((page) => page.ambiguous_phone) && <p role="status" className="rounded-md bg-muted p-3 text-sm">This number is shared by multiple clients. Automatic call matching is paused to keep their histories separate; saved transcripts remain attached to this client.</p>}
        {calls.length === 0 ? <p className="text-sm text-muted-foreground">{filter === "all" ? "No calls or saved transcripts have been matched to this client." : "No calls are in this category."}</p> : (
          <ol className="space-y-3">{pages.flatMap((page) => page.calls.map((call) => <CallRecord key={call.key} call={call} rawAccess={page.raw_provider_access} onCategory={(item, value) => tag.mutate({ call: item, value })} pending={tag.isPending && tag.variables?.call.key === call.key} />))}</ol>
        )}
        {history.hasNextPage && <Button variant="outline" disabled={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()}>{history.isFetchingNextPage ? "Loading…" : "Load earlier calls"}</Button>}
        <details className="rounded-lg border border-border p-3">
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium"><FileText className="mr-2 inline h-4 w-4" aria-hidden="true" />Save a client transcript</summary>
          <form className="space-y-3 pt-2" onSubmit={(e) => { e.preventDefault(); if (!save.isPending && transcript.trim().length >= 10) save.mutate(); }}>
            <p className="text-xs text-muted-foreground">Paste an existing transcript. Saving does not transcribe audio or generate an AI analysis. Omit bank account and Social Security numbers.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor={`${formId}-category`}>Transcript category</Label><select id={`${formId}-category`} className={`${selectClass} w-full`} value={category} onChange={(e) => setCategory(e.target.value as ClientCallCategory)} disabled={save.isPending}>{CALL_CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
              <div className="space-y-1.5"><Label htmlFor={`${formId}-outcome`}>Outcome (optional)</Label><Input id={`${formId}-outcome`} value={outcome} maxLength={160} onChange={(e) => setOutcome(e.target.value)} disabled={save.isPending} /></div>
            </div>
            <div className="space-y-1.5"><Label htmlFor={`${formId}-transcript`}>Transcript</Label><Textarea id={`${formId}-transcript`} className="min-h-36" value={transcript} minLength={10} maxLength={100000} required onChange={(e) => setTranscript(e.target.value)} disabled={save.isPending} /></div>
            <Button type="submit" disabled={save.isPending || transcript.trim().length < 10}>{save.isPending ? "Saving…" : "Save transcript"}</Button>
          </form>
        </details>
      </>}
    </section>
  );
}
