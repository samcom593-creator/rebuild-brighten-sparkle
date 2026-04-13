import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Search, Download, Upload, Trash2, Plus, Image, Video, Tag, X, Loader2,
  Cloud, FolderOpen, HardDrive, AlertTriangle, CheckCircle2, BarChart3,
  Sparkles, Copy, FileVideo, FileImage, RefreshCw, Smartphone, ShieldAlert,
  Eye, EyeOff, ShieldCheck
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { BackgroundGlow } from "@/components/ui/BackgroundGlow";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/* ─── Types ─── */
interface ContentItem {
  id: string;
  title: string;
  description: string | null;
  tags: string[];
  ai_tags: string[];
  ai_description: string | null;
  storage_path: string;
  file_type: string;
  file_size: number;
  original_name: string | null;
  content_type: string | null;
  source: string;
  ai_analyzed: boolean;
  ai_analyzed_at: string | null;
  duplicate_flagged: boolean;
  possible_duplicate_of: string | null;
  is_sensitive: boolean;
  sensitive_flags: string[];
  sensitive_reason: string | null;
  sensitive_checked: boolean;
  created_at: string;
  publicUrl: string;
}

/* ─── Constants ─── */
const QUICK_TAGS = ["All", "gym", "lifestyle", "agent-win", "recruiting", "money", "celebration", "team", "training"];

const TAG_OPTIONS = ["social", "training", "testimonial", "product", "team", "scripts", "sales", "recap",
  "gym", "lifestyle", "money", "luxury", "travel", "agent-win", "recruiting", "deal-close", "motivational",
  "personal-brand", "celebration", "family"];

const AWARD_TEMPLATES = [
  { id: "deal_closed", label: "💰 Deal Closed", gradient: ["#10b981", "#059669"], subtitle: "CLOSED A DEAL" },
  { id: "weekly_top", label: "🏆 Weekly Top Producer", gradient: ["#f59e0b", "#d97706"], subtitle: "TOP PRODUCER" },
  { id: "streak", label: "🔥 Streak Achievement", gradient: ["#ef4444", "#dc2626"], subtitle: "ON FIRE" },
  { id: "monthly_elite", label: "⭐ Monthly Elite", gradient: ["#8b5cf6", "#7c3aed"], subtitle: "ELITE STATUS" },
  { id: "first_deal", label: "🎉 First Deal", gradient: ["#3b82f6", "#2563eb"], subtitle: "FIRST DEAL EVER" },
];

type SortOption = "newest" | "oldest" | "largest" | "az";
type ViewMode = "grid" | "list";

