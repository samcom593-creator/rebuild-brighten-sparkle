import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { BookOpen, PlayCircle, HelpCircle, Award } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SkeletonLoader } from "@/components/ui/skeleton-loader";
import { useAuth } from "@/hooks/useAuth";
import { useOnboardingCourse } from "@/hooks/useOnboardingCourse";
import { CourseModuleSidebar } from "@/components/course/CourseModuleSidebar";
import { CourseVideoPlayer } from "@/components/course/CourseVideoPlayer";
import { CourseQuiz } from "@/components/course/CourseQuiz";

import { supabase } from "@/integrations/supabase/client";
import { useSoundEffects } from "@/hooks/useSoundEffects";

export default function OnboardingCourse() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { playSound } = useSoundEffects();
  const [agentId, setAgentId] = useState<string | null>(null);
  const [agentNotFound, setAgentNotFound] = useState(false);
  const [autoProvisionAttempted, setAutoProvisionAttempted] = useState(false);
  const [provisioningInProgress, setProvisioningInProgress] = useState(false);

  // Fetch agent ID for current user - use limit(1) to handle legacy duplicates
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
          await supabase
            .from("agents")
            .update({ has_training_course: true })
            .eq("id", data[0].id);
        }
      } else {
        // Retry once after a brief delay (handles race conditions on first login)
        setTimeout(async () => {
          const { data: retryData } = await supabase
            .from("agents")
            .select("id, has_training_course")
            .eq("user_id", user.id)
            .order("created_at", { ascending: false })
            .limit(1);
          
          if (retryData && retryData.length > 0) {
            setAgentId(retryData[0].id);
            if (!retryData[0].has_training_course) {
              await supabase
                .from("agents")
                .update({ has_training_course: true })
                .eq("id", retryData[0].id);
            }
          } else {
            setAgentNotFound(true);
          }
        }, 2000);
      }
    };
    fetchAgentId();
  }, [user?.id]);

  // Auto-provision: if no agent record, check if user has a licensed application and create agent
  useEffect(() => {
    const autoProvision = async () => {
      if (!agentNotFound || autoProvisionAttempted || !user?.email) return;
      setAutoProvisionAttempted(true);
      setProvisioningInProgress(true);

      try {
        // Check if user has a licensed application
        const { data: apps } = await supabase
          .from("applications")
          .select("id, first_name, last_name, email, phone, assigned_agent_id")
          .ilike("email", user.email)
          .eq("license_status", "licensed")
          .order("created_at", { ascending: false })
          .limit(1);

        if (apps && apps.length > 0) {
          const app = apps[0];
          console.log("Auto-provisioning agent for licensed applicant:", app.email);

          const { error } = await supabase.functions.invoke("add-agent", {
            body: {
              firstName: app.first_name,
              lastName: app.last_name,
              email: app.email,
              phone: app.phone || "",
              managerId: app.assigned_agent_id || null,
              licenseStatus: "licensed",
              hasTrainingCourse: true,
            },
          });

          if (!error) {
            // Re-fetch agent ID after provisioning
            await new Promise(resolve => setTimeout(resolve, 1500));
            const { data: newAgent } = await supabase
              .from("agents")
              .select("id")
              .eq("user_id", user.id)
              .order("created_at", { ascending: false })
              .limit(1);

            if (newAgent && newAgent.length > 0) {
              setAgentId(newAgent[0].id);
              setAgentNotFound(false);
            }
          } else {
            console.error("Auto-provision failed:", error);
          }
        }
      } catch (err) {
        console.error("Auto-provision error:", err);
      } finally {
        setProvisioningInProgress(false);
      }
    };
    autoProvision();
  }, [agentNotFound, autoProvisionAttempted, user?.email, user?.id]);

  const {
    modules,
    questions,
    progress,
    currentModuleIndex,
    setCurrentModuleIndex,
    loading,
    updateVideoProgress,
    submitQuiz,
    isModuleUnlocked,
    canTakeQuiz,
    getOverallProgress,
    isCourseComplete,
    currentModule
  } = useOnboardingCourse(agentId);

  const currentQuestions = currentModule ? questions[currentModule.id] || [] : [];
  const currentProgress = currentModule ? progress[currentModule.id] : null;

  const handleVideoComplete = () => {
    // No auto-switch — agent decides when to take the quiz
  };

  const handleQuizSubmit = async (answers: number[], score: number, passed: boolean) => {
    if (!currentModule) return false;
    const success = await submitQuiz(currentModule.id, answers, score, passed);
    
    if (success && passed) {
      playSound("celebrate");
    } else if (success && !passed) {
      playSound("error");
    }
    
    return success;
  };

  if (loading) {
    return <SkeletonLoader variant="page" />;
  }

  if (agentNotFound) {
    return (
      <>
        <div className="max-w-4xl mx-auto text-center py-20">
          <BookOpen className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
          <h1 className="text-2xl font-bold mb-2">Course Access Required</h1>
          <p className="text-muted-foreground mb-6">
            Your account isn't linked to an agent profile yet. Try signing in with your agent credentials, or contact your manager for help.
          </p>
          <Button onClick={() => navigate("/agent-login")} className="gap-2">
            Sign In Manually
          </Button>
        </div>
      </>
    );
  }

  if (modules.length === 0) {
    return (
      <>
        <div className="max-w-4xl mx-auto text-center py-20">
          <BookOpen className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
          <h1 className="text-2xl font-bold mb-2">Course Coming Soon</h1>
          <p className="text-muted-foreground mb-6">
            The onboarding course is being prepared. Check back soon!
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="max-w-7xl mx-auto">
        {/* Course Complete Badge */}
        {isCourseComplete() && (
          <div className="flex items-center justify-center gap-2 mb-6 px-4 py-2 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 w-fit mx-auto">
            <Award className="h-5 w-5" />
            <span className="font-medium">Course Complete!</span>
          </div>
        )}

        <div className="flex flex-col lg:flex-row gap-6">
          {/* Sidebar */}
          <CourseModuleSidebar
            modules={modules}
            progress={progress}
            currentIndex={currentModuleIndex}
            onSelectModule={setCurrentModuleIndex}
            isModuleUnlocked={isModuleUnlocked}
            overallProgress={getOverallProgress()}
          />

          {/* Content Area */}
          <div className="flex-1">
            {currentModule && (
              <motion.div
                key={currentModule.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
              >
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <span className="text-primary">Module {currentModuleIndex + 1}:</span>
                      {currentModule.title}
                    </CardTitle>
                    {currentModule.description && (
                      <CardDescription>{currentModule.description}</CardDescription>
                    )}
                  </CardHeader>
                  
                  <CardContent>
                    <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v as "video" | "quiz"); playSound("click"); }}>
                      <TabsList className="grid w-full grid-cols-2 mb-6">
                        <TabsTrigger value="video" className="gap-2">
                          <PlayCircle className="h-4 w-4" />
                          Video Lesson
                        </TabsTrigger>
                        <TabsTrigger 
                          value="quiz" 
                          className="gap-2"
                          disabled={!canTakeQuiz(currentModule.id) && !currentProgress?.passed}
                        >
                          <HelpCircle className="h-4 w-4" />
                          Quiz
                          {!canTakeQuiz(currentModule.id) && !currentProgress?.passed && (
                            <span className="text-xs opacity-60">(Watch 90%)</span>
                          )}
                        </TabsTrigger>
                      </TabsList>

                      <TabsContent value="video" className="mt-0">
                        <CourseVideoPlayer
                          videoUrl={currentModule.video_url}
                          onProgressUpdate={(percent) => updateVideoProgress(currentModule.id, percent)}
                          watchedPercent={currentProgress?.video_watched_percent || 0}
                          onVideoComplete={handleVideoComplete}
                        />
                        
                        {currentProgress?.passed && (
                          <div className="mt-4 p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
                            <p className="text-emerald-600 dark:text-emerald-400 font-medium">
                              ✓ You've already passed this module with a score of {currentProgress.score}%
                            </p>
                          </div>
                        )}
                      </TabsContent>

                      <TabsContent value="quiz" className="mt-0">
                        {currentQuestions.length > 0 ? (
                          currentProgress?.passed ? (
                            <Card className="border-2 border-emerald-500/30">
                              <CardContent className="pt-8 pb-8 text-center">
                                <Award className="h-16 w-16 text-emerald-500 mx-auto mb-4" />
                                <h3 className="text-xl font-bold mb-2">Module Completed!</h3>
                                <p className="text-muted-foreground mb-4">
                                  You passed with a score of {currentProgress.score}%
                                </p>
                                {currentModuleIndex < modules.length - 1 && (
                                  <Button onClick={() => {
                                    setCurrentModuleIndex(currentModuleIndex + 1);
                                    setActiveTab("video");
                                  }}>
                                    Continue to Next Module
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
                          <Card>
                            <CardContent className="pt-8 pb-8 text-center">
                              <HelpCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                              <p className="text-muted-foreground">
                                Quiz questions are being prepared for this module.
                              </p>
                            </CardContent>
                          </Card>
                        )}
                      </TabsContent>
                    </Tabs>
                  </CardContent>
                </Card>
              </motion.div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
