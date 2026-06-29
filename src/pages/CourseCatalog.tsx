import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { BookOpen, PlayCircle, HelpCircle, Award, Camera, Lock, CheckCircle, Search, Phone, Headphones, Filter, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { SkeletonLoader } from "@/components/ui/skeleton-loader";
import { useAuth } from "@/hooks/useAuth";
import { useOnboardingCourse } from "@/hooks/useOnboardingCourse";
import { CourseModuleSidebar } from "@/components/course/CourseModuleSidebar";
import { CourseVideoPlayer } from "@/components/course/CourseVideoPlayer";
import { CourseQuiz } from "@/components/course/CourseQuiz";
import { AvatarUpload } from "@/components/dashboard/AvatarUpload";
import { supabase } from "@/integrations/supabase/client";
import { useSoundEffects } from "@/hooks/useSoundEffects";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Real calls will live in call_library table. Empty array = empty state.
const CALL_LIBRARY: {
  id: string;
  title: string;
  speaker: string;
  duration: string;
  date: string;
  category: string;
  description: string;
}[] = [];

const CALL_CATEGORIES = ["All", "Sales Calls", "Recruiting", "Training", "Live Replays"];

export default function CourseCatalog() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { playSound } = useSoundEffects();
  const [agentId, setAgentId] = useState<string | null>(null);
  const [agentNotFound, setAgentNotFound] = useState(false);
  const [autoProvisionAttempted, setAutoProvisionAttempted] = useState(false);
  const [provisioningInProgress, setProvisioningInProgress] = useState(false);
  const [activeView, setActiveView] = useState<"catalog" | "module">("catalog");
  const [activeTab, setActiveTab] = useState<"video" | "quiz">("video");
  const [mainTab, setMainTab] = useState<"courses" | "calls">("courses");
  const [playbackRate, setPlaybackRate] = useState(1);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [checkingAvatar, setCheckingAvatar] = useState(true);
  const [callSearch, setCallSearch] = useState("");
  const [callCategory, setCallCategory] = useState("All");

  useEffect(() => {
    const fetchAgentId = async () => {
      if (!user?.id) return;
      const { data } = await supabase
        .from("agents")
        .select("id, has_training_course")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1);
      if (data && data.length > 0) {
        setAgentId(data[0].id);
        if (!data[0].has_training_course) {
          await supabase.from("agents").update({ has_training_course: true }).eq("id", data[0].id);
        }
      } else {
        setTimeout(async () => {
          const { data: retryData } = await supabase
            .from("agents")
            .select("id, has_training_course")
            .eq("user_id", user.id)
            .order("created_at", { ascending: false })
            .limit(1);
          if (retryData && retryData.length > 0) {
            setAgentId(retryData[0].id);
          } else {
            setAgentNotFound(true);
          }
        }, 2000);
      }
    };
    fetchAgentId();
  }, [user?.id]);

  useEffect(() => {
    const checkAvatar = async () => {
      if (!user?.id) return;
      setCheckingAvatar(true);
      const { data } = await supabase.from("profiles").select("avatar_url").eq("user_id", user.id).maybeSingle();
      setAvatarUrl(data?.avatar_url || null);
      setCheckingAvatar(false);
    };
    checkAvatar();
  }, [user?.id]);

  // PL-067 license gate. Treat the user as licensed if any matching agent /
  // application row is licensed or further along.
  const [isLicensed, setIsLicensed] = useState(false);
  const [licenseCheckLoading, setLicenseCheckLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      if (!user?.id) return;
      setLicenseCheckLoading(true);
      try {
        // Agents table may already have a license flag; otherwise fall back
        // to applications.license_status / license_progress for this user.
        const [agentRes, appRes] = await Promise.all([
          supabase.from("agents").select("is_licensed").eq("user_id", user.id).maybeSingle(),
          supabase
            .from("applications")
            .select("license_status, license_progress")
            .eq("email", user.email || "__nope__")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);
        const agentLicensed = (agentRes.data as any)?.is_licensed === true;
        const app = appRes.data as { license_status?: string; license_progress?: string } | null;
        const appLicensed = app?.license_status === "licensed"
          || ["licensed", "fingerprints_done", "waiting_on_license"].includes(app?.license_progress || "");
        if (!cancelled) setIsLicensed(agentLicensed || appLicensed);
      } finally {
        if (!cancelled) setLicenseCheckLoading(false);
      }
    };
    check();
    return () => { cancelled = true; };
  }, [user?.id, user?.email]);

  useEffect(() => {
    const autoProvision = async () => {
      if (!agentNotFound || autoProvisionAttempted || !user?.id) return;
      setAutoProvisionAttempted(true);
      setProvisioningInProgress(true);
      try {
        const { data, error } = await supabase.functions.invoke("self-enroll-course", { body: {} });
        if (!error && data?.agentId) {
          setAgentId(data.agentId);
          setAgentNotFound(false);
        }
      } catch (err) {
        console.error("Self-enroll error:", err);
      } finally {
        setProvisioningInProgress(false);
      }
    };
    autoProvision();
  }, [agentNotFound, autoProvisionAttempted, user?.id]);

  const {
    modules, questions, progress, currentModuleIndex, setCurrentModuleIndex,
    loading, updateVideoProgress, submitQuiz, isModuleUnlocked, canTakeQuiz,
    getOverallProgress, isCourseComplete, currentModule
  } = useOnboardingCourse(agentId);

  const currentQuestions = currentModule ? questions[currentModule.id] || [] : [];
  const currentProgress = currentModule ? progress[currentModule.id] : null;

  const handleQuizSubmit = async (answers: number[], score: number, passed: boolean) => {
    if (!currentModule) return false;
    const success = await submitQuiz(currentModule.id, answers, score, passed);
    if (success && passed) playSound("celebrate");
    else if (success && !passed) playSound("error");
    return success;
  };

  const filteredCalls = CALL_LIBRARY.filter(c => {
    const matchesSearch = !callSearch || c.title.toLowerCase().includes(callSearch.toLowerCase()) || c.speaker.toLowerCase().includes(callSearch.toLowerCase());
    const matchesCategory = callCategory === "All" || c.category === callCategory;
    return matchesSearch && matchesCategory;
  });

  if (loading || provisioningInProgress || checkingAvatar) return <SkeletonLoader variant="page" />;

  // 2026-06-16 Sam directive: "any agent should be in dashboard, be able to
  // access that course at any time. Just never lock it." ALL gates removed:
  // - agentNotFound (no-agent-row block) → REMOVED
  // - PL-067 license gate → REMOVED
  // - Photo gate → REMOVED
  // Catalog renders the modules for ANY authenticated user; progress
  // tracking gracefully degrades to in-memory when no agent row exists.

  const completedCount = modules.filter(m => progress[m.id]?.passed).length;
  const modulesLeft = modules.length - completedCount;

  // 2026-06-29 SECURITY GATE — Sam directive: unlicensed agents seeing the
  // post-license sales course was wrong. They MUST be redirected to Xcel
  // pre-licensing before any sales-training content loads. The isLicensed
  // computed state above existed but was never gating the render.
  useEffect(() => {
    if (!licenseCheckLoading && !isLicensed) {
      navigate("/get-licensed", { replace: true });
    }
  }, [licenseCheckLoading, isLicensed, navigate]);

  if (licenseCheckLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-2">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-emerald-500" />
          <p className="text-sm text-muted-foreground">Checking license status…</p>
        </div>
      </div>
    );
  }

  if (!isLicensed) {
    // useEffect above will redirect; render nothing while it fires.
    return null;
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Hero Banner */}
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-md glass-card p-6 md:p-8"
      >
        <div className="absolute inset-0 bg-white dark:bg-slate-900 pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="space-y-2">
            <Badge variant="outline" className="border-primary/40 text-primary text-xs" style={{ fontFamily: "Syne" }}>
              APEX TRAINING ACADEMY
            </Badge>
            <h1 className="text-2xl md:text-3xl font-extrabold text-foreground" style={{ fontFamily: "Syne" }}>
              {isCourseComplete() ? "🎓 Course Complete!" : currentModule ? `Continue: ${currentModule.title}` : "Training Academy"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {isCourseComplete()
                ? "You've completed all modules. You're ready for the field!"
                : `${completedCount} of ${modules.length} modules complete · ${modulesLeft} modules left`}
            </p>
          </div>
          <div className="flex items-center gap-6">
            <div className="text-right">
              <p className="text-4xl font-extrabold text-primary" style={{ fontFamily: "Syne" }}>{getOverallProgress()}%</p>
              <p className="text-xs text-muted-foreground">overall progress</p>
            </div>
          </div>
        </div>
        <div className="mt-4 relative z-10">
          <Progress value={getOverallProgress()} className="h-2" />
        </div>
      </motion.div>

      {/* Main Tabs */}
      <Tabs value={mainTab} onValueChange={(v) => setMainTab(v as "courses" | "calls")}>
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="courses" className="gap-2" style={{ fontFamily: "Syne" }}>
            <BookOpen className="h-4 w-4" /> Courses
          </TabsTrigger>
          <TabsTrigger value="calls" className="gap-2" style={{ fontFamily: "Syne" }}>
            <Headphones className="h-4 w-4" /> Call Library
          </TabsTrigger>
        </TabsList>

        <TabsContent value="courses" className="mt-6">
          {activeView === "catalog" ? (
            /* Netflix-style Grid */
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {modules.map((mod, idx) => {
                const modProgress = progress[mod.id];
                const unlocked = isModuleUnlocked(idx);
                const completed = modProgress?.passed;
                const inProgress = unlocked && !completed && (modProgress?.video_watched_percent || 0) > 0;

                return (
                  <motion.div
                    key={mod.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    className={`group relative rounded-md overflow-hidden border transition-all cursor-pointer ${
                      completed ? "border-primary/40" :
                      inProgress ? "border-primary/60 ring-1 ring-primary/30 animate-pulse-subtle" :
                      unlocked ? "border-border hover:border-primary/40" :
                      "border-border/50 opacity-60"
                    }`}
                    onClick={() => {
                      if (unlocked) {
                        setCurrentModuleIndex(idx);
                        setActiveView("module");
                        setActiveTab("video");
                        playSound("click");
                      }
                    }}
                  >
                    {/* Thumbnail area */}
                    <div className="relative aspect-video bg-card flex items-center justify-center">
                      <div className="text-6xl font-extrabold text-muted-foreground/20" style={{ fontFamily: "Syne" }}>
                        {idx + 1}
                      </div>

                      {/* Overlays */}
                      {!unlocked && (
                        <div className="absolute inset-0 bg-background/80 flex items-center justify-center ">
                          <Lock className="h-8 w-8 text-muted-foreground" />
                        </div>
                      )}
                      {completed && (
                        <div className="absolute inset-0 bg-primary/10 flex items-center justify-center">
                          <CheckCircle className="h-10 w-10 text-primary" />
                        </div>
                      )}
                      {unlocked && !completed && (
                        <div className="absolute inset-0 bg-background/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <PlayCircle className="h-12 w-12 text-primary" />
                        </div>
                      )}

                      {/* Duration badge */}
                      <Badge className="absolute bottom-2 right-2 bg-background/80 text-foreground text-xs">
                        Module {idx + 1}
                      </Badge>
                    </div>

                    {/* Info */}
                    <div className="p-4 space-y-2">
                      <h3 className="font-bold text-sm text-foreground line-clamp-1" style={{ fontFamily: "Syne" }}>
                        {mod.title}
                      </h3>
                      {mod.description && (
                        <p className="text-xs text-muted-foreground line-clamp-2">{mod.description}</p>
                      )}
                      {unlocked && !completed && (modProgress?.video_watched_percent || 0) > 0 && (
                        <Progress value={modProgress?.video_watched_percent || 0} className="h-1" />
                      )}
                      {completed && (
                        <p className="text-xs text-primary font-medium">✓ Passed · Score: {modProgress?.score}%</p>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          ) : (
            /* Module Detail View */
            <div className="space-y-4">
              <Button variant="ghost" onClick={() => setActiveView("catalog")} className="gap-2 mb-2" style={{ fontFamily: "Syne" }}>
                ← Back to Catalog
              </Button>

              {currentModule && (
                <motion.div key={currentModule.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
                  <Card className="glass-card">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2" style={{ fontFamily: "Syne" }}>
                        <span className="text-primary">Module {currentModuleIndex + 1}:</span>
                        {currentModule.title}
                      </CardTitle>
                      {currentModule.description && <CardDescription>{currentModule.description}</CardDescription>}
                    </CardHeader>
                    <CardContent>
                      <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v as "video" | "quiz"); playSound("click"); }}>
                        <TabsList className="grid w-full grid-cols-2 mb-6">
                          <TabsTrigger value="video" className="gap-2"><PlayCircle className="h-4 w-4" /> Video</TabsTrigger>
                          <TabsTrigger value="quiz" className="gap-2" disabled={!canTakeQuiz(currentModule.id) && !currentProgress?.passed}>
                            <HelpCircle className="h-4 w-4" /> Quiz
                            {!canTakeQuiz(currentModule.id) && !currentProgress?.passed && <span className="text-xs opacity-60 ml-1">(80%)</span>}
                          </TabsTrigger>
                        </TabsList>

                        <TabsContent value="video" className="mt-0">
                          <CourseVideoPlayer
                            videoUrl={currentModule.video_url}
                            onProgressUpdate={(percent) => updateVideoProgress(currentModule.id, percent)}
                            watchedPercent={currentProgress?.video_watched_percent || 0}
                            onVideoComplete={() => {}}
                            playbackRate={playbackRate}
                            onPlaybackRateChange={setPlaybackRate}
                          />
                          {currentProgress?.passed && (
                            <div className="mt-4 p-4 rounded-lg bg-primary/10 border border-primary/30">
                              <p className="text-primary font-medium">✓ Passed with {currentProgress.score}%</p>
                            </div>
                          )}
                        </TabsContent>

                        <TabsContent value="quiz" className="mt-0">
                          {currentQuestions.length > 0 ? (
                            currentProgress?.passed ? (
                              <Card className="border-2 border-primary/30">
                                <CardContent className="pt-8 pb-8 text-center">
                                  <Award className="h-16 w-16 text-primary mx-auto mb-4" />
                                  <h3 className="text-xl font-bold mb-2" style={{ fontFamily: "Syne" }}>Module Complete!</h3>
                                  <p className="text-muted-foreground mb-4">Score: {currentProgress.score}%</p>
                                  {currentModuleIndex < modules.length - 1 && (
                                    <Button onClick={() => { setCurrentModuleIndex(currentModuleIndex + 1); setActiveTab("video"); }}>
                                      Next Module →
                                    </Button>
                                  )}
                                </CardContent>
                              </Card>
                            ) : (
                              <CourseQuiz
                                questions={currentQuestions}
                                passThreshold={currentModule.pass_threshold}
                                attempts={currentProgress?.attempts || 0}
                                onSubmit={handleQuizSubmit}
                                onRetry={() => {}}
                              />
                            )
                          ) : (
                            <Card><CardContent className="pt-8 pb-8 text-center">
                              <HelpCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                              <p className="text-muted-foreground">No quiz on this module — finish the video and mark it complete.</p>
                            </CardContent></Card>
                          )}
                        </TabsContent>
                      </Tabs>
                    </CardContent>
                  </Card>
                </motion.div>
              )}
            </div>
          )}
        </TabsContent>

        {/* Call Library Tab */}
        <TabsContent value="calls" className="mt-6 space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search calls..." value={callSearch} onChange={e => setCallSearch(e.target.value)} className="pl-9" />
            </div>
            <Select value={callCategory} onValueChange={setCallCategory}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CALL_CATEGORIES.map(cat => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {CALL_LIBRARY.length === 0 ? (
            <div className="p-12 text-center space-y-3 border border-dashed border-border rounded-md">
              <Headphones className="h-10 w-10 text-muted-foreground mx-auto opacity-50" />
              <h3 className="text-lg font-semibold" style={{ fontFamily: "Syne" }}>No recorded calls yet</h3>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Training calls and sales replays will show up here once uploaded. Check with your manager to get access.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredCalls.map(call => (
                <motion.div key={call.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-card rounded-md p-4 space-y-3 hover:border-primary/30 transition-all cursor-pointer group">
                  <div className="flex items-start justify-between">
                    <Badge variant="outline" className="text-xs">{call.category}</Badge>
                    <span className="text-xs text-muted-foreground">{call.duration}</span>
                  </div>
                  <h3 className="font-bold text-sm text-foreground group-hover:text-primary transition-colors" style={{ fontFamily: "Syne" }}>{call.title}</h3>
                  <p className="text-xs text-muted-foreground line-clamp-2">{call.description}</p>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{call.speaker}</span>
                    <span>{new Date(call.date).toLocaleDateString()}</span>
                  </div>
                </motion.div>
              ))}
              {filteredCalls.length === 0 && (
                <div className="col-span-full text-center py-12 text-muted-foreground">
                  <Headphones className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>No calls found matching your search.</p>
                </div>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
