import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Trophy, Download, Image, Search, RefreshCw, Zap, Calendar, Users,
  Star, CalendarDays, Edit2, X, Instagram, User, Sparkles, Crown, ChevronRight
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { motion, AnimatePresence } from "framer-motion";
import AwardProfilesPanel from "@/components/awards/AwardProfilesPanel";

const PERIODS = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "this_week", label: "This Week" },
  { value: "last_week", label: "Last Week" },
  { value: "this_month", label: "This Month" },
  { value: "last_month", label: "Last Month" },
];

const AWARD_TYPES = [
  { value: "top_producer", label: "🏆 Top Producer", icon: Trophy },
  { value: "leaderboard", label: "📊 Leaderboard", icon: Star },
  { value: "first_deal", label: "🔔 First Deal Today", icon: Zap },
  { value: "top_producer_week", label: "🥇 Top Producer (Week)", icon: Trophy },
  { value: "most_hires_week", label: "👥 Most Hires (Week)", icon: Users },
  { value: "most_hires_month", label: "👥 Most Hires (Month)", icon: Users },
];

const METRICS = [
  { value: "AP", label: "AP (Annual Premium)" },
  { value: "Issue Paid", label: "Issue Paid" },
];

interface AwardBatch {
  id: string;
  created_at: string;
  time_period: string;
  metric_type: string;
  period_start: string;
  period_end: string;
  winner_name: string;
  winner_amount: number;
  award_type: string;
  top_agents: Array<{ rank: number; name: string; amount: number; formatted_amount: string }>;
  top_producer_file: string;
  leaderboard_file: string;
  status: string;
}

function getStorageUrl(path: string | null) {
  if (!path) return null;
  return supabase.storage.from("award-graphics").getPublicUrl(path).data.publicUrl;
}

function getAwardLabel(type: string) {
  return AWARD_TYPES.find(a => a.value === type)?.label || type;
}

function getStatusColor(status: string) {
  if (status === "published") return "bg-emerald-500/15 text-emerald-600 border-emerald-500/20";
  if (status === "data_review_required") return "bg-red-500/15 text-red-600 border-red-500/20";
  return "bg-amber-500/15 text-amber-600 border-amber-500/20";
}

