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
import { Trophy, Download, Image, Search, RefreshCw, Zap, Calendar } from "lucide-react";
import { format } from "date-fns";

const PERIODS = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "this_week", label: "This Week" },
  { value: "last_week", label: "Last Week" },
  { value: "this_month", label: "This Month" },
  { value: "last_month", label: "Last Month" },
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
  top_agents: Array<{ rank: number; name: string; amount: number; formatted_amount: string }>;
  top_producer_file: string;
  leaderboard_file: string;
  status: string;
}

function getStorageUrl(path: string | null) {
  if (!path) return null;
  return supabase.storage.from("award-graphics").getPublicUrl(path).data.publicUrl;
}

export default function AwardGraphics() {
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState("today");
  const [metric, setMetric] = useState("AP");
  const [searchTerm, setSearchTerm] = useState("");
  const [generatedResult, setGeneratedResult] = useState<any>(null);

  // Fetch archive
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

  // Generate mutation
  const generateMutation = useMutation({
    mutationFn: async (params: { time_period: string; metric_type: string }) => {
      const { data, error } = await supabase.functions.invoke("generate-award-graphics", {
        body: params,
      });
      if (error) throw error;
      if (data?.status === "error") throw new Error(data.error);
      if (data?.status === "data_review_required") throw new Error(data.message);
      return data;
    },
    onSuccess: (data) => {
      setGeneratedResult(data);
      queryClient.invalidateQueries({ queryKey: ["award-batches"] });
      toast({ title: "Awards Generated! 🏆", description: `Top producer: ${data.top_producer?.name}` });
    },
    onError: (err: Error) => {
      toast({ title: "Generation Failed", description: err.message, variant: "destructive" });
    },
  });

  // Regenerate mutation
  const regenerateMutation = useMutation({
    mutationFn: async (batch: AwardBatch) => {
      const { data, error } = await supabase.functions.invoke("generate-award-graphics", {
        body: {
          time_period: batch.time_period,
          metric_type: batch.metric_type,
        },
      });
      if (error) throw error;
      if (data?.status === "error") throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["award-batches"] });
      toast({ title: "Regenerated! 🔄", description: `Top producer: ${data.top_producer?.name}` });
    },
    onError: (err: Error) => {
      toast({ title: "Regeneration Failed", description: err.message, variant: "destructive" });
    },
  });

  const filteredBatches = (batches || []).filter((b) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      b.winner_name?.toLowerCase().includes(term) ||
      b.time_period?.toLowerCase().includes(term) ||
      b.metric_type?.toLowerCase().includes(term) ||
      b.top_agents?.some((a) => a.name?.toLowerCase().includes(term))
    );
  });

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Trophy className="h-8 w-8 text-yellow-500" />
        <div>
          <h1 className="text-2xl font-bold">Award Graphics</h1>
          <p className="text-muted-foreground text-sm">
            Generate Instagram-ready award graphics from live production data
          </p>
        </div>
      </div>

      {/* Generate Panel */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Zap className="h-5 w-5 text-yellow-500" />
            Generate Awards
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium">Period</label>
              <Select value={period} onValueChange={setPeriod}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PERIODS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium">Metric</label>
              <Select value={metric} onValueChange={setMetric}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {METRICS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={() => generateMutation.mutate({ time_period: period, metric_type: metric })}
              disabled={generateMutation.isPending}
              className="bg-yellow-600 hover:bg-yellow-700 text-white"
            >
              {generateMutation.isPending ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Image className="h-4 w-4 mr-2" />
                  Generate Awards
                </>
              )}
            </Button>
          </div>

          {generateMutation.isPending && (
            <div className="grid grid-cols-2 gap-4">
              <Skeleton className="h-[400px] rounded-xl" />
              <Skeleton className="h-[400px] rounded-xl" />
            </div>
          )}

          {/* Preview generated images */}
          {generatedResult && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge className="bg-green-600">Generated</Badge>
                <span className="text-sm text-muted-foreground">
                  Winner: <strong>{generatedResult.top_producer?.name}</strong> —{" "}
                  {generatedResult.top_producer?.formatted_amount}
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Top Producer Story</p>
                  <img
                    src={generatedResult.files?.top_producer_story}
                    alt="Top Producer"
                    className="rounded-lg border max-h-[500px] w-auto mx-auto"
                  />
                  <a
                    href={generatedResult.files?.top_producer_story}
                    download
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Button variant="outline" size="sm" className="w-full">
                      <Download className="h-4 w-4 mr-2" />
                      Download Top Producer
                    </Button>
                  </a>
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Leaderboard Story</p>
                  <img
                    src={generatedResult.files?.leaderboard_story}
                    alt="Leaderboard"
                    className="rounded-lg border max-h-[500px] w-auto mx-auto"
                  />
                  <a
                    href={generatedResult.files?.leaderboard_story}
                    download
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Button variant="outline" size="sm" className="w-full">
                      <Download className="h-4 w-4 mr-2" />
                      Download Leaderboard
                    </Button>
                  </a>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Archive */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Calendar className="h-5 w-5" />
            Awards Archive
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by agent, period, metric..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>

          {archiveLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : filteredBatches.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No awards found. Generate your first award graphic above!
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead>Metric</TableHead>
                    <TableHead>Winner</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredBatches.map((batch) => (
                    <TableRow key={batch.id}>
                      <TableCell className="text-xs">
                        {format(new Date(batch.created_at), "MMM d, yyyy h:mm a")}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {batch.time_period?.replace("_", " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{batch.metric_type}</TableCell>
                      <TableCell className="font-semibold text-sm">{batch.winner_name}</TableCell>
                      <TableCell className="text-green-600 font-bold">
                        ${Math.round(batch.winner_amount || 0).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={
                            batch.status === "published"
                              ? "bg-green-600"
                              : batch.status === "data_review_required"
                              ? "bg-red-600"
                              : "bg-yellow-600"
                          }
                        >
                          {batch.status?.replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {batch.top_producer_file && (
                            <a
                              href={getStorageUrl(batch.top_producer_file) || "#"}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <Button variant="ghost" size="sm">
                                <Download className="h-3 w-3" />
                              </Button>
                            </a>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => regenerateMutation.mutate(batch)}
                            disabled={regenerateMutation.isPending}
                          >
                            <RefreshCw className={`h-3 w-3 ${regenerateMutation.isPending ? "animate-spin" : ""}`} />
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
    </div>
  );
}
