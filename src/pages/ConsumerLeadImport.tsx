import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/ui/page-header";
import { EthosConsumerCampaignPanel } from "@/components/leads/EthosConsumerCampaignPanel";
import { CONSUMER_IMPORT_SOURCES, consumerImportHistorySchema, consumerImportIssueLabel, consumerImportReceiptSchema, consumerImportReviewSchema, parseConsumerTable, prepareConsumerImport, type ConsumerImportLayout, type ConsumerImportReceipt } from "@/lib/consumerLeadImport";

export default function ConsumerLeadImport() {
  const { user } = useAuth();
  if (!user) return <div className="space-y-4 p-4 md:p-6"><PageHeader title="Consumer intake" /><p role="status">Sign in to review and import consumer sources.</p></div>;
  return <ConsumerImportWorkspace key={user.id} userId={user.id} />;
}

function ConsumerImportWorkspace({ userId }: { userId: string }) {
  const [layout, setLayout] = useState<ConsumerImportLayout>("master_pos");
  const [input, setInput] = useState("");
  const [preview, setPreview] = useState<ReturnType<typeof prepareConsumerImport> | null>(null);
  const [receipts, setReceipts] = useState<ConsumerImportReceipt[]>([]);
  const [busy, setBusy] = useState(false);
  const [readingFile, setReadingFile] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [campaignBatch, setCampaignBatch] = useState("");
  const active = useRef(true);
  const fileRead = useRef(0);
  useEffect(() => { active.current = true; return () => { active.current = false; fileRead.current++; }; }, []);
  const queryClient = useQueryClient();
  const source = CONSUMER_IMPORT_SOURCES[layout];
  const history = useQuery({queryKey: ["consumer-import-batches", userId], retry: 1, queryFn: async () => {
    const {data,error} = await supabase.rpc("consumer_import_history",{p_limit:40});
    if(error) throw new Error(error.message);
    const parsed = consumerImportHistorySchema.safeParse(data);
    if(!parsed.success) throw new Error("Import history returned an invalid response.");
    return parsed.data;
  }});
  const review = useQuery({queryKey:["consumer-import-review", userId],retry:1,queryFn:async()=>{
    const {data,error}=await supabase.rpc("consumer_import_review",{p_limit:50});
    if(error) throw new Error(error.message);
    const parsed = consumerImportReviewSchema.safeParse(data);
    if(!parsed.success) throw new Error("Import review returned an invalid response.");
    return parsed.data;
  }});
  const resetPreview = () => {setPreview(null);setReceipts([]);setError(null);setProgress(0);};
  const selectLayout = (value: string) => {
    fileRead.current++; setReadingFile(false); setLayout(value as ConsumerImportLayout); setInput(""); resetPreview();
  };
  const readFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const version = ++fileRead.current;
    resetPreview(); setInput(""); setReadingFile(true);
    try {
      if (file.size > 15_000_000) throw new Error("Use a file under 15 MB.");
      const text = await file.text();
      if (active.current && fileRead.current === version) setInput(text);
    } catch (e) {
      if (active.current && fileRead.current === version) setError(e instanceof Error ? e.message : "The file could not be read.");
    } finally {
      if (active.current && fileRead.current === version) setReadingFile(false);
    }
  };
  const inspect = () => {
    try {const p=prepareConsumerImport(parseConsumerTable(input),layout);if(!p.rows.length)throw new Error("No consumer rows found.");setPreview(p);setError(null);setReceipts([]);setProgress(0);}
    catch(e){setError(e instanceof Error?e.message:"The source could not be parsed.");setPreview(null);}
  };
  const importRows = async () => {
    if(!preview || busy) return;
    setBusy(true);setError(null);setReceipts([]);setProgress(0);
    try {
      for(let start=0;start<preview.rows.length;start+=250){
        if(!active.current) return;
        const {data,error}=await supabase.rpc("consumer_lead_import",{p_source_key:source.key,p_source_name:source.label,p_source_kind:source.kind,p_rows:preview.rows.slice(start,start+250)});
        if(!active.current) return;
        if(error)throw new Error(error.message);
        const result=consumerImportReceiptSchema.safeParse(data);
        if(!result.success || result.data.received!==Math.min(250,preview.rows.length-start))throw new Error("Import did not return a verified receipt. Retry to check the same batch safely.");
        const receipt=result.data;
        setReceipts(previous=>[...previous,receipt]);setProgress(Math.min(start+250,preview.rows.length));
      }
      setInput("");
    }catch(e){if(active.current)setError(`${e instanceof Error?e.message:"Import interrupted."} Completed chunks retain their receipts. Retrying this preview will not duplicate them.`);}
    finally{if(active.current){setBusy(false);await queryClient.invalidateQueries({queryKey:["consumer-import-batches",userId]});await queryClient.invalidateQueries({queryKey:["consumer-import-review",userId]});await queryClient.invalidateQueries({queryKey:["lead-pool"]});}}
  };
  const totals=receipts.reduce((acc,r)=>({imported:acc.imported+r.imported,matched:acc.matched+r.matched,review:acc.review+r.review,duplicate:acc.duplicate+r.duplicate,suppressed:acc.suppressed+r.suppressed}),{imported:0,matched:0,review:0,duplicate:0,suppressed:0});
  const currentBatch = !history.isError && history.data?.some(batch => batch.id === campaignBatch) ? campaignBatch : "";

  return <div className="space-y-6 p-4 md:p-6 max-w-7xl mx-auto">
    <Button variant="ghost" size="sm" asChild><Link to="/dashboard/lead-manager">Back to Lead Manager</Link></Button>
    <PageHeader title="Consumer intake" subtitle="Bring policy-owner and mortgage files into the lead workflow with source history and a review receipt."/>
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(260px,1fr)]">
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5"/>Review a source</CardTitle></CardHeader><CardContent className="space-y-4">
        <div className="space-y-2"><Label htmlFor="consumer-source">Source layout</Label><Select value={layout} onValueChange={selectLayout} disabled={busy}><SelectTrigger id="consumer-source"><SelectValue/></SelectTrigger><SelectContent>{Object.entries(CONSUMER_IMPORT_SOURCES).map(([key,s])=><SelectItem key={key} value={key}>{s.label}</SelectItem>)}</SelectContent></Select></div>
        <p className="text-sm text-muted-foreground">Use CSV or TSV exported from this source, or paste its spreadsheet cells. Keep the first consumer row. Embedded mortgage headers are recognized automatically.</p>
        <Input aria-label="Upload consumer spreadsheet export" type="file" accept=".csv,.tsv,.txt,.json" disabled={busy} onChange={readFile}/>
        <Textarea aria-label="Consumer spreadsheet rows" className="min-h-44 font-mono text-sm" value={input} disabled={busy} placeholder="Paste spreadsheet rows or a CSV export" onChange={e=>{fileRead.current++;setReadingFile(false);setInput(e.target.value);resetPreview();}}/>
        {readingFile && <p role="status" className="text-sm text-muted-foreground">Reading the selected file…</p>}
        <Button onClick={inspect} disabled={!input.trim()||busy||readingFile}><FileSpreadsheet className="h-4 w-4 mr-2"/>Preview mapping</Button>
        {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
        {preview&&<div className="space-y-4 border-t pt-4">
          <div className="flex flex-wrap gap-2"><Badge variant="secondary">{preview.rows.length.toLocaleString()} source rows</Badge><Badge variant="outline">{preview.review} need review</Badge><Badge variant="outline">{preview.suppressed} contact stops</Badge><Badge variant="outline">{preview.headersSkipped} headers skipped</Badge></div>
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left border-b"><th className="p-2">Row / consumer</th><th className="p-2">State</th><th className="p-2">Context</th><th className="p-2">Review</th></tr></thead><tbody>{preview.rows.slice(0,8).map(r=><tr key={r.source_row} className="border-b"><td className="p-2">{r.source_row}. {r.first_name} {r.last_name}</td><td className="p-2">{r.state||"Unknown"}</td><td className="p-2">{source.kind==="pos"?`${r.policy_carrier||"Carrier unknown"} · source policy`:`${r.loan_type||"Loan"} · mortgage`}</td><td className="p-2">{r.dnc?"Contact stop":r.issues.map(consumerImportIssueLabel).join(", ")||"Ready for matching"}</td></tr>)}</tbody></table></div>
          <p className="text-xs text-muted-foreground">The server checks existing contacts and restrictions again. Uncertain identity or missing state goes into review. Policy claims remain supplier-reported; production and email are separate actions.</p>
          <Button onClick={importRows} disabled={busy||progress===preview.rows.length}>{busy?<Loader2 className="h-4 w-4 mr-2 animate-spin"/>:<Upload className="h-4 w-4 mr-2"/>}{busy?`Importing ${progress} / ${preview.rows.length}`:progress===preview.rows.length?"Import complete":"Import reviewed source"}</Button>
        </div>}
      </CardContent></Card>
      <div className="space-y-6"><Card><CardHeader><CardTitle>Import receipt</CardTitle></CardHeader><CardContent className="space-y-3">{receipts.length?<><CheckCircle2 className="h-6 w-6 text-emerald-500"/><p>{totals.imported} new contacts · {totals.matched} existing contacts matched</p><p>{totals.review} held for review · {totals.duplicate} duplicate rows skipped</p><p>{totals.suppressed} contact stops preserved</p><p className="text-xs text-muted-foreground">{progress} rows processed. Lead pool counts update at the next scheduled refresh. Repeated chunks return their original receipt.</p></>:<p className="text-sm text-muted-foreground">A receipt appears after each successful chunk. A connection failure can be retried without inserting the same source rows twice.</p>}</CardContent></Card>
      <Card><CardHeader><CardTitle>Source meaning</CardTitle></CardHeader><CardContent className="space-y-3 text-sm text-muted-foreground"><p>Policy-owner files describe previous coverage. Source status and policy dates stay attached for verification and follow-up.</p><p>Unlabeled policy amounts keep an unknown payment frequency. Mortgage balances remain loan amounts.</p><p>Consumers with conflicting identity, missing state or invalid contact data remain in the review queue.</p></CardContent></Card></div>
    </div>
    <Card><CardHeader><CardTitle>Needs review</CardTitle></CardHeader><CardContent>{review.isError?<div role="alert" className="space-y-2"><p className="text-sm text-destructive">The review queue could not be verified.</p><Button variant="outline" disabled={review.isFetching} onClick={()=>void review.refetch()}>Retry review queue</Button></div>:review.isLoading?<p role="status">Loading review queue…</p>:review.data?.length?<><p className="text-sm text-muted-foreground mb-3">Showing up to 50 unresolved rows. Correct the listed cells in the original source, keeping its row order, then preview that source again. Original receipts remain in history.</p><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left border-b"><th className="p-2">Consumer</th><th className="p-2">Source / row</th><th className="p-2">Reason</th></tr></thead><tbody>{review.data.map(r=><tr key={r.id} className="border-b"><td className="p-2">{r.payload.first_name} {r.payload.last_name}</td><td className="p-2">{r.source_name || "Source unavailable"} · row {r.source_row}</td><td className="p-2">{r.issues.map(consumerImportIssueLabel).join(" · ")}</td></tr>)}</tbody></table></div></>:<p className="text-sm text-muted-foreground">No held consumer rows.</p>}</CardContent></Card>
    <Card><CardHeader><CardTitle>Recent source receipts</CardTitle></CardHeader><CardContent>{history.isError?<div role="alert" className="space-y-2"><p className="text-sm text-destructive">Import receipts could not be verified.</p><Button variant="outline" disabled={history.isFetching} onClick={()=>void history.refetch()}>Retry import receipts</Button></div>:history.isLoading?<p role="status">Loading import receipts…</p>:history.data?.length?<div className="space-y-3">{history.data.map(b=><div key={b.id} className="flex flex-wrap justify-between gap-2 border-b pb-2 text-sm"><span>{b.source_name}</span><span>{b.receipt.imported} imported · {b.receipt.matched} matched · {b.receipt.review} review</span><time dateTime={b.created_at}>{new Date(b.created_at).toLocaleDateString("en-US",{timeZone:"America/Phoenix"})}</time></div>)}</div>:<p className="text-sm text-muted-foreground">No consumer source receipts yet. Preview a source above to begin.</p>}</CardContent></Card>
    {!history.isError && history.data?.length ? <div className="space-y-4"><div className="max-w-xl space-y-2"><Label htmlFor="campaign-import-source">Coverage invitation source</Label><Select value={currentBatch} onValueChange={setCampaignBatch}><SelectTrigger id="campaign-import-source"><SelectValue placeholder="Select an imported source receipt"/></SelectTrigger><SelectContent>{history.data.map(b=><SelectItem key={b.id} value={b.id}>{b.source_name} · {new Date(b.created_at).toLocaleString("en-US",{timeZone:"America/Phoenix"})} · {b.receipt.received} rows</SelectItem>)}</SelectContent></Select></div>{currentBatch?<EthosConsumerCampaignPanel key={currentBatch} sourceBatchId={currentBatch}/>:null}</div>:null}
  </div>;
}