export default function AwardGraphics() {
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState("today");
  const [metric, setMetric] = useState("AP");
  const [awardType, setAwardType] = useState("top_producer");
  const [customDate, setCustomDate] = useState<Date | undefined>();
  const [searchTerm, setSearchTerm] = useState("");
  const [generatedResult, setGeneratedResult] = useState<any>(null);
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);
  const [showProfiles, setShowProfiles] = useState(false);

  const [editName, setEditName] = useState("");
  const [editIG, setEditIG] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [isEditing, setIsEditing] = useState(false);

  const { data: batches, isLoading: archiveLoading } = useQuery({
    queryKey: ["award-batches"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("award_batches")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as unknown as AwardBatch[];
    },
  });

  const generateMutation = useMutation({
    mutationFn: async (params: Record<string, any>) => {
      const { data, error } = await supabase.functions.invoke("generate-award-graphics", { body: params });
      if (error) throw error;
      if (data?.status === "error") throw new Error(data.error);
      if (data?.status === "data_review_required") throw new Error(data.message);
      return data;
    },
    onSuccess: (data) => {
      setGeneratedResult(data);
      setIsEditing(false);
      setEditName(data.top_producer?.name || "");
      setEditIG(data.top_producer?.instagram || "");
      setEditAmount(String(data.top_producer?.amount || ""));
      queryClient.invalidateQueries({ queryKey: ["award-batches"] });
      toast({ title: "Awards Generated! 🏆", description: `Winner: ${data.top_producer?.name}` });
    },
    onError: (err: Error) => {
      toast({ title: "Generation Failed", description: err.message, variant: "destructive" });
    },
  });

  const regenerateMutation = useMutation({
    mutationFn: async (batch: AwardBatch) => {
      const { data, error } = await supabase.functions.invoke("generate-award-graphics", {
        body: { time_period: batch.time_period, metric_type: batch.metric_type, award_type: batch.award_type || "top_producer" },
      });
      if (error) throw error;
      if (data?.status === "error") throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["award-batches"] });
      toast({ title: "Regenerated! 🔄", description: `Winner: ${data.top_producer?.name}` });
    },
    onError: (err: Error) => {
      toast({ title: "Regeneration Failed", description: err.message, variant: "destructive" });
    },
  });

  function handleGenerate() {
    const params: Record<string, any> = {
      time_period: period,
      metric_type: metric,
      award_type: awardType,
    };
    if (customDate) {
      params.custom_date = format(customDate, "yyyy-MM-dd");
    }
    generateMutation.mutate(params);
  }

  function handleRegenerateWithOverrides() {
    const params: Record<string, any> = {
      time_period: period,
      metric_type: metric,
      award_type: awardType,
      overrides: {
        name: editName || undefined,
        instagram: editIG || undefined,
        amount: editAmount ? Number(editAmount) : undefined,
      },
    };
    if (customDate) {
      params.custom_date = format(customDate, "yyyy-MM-dd");
    }
    generateMutation.mutate(params);
  }

  const filteredBatches = (batches || []).filter((b) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      b.winner_name?.toLowerCase().includes(term) ||
      b.time_period?.toLowerCase().includes(term) ||
      b.metric_type?.toLowerCase().includes(term) ||
      (b.award_type || "").toLowerCase().includes(term) ||
      b.top_agents?.some((a) => a.name?.toLowerCase().includes(term))
    );
  });

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-600/20 flex items-center justify-center ring-1 ring-amber-500/20">
            <Crown className="h-6 w-6 text-amber-500" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Award Graphics</h1>
            <p className="text-muted-foreground text-sm">Generate Instagram-ready award graphics from live data</p>
          </div>
        </div>
        <Button
          variant={showProfiles ? "default" : "outline"}
          onClick={() => setShowProfiles(!showProfiles)}
          className={cn("gap-2 transition-all", showProfiles && "bg-primary")}
        >
          <User className="h-4 w-4" />
          Agent Profiles
          <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", showProfiles && "rotate-90")} />
        </Button>
      </div>

      {/* Agent Profiles Panel */}
      <AnimatePresence>
        {showProfiles && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3 }}
          >
            <AwardProfilesPanel />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Generate Panel */}
      <Card className="border-border/40 shadow-lg shadow-black/5 overflow-hidden">
        <CardHeader className="bg-gradient-to-r from-amber-500/5 via-transparent to-transparent border-b border-border/30">
          <CardTitle className="flex items-center gap-2.5 text-lg">
            <div className="h-8 w-8 rounded-lg bg-amber-500/15 flex items-center justify-center">
              <Sparkles className="h-4 w-4 text-amber-500" />
            </div>
            Generate Awards
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-5 space-y-5">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground font-medium">Award Type</label>
              <Select value={awardType} onValueChange={setAwardType}>
                <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {AWARD_TYPES.map((a) => (
                    <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground font-medium">Period</label>
              <Select value={period} onValueChange={(v) => { setPeriod(v); setCustomDate(undefined); }}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PERIODS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground font-medium">Specific Date</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-40 justify-start text-left font-normal", !customDate && "text-muted-foreground")}>
                    <CalendarDays className="h-4 w-4 mr-2" />
                    {customDate ? format(customDate, "MMM d, yyyy") : "Pick date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent mode="single" selected={customDate} onSelect={setCustomDate} className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
              {customDate && (
                <button onClick={() => setCustomDate(undefined)} className="text-xs text-muted-foreground underline ml-1">clear</button>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground font-medium">Metric</label>
              <Select value={metric} onValueChange={setMetric}>
                <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {METRICS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              onClick={handleGenerate}
              disabled={generateMutation.isPending}
              className="bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700 text-white shadow-lg shadow-amber-500/20 transition-all hover:shadow-xl hover:shadow-amber-500/30"
            >
              {generateMutation.isPending ? (
                <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Generating...</>
              ) : (
                <><Image className="h-4 w-4 mr-2" />Generate</>
              )}
            </Button>
          </div>

          {generateMutation.isPending && (
            <div className="grid grid-cols-2 gap-4">
              <Skeleton className="h-[400px] rounded-xl" />
              <Skeleton className="h-[400px] rounded-xl" />
            </div>
          )}

          {/* Generated Result */}
          {generatedResult && !generateMutation.isPending && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-4"
            >
              <div className="flex items-center gap-2 flex-wrap p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
                <Badge className="bg-emerald-600 text-white">Generated</Badge>
                <Badge variant="outline">{getAwardLabel(generatedResult.award_type)}</Badge>
                <span className="text-sm text-muted-foreground">
                  Winner: <strong className="text-foreground">{generatedResult.top_producer?.name}</strong> — <span className="text-emerald-600 font-semibold">{generatedResult.top_producer?.formatted_amount}</span>
                </span>
                <Button variant="ghost" size="sm" onClick={() => setIsEditing(!isEditing)} className="ml-auto gap-1.5 hover:bg-primary/10">
                  <Edit2 className="h-3.5 w-3.5" />{isEditing ? "Cancel" : "Edit & Regenerate"}
                </Button>
              </div>

              {/* Edit Panel */}
              <AnimatePresence>
                {isEditing && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                  >
                    <Card className="border-amber-500/30 bg-amber-500/5">
                      <CardContent className="pt-4">
                        <div className="flex flex-wrap gap-3 items-end">
                          <div className="space-y-1">
                            <label className="text-xs font-medium">Name Override</label>
                            <Input value={editName} onChange={e => setEditName(e.target.value)} placeholder="Display name" className="w-40" />
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs font-medium">Instagram</label>
                            <div className="flex items-center gap-1">
                              <Instagram className="h-4 w-4 text-pink-500" />
                              <Input value={editIG} onChange={e => setEditIG(e.target.value)} placeholder="@handle" className="w-36" />
                            </div>
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs font-medium">Amount</label>
                            <Input value={editAmount} onChange={e => setEditAmount(e.target.value)} placeholder="$" className="w-28" type="number" />
                          </div>
                          <Button onClick={handleRegenerateWithOverrides} disabled={generateMutation.isPending} className="bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700 text-white gap-1.5">
                            <RefreshCw className="h-4 w-4" />Regenerate
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Image Previews */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {generatedResult.files?.top_producer_story && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="space-y-3 group"
                  >
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      {generatedResult.award_type === "first_deal" ? "First Deal Story" : generatedResult.award_type?.includes("hires") ? "Most Hires Story" : "Top Producer Story"}
                    </p>
                    <div className="rounded-xl overflow-hidden border border-border/40 shadow-lg group-hover:shadow-xl transition-shadow cursor-pointer" onClick={() => setFullscreenImage(generatedResult.files.top_producer_story)}>
                      <img
                        src={generatedResult.files.top_producer_story}
                        alt="Award"
                        className="max-h-[500px] w-auto mx-auto hover:scale-[1.01] transition-transform duration-500"
                      />
                    </div>
                    <a href={generatedResult.files.top_producer_story} download target="_blank" rel="noopener noreferrer">
                      <Button variant="outline" size="sm" className="w-full gap-2 hover:bg-primary/5">
                        <Download className="h-4 w-4" />Download
                      </Button>
                    </a>
                  </motion.div>
                )}
                {generatedResult.files?.leaderboard_story && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.1 }}
                    className="space-y-3 group"
                  >
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Leaderboard Story</p>
                    <div className="rounded-xl overflow-hidden border border-border/40 shadow-lg group-hover:shadow-xl transition-shadow cursor-pointer" onClick={() => setFullscreenImage(generatedResult.files.leaderboard_story)}>
                      <img
                        src={generatedResult.files.leaderboard_story}
                        alt="Leaderboard"
                        className="max-h-[500px] w-auto mx-auto hover:scale-[1.01] transition-transform duration-500"
                      />
                    </div>
                    <a href={generatedResult.files.leaderboard_story} download target="_blank" rel="noopener noreferrer">
                      <Button variant="outline" size="sm" className="w-full gap-2 hover:bg-primary/5">
                        <Download className="h-4 w-4" />Download
                      </Button>
                    </a>
                  </motion.div>
                )}
              </div>
            </motion.div>
          )}
        </CardContent>
      </Card>

      {/* Archive */}
      <Card className="border-border/40 shadow-lg shadow-black/5">
        <CardHeader className="border-b border-border/30">
          <CardTitle className="flex items-center gap-2.5 text-lg">
            <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Calendar className="h-4 w-4 text-primary" />
            </div>
            Awards Archive
            {batches && (
              <Badge variant="secondary" className="ml-2 text-xs">{batches.length} awards</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-5 space-y-4">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search by agent, period, type..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9" />
          </div>

          {archiveLoading ? (
            <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
          ) : filteredBatches.length === 0 ? (
            <div className="py-12 text-center">
              <Trophy className="h-10 w-10 mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">No awards found. Generate your first award above!</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border/30">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead className="text-xs font-semibold">Date</TableHead>
                    <TableHead className="text-xs font-semibold">Type</TableHead>
                    <TableHead className="text-xs font-semibold">Period</TableHead>
                    <TableHead className="text-xs font-semibold">Winner</TableHead>
                    <TableHead className="text-xs font-semibold">Amount</TableHead>
                    <TableHead className="text-xs font-semibold">Status</TableHead>
                    <TableHead className="text-xs font-semibold">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredBatches.map((batch) => (
                    <TableRow key={batch.id} className="hover:bg-muted/20 transition-colors">
                      <TableCell className="text-xs text-muted-foreground">{format(new Date(batch.created_at), "MMM d, yyyy h:mm a")}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-[10px]">{getAwardLabel(batch.award_type)}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px] capitalize">{batch.time_period?.replace(/_/g, " ")}</Badge>
                      </TableCell>
                      <TableCell className="font-bold text-sm">{batch.winner_name}</TableCell>
                      <TableCell className="text-emerald-600 font-bold text-sm">
                        {batch.award_type?.includes("hires") ? `${batch.winner_amount} hires` : `$${Math.round(batch.winner_amount || 0).toLocaleString()}`}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn("text-[10px]", getStatusColor(batch.status))}>
                          {batch.status?.replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {batch.top_producer_file && (
                            <a href={getStorageUrl(batch.top_producer_file) || "#"} target="_blank" rel="noopener noreferrer">
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 hover:bg-primary/10"><Download className="h-3.5 w-3.5" /></Button>
                            </a>
                          )}
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 hover:bg-primary/10" onClick={() => regenerateMutation.mutate(batch)} disabled={regenerateMutation.isPending}>
                            <RefreshCw className={cn("h-3.5 w-3.5", regenerateMutation.isPending && "animate-spin")} />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Fullscreen Image Dialog */}
      <Dialog open={!!fullscreenImage} onOpenChange={() => setFullscreenImage(null)}>
        <DialogContent className="max-w-[95vw] max-h-[95vh] p-2 bg-black/95 border-border/20">
          {fullscreenImage && (
            <div className="flex flex-col items-center gap-3">
              <img src={fullscreenImage} alt="Award fullscreen" className="max-h-[85vh] w-auto rounded-lg" />
              <a href={fullscreenImage} download target="_blank" rel="noopener noreferrer">
                <Button className="gap-2 bg-gradient-to-r from-amber-600 to-orange-600 text-white">
                  <Download className="h-4 w-4" />Download
                </Button>
              </a>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