export default function ContentLibrary() {
  const { isAdmin, isManager } = useAuth();
  const canManage = isAdmin || isManager;

  /* ─── State ─── */
  const [content, setContent] = useState<ContentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>("newest");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [activeTab, setActiveTab] = useState("all");

  // Upload state
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [uploadQueue, setUploadQueue] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Upload dialog
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadTag, setUploadTag] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  // Award state
  const [selectedTemplate, setSelectedTemplate] = useState(AWARD_TEMPLATES[0]);
  const [awardAgentName, setAwardAgentName] = useState("");
  const [awardAmount, setAwardAmount] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [agents, setAgents] = useState<Array<{ id: string; name: string; avatarUrl?: string }>>([]);

  // Storage dashboard checklist
  const [safetyChecklist, setSafetyChecklist] = useState({
    icloudUploaded: false,
    verifiedOnline: false,
    apexUploaded: false,
    dropboxBackup: false,
  });

  /* ─── Fetch Content ─── */
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
          tags: item.tags || [],
          ai_tags: item.ai_tags || [],
          is_sensitive: item.is_sensitive || false,
          sensitive_flags: item.sensitive_flags || [],
          sensitive_checked: item.sensitive_checked || false,
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
    setAgents(agentsData.map(a => {
      const p = profiles?.find(pr => pr.user_id === a.user_id);
      return { id: a.id, name: a.display_name || p?.full_name || "Unknown", avatarUrl: p?.avatar_url || undefined };
    }));
  }, []);

  useEffect(() => { fetchContent(); fetchAgents(); }, [fetchContent, fetchAgents]);

  /* ─── Filtering & Sorting ─── */
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    content.forEach(c => {
      (c.tags || []).forEach(t => tagSet.add(t));
      (c.ai_tags || []).forEach(t => tagSet.add(t));
    });
    return [...tagSet].sort();
  }, [content]);

  const filtered = useMemo(() => {
    let items = content;

    // Hide sensitive content from non-admins (never show in main tabs)
    if (activeTab !== "sensitive") {
      items = items.filter(c => !c.is_sensitive);
    }

    // Tab filter
    if (activeTab === "photos") items = items.filter(c => c.file_type === "image");
    else if (activeTab === "videos") items = items.filter(c => c.file_type === "video");
    else if (activeTab === "duplicates") items = items.filter(c => c.duplicate_flagged);
    else if (activeTab === "sensitive") items = items.filter(c => c.is_sensitive);

    // Search
    if (search) {
      const q = search.toLowerCase();
      items = items.filter(c =>
        c.title?.toLowerCase().includes(q) ||
        c.description?.toLowerCase().includes(q) ||
        c.ai_description?.toLowerCase().includes(q) ||
        c.original_name?.toLowerCase().includes(q) ||
        c.tags?.some(t => t.toLowerCase().includes(q)) ||
        c.ai_tags?.some(t => t.toLowerCase().includes(q))
      );
    }

    // Tag filter
    if (activeTag && activeTag !== "All") {
      items = items.filter(c =>
        (c.tags || []).includes(activeTag) || (c.ai_tags || []).includes(activeTag)
      );
    }

    // Sort
    switch (sortBy) {
      case "oldest": items = [...items].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()); break;
      case "largest": items = [...items].sort((a, b) => (b.file_size || 0) - (a.file_size || 0)); break;
      case "az": items = [...items].sort((a, b) => (a.title || "").localeCompare(b.title || "")); break;
      default: break; // already newest first from query
    }

    return items;
  }, [content, search, activeTag, sortBy, activeTab]);

  /* ─── Stats ─── */
  const stats = useMemo(() => {
    const photos = content.filter(c => c.file_type === "image").length;
    const videos = content.filter(c => c.file_type === "video").length;
    const totalBytes = content.reduce((sum, c) => sum + (c.file_size || 0), 0);
    const totalGB = (totalBytes / (1024 ** 3)).toFixed(2);
    const duplicates = content.filter(c => c.duplicate_flagged).length;
    const duplicateBytes = content.filter(c => c.duplicate_flagged).reduce((s, c) => s + (c.file_size || 0), 0);
    const analyzed = content.filter(c => c.ai_analyzed).length;
    const analyzedPct = content.length > 0 ? Math.round((analyzed / content.length) * 100) : 0;
    const oldest = content.length > 0 ? content[content.length - 1]?.created_at : null;
    const largest = [...content].sort((a, b) => (b.file_size || 0) - (a.file_size || 0)).slice(0, 10);
    return { photos, videos, totalBytes, totalGB, duplicates, duplicateBytes, analyzed, analyzedPct, oldest, largest };
  }, [content]);

  /* ─── Upload Handler ─── */
  const processUpload = async (file: File, source: string = "upload") => {
    const ext = file.name.split(".").pop() || "bin";
    const sanitized = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${Date.now()}_${sanitized}`;

    setUploadProgress(prev => ({ ...prev, [file.name]: 0 }));

    try {
      const { error: storageError } = await supabase.storage
        .from("content-library")
        .upload(path, file);
      if (storageError) throw storageError;

      setUploadProgress(prev => ({ ...prev, [file.name]: 50 }));

      const fileType = file.type.startsWith("video") ? "video" : "image";
      const { data: urlData } = supabase.storage.from("content-library").getPublicUrl(path);

      // Get image dimensions if possible
      let width: number | undefined;
      let height: number | undefined;
      if (fileType === "image") {
        try {
          const dims = await getImageDimensions(file);
          width = dims.width;
          height = dims.height;
        } catch {}
      }

      const { data: inserted, error: dbError } = await supabase
        .from("content_library")
        .insert({
          title: file.name.replace(/\.[^/.]+$/, "").replace(/[_-]/g, " "),
          storage_path: path,
          file_type: fileType,
          tags: [],
          original_name: file.name,
          file_size: file.size,
          public_url: urlData?.publicUrl || "",
          source,
          width,
          height,
        })
        .select("id")
        .single();

      if (dbError) throw dbError;
      setUploadProgress(prev => ({ ...prev, [file.name]: 75 }));

      // Fire AI analysis + duplicate detection in background
      if (inserted?.id) {
        const publicUrl = urlData?.publicUrl || "";
        // AI analyze
        supabase.functions.invoke("analyze-content-item", {
          body: { contentItemId: inserted.id, fileUrl: publicUrl, fileType }
        }).then(() => {
          console.log(`AI analysis complete for ${file.name}`);
          fetchContent(); // Refresh to show tags
        }).catch(e => console.error("AI analysis failed:", e));

        // Duplicate detection
        supabase.functions.invoke("detect-duplicates", {
          body: { contentItemId: inserted.id }
        }).then(() => {
          console.log(`Duplicate check complete for ${file.name}`);
          fetchContent();
        }).catch(e => console.error("Duplicate check failed:", e));
      }

      setUploadProgress(prev => ({ ...prev, [file.name]: 100 }));
      return true;
    } catch (err: any) {
      console.error("Upload failed:", err);
      toast.error(`Upload failed for ${file.name}: ${err.message}`);
      return false;
    }
  };

  const getImageDimensions = (file: File): Promise<{ width: number; height: number }> => {
    return new Promise((resolve, reject) => {
      const img = new window.Image();
      img.onload = () => { resolve({ width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(img.src); };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  };

  const handleMultiUpload = async (files: FileList | File[], source: string = "upload") => {
    if (!files || files.length === 0) return;
    setUploading(true);
    const fileArray = Array.from(files);
    setUploadQueue(fileArray);

    let successCount = 0;
    for (const file of fileArray) {
      const ok = await processUpload(file, source);
      if (ok) successCount++;
    }

    toast.success(`Uploaded ${successCount}/${fileArray.length} files`);
    setUploading(false);
    setUploadQueue([]);
    setUploadProgress({});
    fetchContent();
  };

  // Single file upload (dialog)
  const handleSingleUpload = async () => {
    if (!uploadFile || !uploadTitle.trim()) {
      toast.error("Please provide a file and title");
      return;
    }
    setUploading(true);
    const ext = uploadFile.name.split(".").pop() || "bin";
    const path = `${Date.now()}_${uploadTitle.replace(/\s+/g, "_").toLowerCase()}.${ext}`;

    try {
      const { error: storageError } = await supabase.storage.from("content-library").upload(path, uploadFile);
      if (storageError) throw storageError;

      const fileType = uploadFile.type.startsWith("video") ? "video" : "image";
      const tags = uploadTag ? [uploadTag] : [];
      const { data: urlData } = supabase.storage.from("content-library").getPublicUrl(path);

      const { data: inserted, error: dbError } = await supabase.from("content_library").insert({
        title: uploadTitle.trim(),
        storage_path: path,
        file_type: fileType,
        tags,
        original_name: uploadFile.name,
        file_size: uploadFile.size,
        public_url: urlData?.publicUrl || "",
        source: "upload",
      }).select("id").single();

      if (dbError) throw dbError;

      // Fire AI analysis
      if (inserted?.id) {
        supabase.functions.invoke("analyze-content-item", {
          body: { contentItemId: inserted.id, fileUrl: urlData?.publicUrl || "", fileType }
        }).catch(e => console.error("AI analysis failed:", e));
        supabase.functions.invoke("detect-duplicates", {
          body: { contentItemId: inserted.id }
        }).catch(e => console.error("Duplicate check failed:", e));
      }

      toast.success("Content uploaded! AI is analyzing...");
      setShowUploadDialog(false);
      setUploadTitle("");
      setUploadTag("");
      setUploadFile(null);
      fetchContent();
    } catch (err: any) {
      toast.error("Upload failed: " + (err.message || "Unknown error"));
    } finally {
      setUploading(false);
    }
  };

  /* ─── Delete ─── */
  const handleDelete = async (item: ContentItem) => {
    if (!confirm(`Delete "${item.title}"?`)) return;
    try {
      await supabase.storage.from("content-library").remove([item.storage_path]);
      await supabase.from("content_library").delete().eq("id", item.id);
      toast.success("Deleted");
      fetchContent();
    } catch { toast.error("Failed to delete"); }
  };

  const handleBulkDeleteDuplicates = async () => {
    const dupes = content.filter(c => c.duplicate_flagged);
    if (!dupes.length) return;
    if (!confirm(`Delete all ${dupes.length} duplicate items? This cannot be undone.`)) return;

    let deleted = 0;
    for (const d of dupes) {
      try {
        await supabase.storage.from("content-library").remove([d.storage_path]);
        await supabase.from("content_library").delete().eq("id", d.id);
        deleted++;
      } catch {}
    }
    toast.success(`Deleted ${deleted} duplicates`);
    fetchContent();
  };

  const handleReanalyzeAll = async () => {
    const unanalyzed = content.filter(c => !c.ai_analyzed);
    if (!unanalyzed.length) {
      toast.info("All items already analyzed");
      return;
    }
    toast.info(`Re-analyzing ${unanalyzed.length} items...`);
    for (const item of unanalyzed) {
      supabase.functions.invoke("analyze-content-item", {
        body: { contentItemId: item.id, fileUrl: item.publicUrl, fileType: item.file_type }
      }).catch(e => console.error("Re-analysis failed:", e));
    }
    setTimeout(fetchContent, 5000);
  };

  /* ─── Drag & Drop ─── */
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = () => setIsDragging(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) handleMultiUpload(e.dataTransfer.files, "upload");
  };

  /* ─── Download ─── */
  const handleDownload = (item: ContentItem) => {
    const a = document.createElement("a");
    a.href = item.publicUrl;
    a.download = item.title || item.original_name || "download";
    a.target = "_blank";
    a.click();
  };

  /* ─── Award Canvas ─── */
  const renderAward = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = 1080;
    canvas.height = 1080;

    const grad = ctx.createLinearGradient(0, 0, 1080, 1080);
    grad.addColorStop(0, selectedTemplate.gradient[0]);
    grad.addColorStop(1, selectedTemplate.gradient[1]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1080, 1080);

    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(0, 0, 1080, 1080);

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 36px 'Syne', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("APEX FINANCIAL", 540, 100);

    ctx.font = "bold 28px 'Syne', sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillText(selectedTemplate.subtitle, 540, 160);

    ctx.font = "120px serif";
    ctx.fillText(selectedTemplate.label.split(" ")[0], 540, 420);

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 64px 'Syne', sans-serif";
    ctx.fillText(awardAgentName || "Agent Name", 540, 600);

    if (awardAmount) {
      ctx.font = "bold 48px 'Syne', sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fillText(`$${awardAmount}`, 540, 700);
    }

    ctx.font = "24px sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.fillText(new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" }), 540, 1020);
  }, [selectedTemplate, awardAgentName, awardAmount]);

  useEffect(() => { renderAward(); }, [renderAward]);

  const downloadAward = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `apex_award_${selectedTemplate.id}_${awardAgentName.replace(/\s+/g, "_")}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    toast.success("Award graphic downloaded!");
  };

  /* ─── Format helpers ─── */
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  const duplicateCount = content.filter(c => c.duplicate_flagged).length;
  const sensitiveCount = content.filter(c => c.is_sensitive).length;

  /* ─── Render ─── */
  return (
    <>
      <BackgroundGlow />
      <div className="p-4 md:p-6 space-y-4 page-enter">
        {/* HEADER */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold gradient-text" style={{ fontFamily: "Syne" }}>Content Library</h1>
            <p className="text-sm text-muted-foreground flex items-center gap-2 flex-wrap">
              <span>{stats.photos} photos</span>
              <span>·</span>
              <span>{stats.videos} videos</span>
              <span>·</span>
              <span>{stats.totalGB} GB used</span>
              {stats.analyzedPct < 100 && (
                <>
                  <span>·</span>
                  <span className="text-amber-500 flex items-center gap-1">
                    <Sparkles className="h-3 w-3" />
                    {stats.analyzedPct}% AI analyzed
                  </span>
                </>
              )}
            </p>
          </div>
          {canManage && (
            <div className="flex gap-2 flex-wrap">
              <Button
                onClick={() => fileInputRef.current?.click()}
                className="gap-2 bg-emerald-600 hover:bg-emerald-700"
              >
                <Smartphone className="h-4 w-4" /> Import from iPhone
              </Button>
              <Button
                variant="outline"
                onClick={() => filesInputRef.current?.click()}
                className="gap-2"
              >
                <FolderOpen className="h-4 w-4" /> Import from Files
              </Button>
              <Button variant="outline" onClick={() => setShowUploadDialog(true)} className="gap-2">
                <Plus className="h-4 w-4" /> Upload with Details
              </Button>
              {/* Hidden file inputs */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*"
                multiple
                className="hidden"
                onChange={(e) => e.target.files && handleMultiUpload(e.target.files, "icloud")}
              />
              <input
                ref={filesInputRef}
                type="file"
                accept="image/*,video/*"
                multiple
                className="hidden"
                onChange={(e) => e.target.files && handleMultiUpload(e.target.files, "files")}
              />
            </div>
          )}
        </div>

        {/* Upload Progress */}
        {uploading && uploadQueue.length > 0 && (
          <div className="glass-card p-4 space-y-2">
            <p className="text-sm font-medium flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Uploading {uploadQueue.length} files...
            </p>
            {uploadQueue.map(f => (
              <div key={f.name} className="space-y-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span className="truncate max-w-[200px]">{f.name}</span>
                  <span>{uploadProgress[f.name] || 0}%</span>
                </div>
                <Progress value={uploadProgress[f.name] || 0} className="h-1" />
              </div>
            ))}
          </div>
        )}

        {/* TABS */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="glass flex-wrap">
            <TabsTrigger value="all"><Image className="h-4 w-4 mr-1" /> All</TabsTrigger>
            <TabsTrigger value="photos"><FileImage className="h-4 w-4 mr-1" /> Photos</TabsTrigger>
            <TabsTrigger value="videos"><FileVideo className="h-4 w-4 mr-1" /> Videos</TabsTrigger>
            <TabsTrigger value="duplicates" className="relative">
              <Copy className="h-4 w-4 mr-1" /> Duplicates
              {duplicateCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground text-[10px] rounded-full h-4 w-4 flex items-center justify-center">
                  {duplicateCount}
                </span>
              )}
            </TabsTrigger>
            {isAdmin && (
              <TabsTrigger value="sensitive" className="relative">
                <ShieldAlert className="h-4 w-4 mr-1" /> Sensitive
                {sensitiveCount > 0 && (
                  <span className="absolute -top-1 -right-1 bg-red-600 text-white text-[10px] rounded-full h-4 w-4 flex items-center justify-center">
                    {sensitiveCount}
                  </span>
                )}
              </TabsTrigger>
            )}
            <TabsTrigger value="storage"><HardDrive className="h-4 w-4 mr-1" /> Storage</TabsTrigger>
            <TabsTrigger value="awards"><Tag className="h-4 w-4 mr-1" /> Awards</TabsTrigger>
          </TabsList>

          {/* ═══ CONTENT TABS (All / Photos / Videos / Duplicates) ═══ */}
          {["all", "photos", "videos", "duplicates"].map(tabKey => (
            <TabsContent key={tabKey} value={tabKey} className="space-y-4 mt-4">
              {/* Search + Filter Bar */}
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2 items-center">
                  <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Search content, tags, descriptions..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
                  </div>
                  <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortOption)}>
                    <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="newest">Newest</SelectItem>
                      <SelectItem value="oldest">Oldest</SelectItem>
                      <SelectItem value="largest">Largest</SelectItem>
                      <SelectItem value="az">A-Z</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Quick Filter Pills */}
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_TAGS.map(tag => (
                    <Badge
                      key={tag}
                      variant={activeTag === tag || (tag === "All" && !activeTag) ? "default" : "outline"}
                      className="cursor-pointer capitalize text-xs"
                      onClick={() => setActiveTag(tag === "All" ? null : tag)}
                    >
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>

              {/* Duplicate bulk actions */}
              {tabKey === "duplicates" && duplicateCount > 0 && canManage && (
                <div className="glass-card p-3 flex items-center justify-between">
                  <div className="text-sm">
                    <span className="font-medium text-amber-500">{duplicateCount} duplicates found</span>
                    <span className="text-muted-foreground ml-2">
                      ({formatBytes(stats.duplicateBytes)} wasted)
                    </span>
                  </div>
                  <Button variant="destructive" size="sm" onClick={handleBulkDeleteDuplicates}>
                    <Trash2 className="h-3 w-3 mr-1" /> Delete All Duplicates
                  </Button>
                </div>
              )}

              {/* Drag & Drop Zone + Grid */}
              <div
                ref={dropRef}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={cn(
                  "min-h-[200px] rounded-xl transition-colors",
                  isDragging && "border-2 border-dashed border-primary bg-primary/5"
                )}
              >
                {isDragging ? (
                  <div className="flex flex-col items-center justify-center py-20">
                    <Upload className="h-12 w-12 text-primary mb-3 animate-bounce" />
                    <p className="text-lg font-medium">Drop files here to upload</p>
                  </div>
                ) : loading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="text-center py-16 text-muted-foreground">
                    <Upload className="h-16 w-16 mx-auto mb-4 opacity-20" />
                    <p className="text-lg font-medium mb-1">
                      {tabKey === "duplicates" ? "No duplicates found" : "Your content library is empty"}
                    </p>
                    <p className="text-sm mb-4">
                      {tabKey === "duplicates"
                        ? "All your content is unique!"
                        : "Import photos and videos from your iPhone to get started"}
                    </p>
                    {canManage && tabKey !== "duplicates" && (
                      <Button onClick={() => fileInputRef.current?.click()} className="gap-2 bg-emerald-600 hover:bg-emerald-700">
                        <Smartphone className="h-4 w-4" /> Import from iPhone
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className={cn(
                    "grid gap-3",
                    viewMode === "grid" ? "grid-cols-2 md:grid-cols-4" : "grid-cols-1"
                  )}>
                    {filtered.map((item, i) => (
                      <ContentCard
                        key={item.id}
                        item={item}
                        index={i}
                        canManage={canManage}
                        onDelete={handleDelete}
                        onDownload={handleDownload}
                        viewMode={viewMode}
                        allContent={content}
                      />
                    ))}
                  </div>
                )}
              </div>
            </TabsContent>
          ))}

          {/* ═══ STORAGE TAB ═══ */}
          <TabsContent value="storage" className="space-y-4 mt-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <StatCard icon={<FileImage className="h-5 w-5 text-blue-500" />} label="Photos" value={String(stats.photos)} />
              <StatCard icon={<FileVideo className="h-5 w-5 text-purple-500" />} label="Videos" value={String(stats.videos)} />
              <StatCard icon={<HardDrive className="h-5 w-5 text-emerald-500" />} label="Storage Used" value={`${stats.totalGB} GB`} />
              <StatCard icon={<Copy className="h-5 w-5 text-amber-500" />} label="Duplicates" value={`${stats.duplicates} items`} />
              <StatCard icon={<Sparkles className="h-5 w-5 text-primary" />} label="AI Analyzed" value={`${stats.analyzedPct}%`} />
              <StatCard
                icon={<BarChart3 className="h-5 w-5 text-muted-foreground" />}
                label="Oldest Upload"
                value={stats.oldest ? new Date(stats.oldest).toLocaleDateString() : "—"}
              />
            </div>

            {/* Bulk Management */}
            {canManage && (
              <div className="glass-card p-4 space-y-3">
                <h3 className="font-bold text-sm" style={{ fontFamily: "Syne" }}>Bulk Management</h3>
                <div className="flex flex-wrap gap-2">
                  <Button variant="destructive" size="sm" onClick={handleBulkDeleteDuplicates} disabled={stats.duplicates === 0}>
                    <Trash2 className="h-3 w-3 mr-1" /> Delete All Duplicates ({stats.duplicates})
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleReanalyzeAll}>
                    <RefreshCw className="h-3 w-3 mr-1" /> Re-analyze Untagged
                  </Button>
                </div>
              </div>
            )}

            {/* Largest Files */}
            {stats.largest.length > 0 && (
              <div className="glass-card p-4 space-y-3">
                <h3 className="font-bold text-sm" style={{ fontFamily: "Syne" }}>Largest Files</h3>
                <div className="space-y-2">
                  {stats.largest.map(item => (
                    <div key={item.id} className="flex items-center justify-between text-sm">
                      <span className="truncate max-w-[200px]">{item.title || item.original_name}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">{formatBytes(item.file_size)}</span>
                        {canManage && (
                          <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => handleDelete(item)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Phone Safety Checklist */}
            <div className="glass-card p-4 space-y-3">
              <h3 className="font-bold text-sm flex items-center gap-2" style={{ fontFamily: "Syne" }}>
                <Smartphone className="h-4 w-4" /> Safe to Delete from iPhone
              </h3>
              <div className="space-y-2">
                {[
                  { key: "icloudUploaded" as const, label: 'iCloud shows "All items uploaded"' },
                  { key: "verifiedOnline" as const, label: "Verified content visible at icloud.com" },
                  { key: "apexUploaded" as const, label: "Key content uploaded to APEX library" },
                  { key: "dropboxBackup" as const, label: "Dropbox backup complete" },
                ].map(({ key, label }) => (
                  <div key={key} className="flex items-center gap-2">
                    <Checkbox
                      checked={safetyChecklist[key]}
                      onCheckedChange={(checked) =>
                        setSafetyChecklist(prev => ({ ...prev, [key]: !!checked }))
                      }
                    />
                    <span className="text-sm">{label}</span>
                  </div>
                ))}
              </div>
              {Object.values(safetyChecklist).every(Boolean) && (
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3 flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-emerald-500 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-emerald-500">You can now safely optimize iPhone storage</p>
                    <p className="text-xs text-muted-foreground">Settings → General → iPhone Storage → Enable "Optimize Storage"</p>
                  </div>
                </div>
              )}
            </div>
          </TabsContent>

          {/* ═══ SENSITIVE TAB (Admin Only) ═══ */}
          {isAdmin && (
            <TabsContent value="sensitive" className="space-y-4 mt-4">
              <div className="glass-card p-4 border-red-500/30 border">
                <div className="flex items-center gap-2 mb-3">
                  <ShieldAlert className="h-5 w-5 text-red-500" />
                  <h3 className="font-bold text-sm" style={{ fontFamily: "Syne" }}>Sensitive Content Review</h3>
                  <Badge variant="destructive" className="text-xs">{sensitiveCount} flagged</Badge>
                </div>
                <p className="text-xs text-muted-foreground mb-4">
                  These items were automatically flagged by AI as potentially inappropriate for the professional library. 
                  They are hidden from all agents and managers.
                </p>

                {filtered.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <ShieldCheck className="h-12 w-12 mx-auto mb-3 opacity-30" />
                    <p className="font-medium">No sensitive content flagged</p>
                    <p className="text-sm">All uploaded content has passed safety checks</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {filtered.map((item) => (
                      <SensitiveContentCard
                        key={item.id}
                        item={item}
                        onMarkSafe={async () => {
                          await supabase.from("content_library").update({
                            is_sensitive: false,
                            sensitive_checked: true,
                          }).eq("id", item.id);
                          toast.success("Marked as safe — now visible in library");
                          fetchContent();
                        }}
                        onDelete={() => handleDelete(item)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </TabsContent>
          )}

          {/* ═══ AWARDS TAB ═══ */}
          <TabsContent value="awards" className="space-y-6 mt-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
                    <SelectTrigger><SelectValue placeholder="Select agent..." /></SelectTrigger>
                    <SelectContent>
                      {agents.map(a => (<SelectItem key={a.id} value={a.name}>{a.name}</SelectItem>))}
                    </SelectContent>
                  </Select>
                  <Input placeholder="Or type name manually..." value={awardAgentName} onChange={e => setAwardAgentName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Amount (optional)</Label>
                  <Input placeholder="e.g. 15,000" value={awardAmount} onChange={e => setAwardAmount(e.target.value)} />
                </div>
                <Button onClick={downloadAward} className="w-full gap-2">
                  <Download className="h-4 w-4" /> Download 1080×1080 PNG
                </Button>
              </div>
              <div className="space-y-2">
                <Label>Preview</Label>
                <div className="border rounded-xl overflow-hidden bg-muted aspect-square">
                  <canvas ref={canvasRef} className="w-full h-full" style={{ imageRendering: "auto" }} />
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        {/* Upload Dialog (single file with details) */}
        <Dialog open={showUploadDialog} onOpenChange={setShowUploadDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle style={{ fontFamily: "Syne" }}>Upload Content</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div
                className="border-2 border-dashed rounded-xl p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => {
                  const input = document.createElement("input");
                  input.type = "file";
                  input.accept = "video/mp4,video/quicktime,image/png,image/jpeg,image/webp";
                  input.onchange = (e) => setUploadFile((e.target as HTMLInputElement).files?.[0] || null);
                  input.click();
                }}
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
              </div>
              <div className="space-y-2">
                <Label>Title</Label>
                <Input value={uploadTitle} onChange={e => setUploadTitle(e.target.value)} placeholder="e.g. Team Win Post" />
              </div>
              <div className="space-y-2">
                <Label>Tag (optional)</Label>
                <Select value={uploadTag} onValueChange={setUploadTag}>
                  <SelectTrigger><SelectValue placeholder="Select tag..." /></SelectTrigger>
                  <SelectContent>
                    {TAG_OPTIONS.map(t => (<SelectItem key={t} value={t}>{t}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handleSingleUpload} disabled={uploading} className="w-full gap-2">
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {uploading ? "Uploading..." : "Upload"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}

/* ─── Content Card Component ─── */
function ContentCard({
  item,
  index,
  canManage,
  onDelete,
  onDownload,
  viewMode,
  allContent,
}: {
  item: ContentItem;
  index: number;
  canManage: boolean;
  onDelete: (item: ContentItem) => void;
  onDownload: (item: ContentItem) => void;
  viewMode: ViewMode;
  allContent: ContentItem[];
}) {
  const duplicateOriginal = item.duplicate_flagged && item.possible_duplicate_of
    ? allContent.find(c => c.id === item.possible_duplicate_of)
    : null;

  const combinedTags = [...new Set([...(item.tags || []), ...(item.ai_tags || [])])];

  if (viewMode === "list") {
    return (
      <div className="glass-card p-3 flex items-center gap-3 animate-stagger-in" style={{ animationDelay: `${index * 30}ms` }}>
        <div className="w-16 h-16 rounded-lg overflow-hidden flex-shrink-0 bg-muted">
          {item.file_type === "video" ? (
            <video src={item.publicUrl} preload="metadata" className="w-full h-full object-cover" />
          ) : (
            <img src={item.publicUrl} alt={item.title} className="w-full h-full object-cover" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{item.title}</p>
          <div className="flex items-center gap-1 mt-1 flex-wrap">
            {item.ai_analyzed && <Badge variant="secondary" className="text-[9px] gap-0.5"><Sparkles className="h-2 w-2" /> AI</Badge>}
            {item.duplicate_flagged && <Badge variant="destructive" className="text-[9px]">Duplicate</Badge>}
            {combinedTags.slice(0, 3).map(t => <Badge key={t} variant="outline" className="text-[9px] capitalize">{t}</Badge>)}
          </div>
        </div>
        <div className="flex gap-1">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => onDownload(item)}>
            <Download className="h-3 w-3" />
          </Button>
          {canManage && (
            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => onDelete(item)}>
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card p-2 space-y-1.5 animate-stagger-in group" style={{ animationDelay: `${index * 30}ms` }}>
      <div className="aspect-square bg-muted rounded-lg flex items-center justify-center relative overflow-hidden">
        {item.file_type === "video" ? (
          <video src={item.publicUrl} preload="metadata" className="w-full h-full object-cover rounded-lg" />
        ) : (
          <img
            src={item.publicUrl}
            alt={item.title}
            className="w-full h-full object-cover rounded-lg"
            loading="lazy"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        )}

        {/* Badges overlay */}
        <div className="absolute top-1.5 left-1.5 flex gap-1">
          {item.ai_analyzed && (
            <span className="bg-primary/80 text-primary-foreground text-[9px] px-1.5 py-0.5 rounded-full flex items-center gap-0.5 backdrop-blur-sm">
              <Sparkles className="h-2 w-2" /> AI
            </span>
          )}
          {item.duplicate_flagged && (
            <span className="bg-destructive/80 text-destructive-foreground text-[9px] px-1.5 py-0.5 rounded-full flex items-center gap-0.5 backdrop-blur-sm">
              <AlertTriangle className="h-2 w-2" /> Dup
            </span>
          )}
        </div>

        {/* Hover actions */}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
          <Button variant="secondary" size="icon" className="h-8 w-8" onClick={() => onDownload(item)}>
            <Download className="h-4 w-4" />
          </Button>
          {canManage && (
            <Button variant="destructive" size="icon" className="h-8 w-8" onClick={() => onDelete(item)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <p className="text-xs font-medium truncate px-0.5">{item.title}</p>
      <div className="flex items-center gap-0.5 px-0.5 flex-wrap">
        {combinedTags.slice(0, 3).map(t => (
          <Badge key={t} variant="outline" className="text-[9px] capitalize h-4 px-1">{t}</Badge>
        ))}
        {combinedTags.length > 3 && (
          <span className="text-[9px] text-muted-foreground">+{combinedTags.length - 3}</span>
        )}
      </div>

      {item.duplicate_flagged && duplicateOriginal && (
        <p className="text-[9px] text-amber-500 px-0.5 truncate">
          ↳ Duplicate of: {duplicateOriginal.title}
        </p>
      )}
    </div>
  );
}

/* ─── Stat Card ─── */
function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="glass-card p-4 flex items-center gap-3">
      {icon}
      <div>
        <p className="text-lg font-bold">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}
