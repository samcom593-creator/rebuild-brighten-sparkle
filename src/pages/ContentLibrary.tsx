import { useState, useEffect, useRef, useCallback } from "react";
import { Search, Download, Upload, Trash2, Plus, Image, Video, Tag, X, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { BackgroundGlow } from "@/components/ui/BackgroundGlow";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

interface ContentItem {
  id: string;
  title: string;
  description: string | null;
  tags: string[];
  storage_path: string;
  file_type: string;
  created_at: string;
  publicUrl: string;
}

const TAG_OPTIONS = ["social", "training", "testimonial", "product", "team", "scripts", "sales", "recap"];

const AWARD_TEMPLATES = [
  { id: "deal_closed", label: "💰 Deal Closed", gradient: ["#10b981", "#059669"], subtitle: "CLOSED A DEAL" },
  { id: "weekly_top", label: "🏆 Weekly Top Producer", gradient: ["#f59e0b", "#d97706"], subtitle: "TOP PRODUCER" },
  { id: "streak", label: "🔥 Streak Achievement", gradient: ["#ef4444", "#dc2626"], subtitle: "ON FIRE" },
  { id: "monthly_elite", label: "⭐ Monthly Elite", gradient: ["#8b5cf6", "#7c3aed"], subtitle: "ELITE STATUS" },
  { id: "first_deal", label: "🎉 First Deal", gradient: ["#3b82f6", "#2563eb"], subtitle: "FIRST DEAL EVER" },
];

export default function ContentLibrary() {
  const { isAdmin, isManager } = useAuth();
  const canManage = isAdmin || isManager;
  const [search, setSearch] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [content, setContent] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Upload state
  const [uploading, setUploading] = useState(false);
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadTag, setUploadTag] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Award state
  const [selectedTemplate, setSelectedTemplate] = useState(AWARD_TEMPLATES[0]);
  const [awardAgentName, setAwardAgentName] = useState("");
  const [awardAmount, setAwardAmount] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [agents, setAgents] = useState<Array<{ id: string; name: string; avatarUrl?: string }>>([]);

  const fetchContent = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("content_library")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      setContent([]);
    } else {
      const items: ContentItem[] = (data || []).map((item: any) => {
        const { data: urlData } = supabase.storage
          .from("content-library")
          .getPublicUrl(item.storage_path);
        return {
          ...item,
          publicUrl: urlData?.publicUrl || "",
        };
      });
      setContent(items);
    }
    setLoading(false);
  }, []);

  const fetchAgents = useCallback(async () => {
    const { data: agentsData } = await supabase
      .from("agents")
      .select("id, user_id, display_name, is_deactivated")
      .eq("is_deactivated", false);

    if (!agentsData) return;

    const userIds = agentsData.map(a => a.user_id).filter(Boolean);
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, full_name, avatar_url")
      .in("user_id", userIds);

    const result = agentsData.map(a => {
      const p = profiles?.find(pr => pr.user_id === a.user_id);
      return {
        id: a.id,
        name: a.display_name || p?.full_name || "Unknown",
        avatarUrl: p?.avatar_url || undefined,
      };
    });
    setAgents(result);
  }, []);

  useEffect(() => {
    fetchContent();
    fetchAgents();
  }, [fetchContent, fetchAgents]);

  const allTags = [...new Set(content.flatMap(c => c.tags || []))];

  const filtered = content.filter(c => {
    const matchesSearch = !search || c.title.toLowerCase().includes(search.toLowerCase());
    const matchesTag = !activeTag || (c.tags || []).includes(activeTag);
    return matchesSearch && matchesTag;
  });

  const handleUpload = async () => {
    if (!uploadFile || !uploadTitle.trim()) {
      toast.error("Please provide a file and title");
      return;
    }

    setUploading(true);
    try {
      const ext = uploadFile.name.split(".").pop() || "bin";
      const path = `${Date.now()}_${uploadTitle.replace(/\s+/g, "_").toLowerCase()}.${ext}`;

      const { error: storageError } = await supabase.storage
        .from("content-library")
        .upload(path, uploadFile);

      if (storageError) throw storageError;

      const fileType = uploadFile.type.startsWith("video") ? "video" : "image";
      const tags = uploadTag ? [uploadTag] : [];

      const { error: dbError } = await supabase.from("content_library").insert({
        title: uploadTitle.trim(),
        storage_path: path,
        file_type: fileType,
        tags,
      });

      if (dbError) throw dbError;

      toast.success("Content uploaded!");
      setShowUploadDialog(false);
      setUploadTitle("");
      setUploadTag("");
      setUploadFile(null);
      fetchContent();
    } catch (err: any) {
      console.error(err);
      toast.error("Upload failed: " + (err.message || "Unknown error"));
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (item: ContentItem) => {
    if (!confirm(`Delete "${item.title}"?`)) return;
    try {
      await supabase.storage.from("content-library").remove([item.storage_path]);
      await supabase.from("content_library").delete().eq("id", item.id);
      toast.success("Deleted");
      fetchContent();
    } catch {
      toast.error("Failed to delete");
    }
  };

  const handleDownload = (item: ContentItem) => {
    const a = document.createElement("a");
    a.href = item.publicUrl;
    a.download = item.title;
    a.target = "_blank";
    a.click();
  };

  // Award canvas rendering
  const renderAward = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = 1080;
    canvas.height = 1080;

    // Background gradient
    const grad = ctx.createLinearGradient(0, 0, 1080, 1080);
    grad.addColorStop(0, selectedTemplate.gradient[0]);
    grad.addColorStop(1, selectedTemplate.gradient[1]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1080, 1080);

    // Dark overlay
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(0, 0, 1080, 1080);

    // APEX branding
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 36px 'Syne', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("APEX FINANCIAL", 540, 100);

    // Subtitle
    ctx.font = "bold 28px 'Syne', sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillText(selectedTemplate.subtitle, 540, 160);

    // Emoji
    ctx.font = "120px serif";
    ctx.fillText(selectedTemplate.label.split(" ")[0], 540, 420);

    // Agent name
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 64px 'Syne', sans-serif";
    const name = awardAgentName || "Agent Name";
    ctx.fillText(name, 540, 600);

    // Amount
    if (awardAmount) {
      ctx.font = "bold 48px 'Syne', sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fillText(`$${awardAmount}`, 540, 700);
    }

    // Date
    ctx.font = "24px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.fillText(new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" }), 540, 1020);
  }, [selectedTemplate, awardAgentName, awardAmount]);

  useEffect(() => {
    renderAward();
  }, [renderAward]);

  const downloadAward = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `apex_award_${selectedTemplate.id}_${awardAgentName.replace(/\s+/g, "_")}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    toast.success("Award graphic downloaded!");
  };

  return (
    <>
      <BackgroundGlow />
      <div className="p-4 md:p-6 space-y-6 page-enter">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold gradient-text" style={{ fontFamily: "Syne" }}>Content Library</h1>
            <p className="text-sm text-muted-foreground">Social media assets, templates & award graphics</p>
          </div>
          {canManage && (
            <Button onClick={() => setShowUploadDialog(true)} className="gap-2">
              <Plus className="h-4 w-4" /> Upload
            </Button>
          )}
        </div>

        <Tabs defaultValue="library">
          <TabsList className="glass">
            <TabsTrigger value="library"><Image className="h-4 w-4 mr-1" /> Library</TabsTrigger>
            <TabsTrigger value="awards"><Tag className="h-4 w-4 mr-1" /> Award Graphics</TabsTrigger>
          </TabsList>

          <TabsContent value="library" className="space-y-4 mt-4">
            {/* Search + Tags */}
            <div className="flex flex-wrap gap-2 items-center">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search content..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
              </div>
              {allTags.map(tag => (
                <Badge key={tag} variant={activeTag === tag ? "default" : "outline"} className="cursor-pointer capitalize"
                  onClick={() => setActiveTag(activeTag === tag ? null : tag)}>
                  {tag}
                </Badge>
              ))}
            </div>

            {/* Content Grid */}
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Image className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p>No content yet. {canManage ? "Upload your first asset!" : ""}</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {filtered.map((item, i) => (
                  <div key={item.id} className="glass-card p-3 space-y-2 animate-stagger-in" style={{ animationDelay: `${i * 50}ms` }}>
                    <div className="aspect-video bg-muted rounded-lg flex items-center justify-center relative overflow-hidden">
                      {item.file_type === "video" ? (
                        <video src={item.publicUrl} preload="metadata" className="w-full h-full object-cover rounded-lg" />
                      ) : (
                        <img src={item.publicUrl} alt={item.title} className="w-full h-full object-cover rounded-lg" onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }} />
                      )}
                    </div>
                    <p className="text-sm font-medium truncate">{item.title}</p>
                    <div className="flex items-center gap-1">
                      {(item.tags || []).map(t => <Badge key={t} variant="outline" className="text-[10px] capitalize">{t}</Badge>)}
                    </div>
                    <div className="flex gap-1">
                      <Button variant="outline" size="sm" className="flex-1 text-xs gap-1" onClick={() => handleDownload(item)}>
                        <Download className="h-3 w-3" /> Download
                      </Button>
                      {canManage && (
                        <Button variant="ghost" size="sm" className="text-xs text-destructive" onClick={() => handleDelete(item)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="awards" className="space-y-6 mt-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Controls */}
              <div className="space-y-4">
                <h3 className="font-bold text-lg" style={{ fontFamily: "Syne" }}>Generate Award Graphic</h3>

                <div className="space-y-2">
                  <Label>Template</Label>
                  <div className="grid grid-cols-1 gap-2">
                    {AWARD_TEMPLATES.map(tmpl => (
                      <button
                        key={tmpl.id}
                        onClick={() => setSelectedTemplate(tmpl)}
                        className={cn(
                          "flex items-center gap-3 p-3 rounded-lg border text-left transition-all",
                          selectedTemplate.id === tmpl.id
                            ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                            : "border-border hover:bg-muted/50"
                        )}
                      >
                        <span className="text-2xl">{tmpl.label.split(" ")[0]}</span>
                        <span className="text-sm font-medium">{tmpl.label.substring(tmpl.label.indexOf(" ") + 1)}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Agent Name</Label>
                  <Select onValueChange={(val) => setAwardAgentName(val)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select agent..." />
                    </SelectTrigger>
                    <SelectContent>
                      {agents.map(a => (
                        <SelectItem key={a.id} value={a.name}>{a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    placeholder="Or type name manually..."
                    value={awardAgentName}
                    onChange={e => setAwardAgentName(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Amount (optional)</Label>
                  <Input
                    placeholder="e.g. 15,000"
                    value={awardAmount}
                    onChange={e => setAwardAmount(e.target.value)}
                  />
                </div>

                <Button onClick={downloadAward} className="w-full gap-2">
                  <Download className="h-4 w-4" /> Download 1080×1080 PNG
                </Button>
              </div>

              {/* Preview */}
              <div className="space-y-2">
                <Label>Preview</Label>
                <div className="border rounded-xl overflow-hidden bg-muted aspect-square">
                  <canvas ref={canvasRef} className="w-full h-full" style={{ imageRendering: "auto" }} />
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        {/* Upload Dialog */}
        <Dialog open={showUploadDialog} onOpenChange={setShowUploadDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle style={{ fontFamily: "Syne" }}>Upload Content</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div
                className="border-2 border-dashed rounded-xl p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                {uploadFile ? (
                  <div className="flex items-center justify-center gap-2">
                    <p className="text-sm font-medium truncate">{uploadFile.name}</p>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); setUploadFile(null); }}>
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ) : (
                  <>
                    <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">Click to select file</p>
                    <p className="text-xs text-muted-foreground/70">MP4, MOV, PNG, JPG, WEBP</p>
                  </>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/mp4,video/quicktime,image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                />
              </div>

              <div className="space-y-2">
                <Label>Title</Label>
                <Input value={uploadTitle} onChange={e => setUploadTitle(e.target.value)} placeholder="e.g. Team Win Post" />
              </div>

              <div className="space-y-2">
                <Label>Tag</Label>
                <Select value={uploadTag} onValueChange={setUploadTag}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select tag..." />
                  </SelectTrigger>
                  <SelectContent>
                    {TAG_OPTIONS.map(t => (
                      <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button onClick={handleUpload} disabled={uploading || !uploadFile} className="w-full">
                {uploading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Uploading...</> : "Upload"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}
