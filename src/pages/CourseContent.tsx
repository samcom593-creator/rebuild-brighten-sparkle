import { useState, forwardRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { 
  BookOpen, 
  Video, 
  HelpCircle, 
  CheckCircle, 
  ChevronDown, 
  ChevronRight, 
  ExternalLink, 
  ArrowLeft,
  Play
} from "lucide-react";

import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import type { CourseModule, CourseQuestion } from "@/types/course";

const CourseContent = forwardRef<HTMLDivElement>((_, ref) => {
  const navigate = useNavigate();
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());
  const [activeVideo, setActiveVideo] = useState<string | null>(null);

  // Fetch modules
  const { data: modules = [], isLoading: loadingModules } = useQuery({
    queryKey: ["course-modules-full-page"],
    queryFn: async () => {
      const { data } = await supabase
        .from("onboarding_modules")
        .select("*")
        .eq("is_active", true)
        .order("order_index");
      return (data || []) as CourseModule[];
    },
  });

  // Fetch questions
  const { data: questions = [], isLoading: loadingQuestions } = useQuery({
    queryKey: ["course-questions-full-page"],
    queryFn: async () => {
      const { data } = await supabase
        .from("onboarding_questions")
        .select("*")
        .order("order_index");
      return (data || []) as CourseQuestion[];
    },
  });

  const toggleModule = (moduleId: string) => {
    setExpandedModules((prev) => {
      const next = new Set(prev);
      if (next.has(moduleId)) {
        next.delete(moduleId);
      } else {
        next.add(moduleId);
      }
      return next;
    });
  };

  const expandAll = () => {
    setExpandedModules(new Set(modules.map((m) => m.id)));
  };

  const collapseAll = () => {
    setExpandedModules(new Set());
  };

  const getModuleQuestions = (moduleId: string) => {
    return questions.filter((q) => q.module_id === moduleId);
  };

  const getVideoId = (url: string) => {
    // Extract YouTube video ID
    const match = url.match(/(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/);
    return match ? match[1] : null;
  };

  const isLoading = loadingModules || loadingQuestions;

  return (
    <>
      <div ref={ref} className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold gradient-text flex items-center gap-2">
                <BookOpen className="h-6 w-6" />
                Course Content
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Full curriculum with videos and quiz questions
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">
              {modules.length} modules • {questions.length} questions
            </Badge>
            <Button variant="outline" size="sm" onClick={expandAll}>
              Expand All
            </Button>
            <Button variant="outline" size="sm" onClick={collapseAll}>
              Collapse All
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-20 rounded-lg bg-muted/50 animate-pulse" />
            ))}
          </div>
        ) : modules.length === 0 ? (
          <GlassCard className="p-12 text-center">
            <BookOpen className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <h2 className="text-xl font-semibold mb-2">No Course Modules</h2>
            <p className="text-muted-foreground">Course content will appear here once configured.</p>
          </GlassCard>
        ) : (
          <div className="grid lg:grid-cols-3 gap-6">
            {/* Module List - Left Column */}
            <div className="lg:col-span-2 space-y-4">
              {modules.map((module, index) => {
                const moduleQuestions = getModuleQuestions(module.id);
                const isExpanded = expandedModules.has(module.id);
                const isActiveVideo = activeVideo === module.id;

                return (
                  <GlassCard key={module.id} className="overflow-hidden">
                    <Collapsible
                      open={isExpanded}
                      onOpenChange={() => toggleModule(module.id)}
                    >
                      <CollapsibleTrigger asChild>
                        <div className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/30 transition-colors">
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                              {index + 1}
                            </div>
                            <div>
                              <h3 className="font-semibold">{module.title}</h3>
                              {module.description && (
                                <p className="text-sm text-muted-foreground line-clamp-1">
                                  {module.description}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <Badge variant="outline" className="text-xs">
                              <HelpCircle className="h-3 w-3 mr-1" />
                              {moduleQuestions.length} Questions
                            </Badge>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveVideo(isActiveVideo ? null : module.id);
                              }}
                              className="gap-1"
                            >
                              <Play className="h-4 w-4" />
                              Watch
                            </Button>
                            {isExpanded ? (
                              <ChevronDown className="h-5 w-5 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-5 w-5 text-muted-foreground" />
                            )}
                          </div>
                        </div>
                      </CollapsibleTrigger>

                      <CollapsibleContent>
                        <div className="border-t p-4 space-y-4 bg-muted/10">
                          {/* Video Link */}
                          <div className="flex items-center gap-3 p-3 rounded-lg border bg-card">
                            <Video className="h-5 w-5 text-primary" />
                            <span className="text-sm font-medium flex-1 truncate">
                              {module.video_url}
                            </span>
                            <a
                              href={module.video_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:underline"
                            >
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          </div>

                          {/* Pass Threshold */}
                          {module.pass_threshold && (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <CheckCircle className="h-4 w-4 text-primary" />
                              <span>Pass threshold: {module.pass_threshold}%</span>
                            </div>
                          )}

                          {/* Questions */}
                          {moduleQuestions.length > 0 && (
                            <div className="space-y-3">
                              <h4 className="text-sm font-semibold flex items-center gap-2">
                                <HelpCircle className="h-4 w-4 text-primary" />
                                Quiz Questions
                              </h4>
                              {moduleQuestions.map((q, qIndex) => (
                                <div
                                  key={q.id}
                                  className="p-4 rounded-lg border bg-card space-y-3"
                                >
                                  <p className="font-medium">
                                    {qIndex + 1}. {q.question}
                                  </p>
                                  <div className="space-y-2 pl-4">
                                    {(q.options as string[]).map((option, optIndex) => (
                                      <div
                                        key={optIndex}
                                        className={cn(
                                          "text-sm p-3 rounded-lg transition-colors",
                                          optIndex === q.correct_answer
                                            ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30"
                                            : "bg-muted/50 text-muted-foreground"
                                        )}
                                      >
                                        {optIndex === q.correct_answer && (
                                          <CheckCircle className="h-4 w-4 inline mr-2" />
                                        )}
                                        {option}
                                      </div>
                                    ))}
                                  </div>
                                  {q.explanation && (
                                    <div className="mt-3 p-3 rounded-lg bg-primary/5 border border-primary/10">
                                      <p className="text-sm text-muted-foreground">
                                        💡 <strong>Explanation:</strong> {q.explanation}
                                      </p>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  </GlassCard>
                );
              })}
            </div>

            {/* Video Preview Panel - Right Column */}
            <div className="lg:col-span-1">
              <div className="sticky top-6">
                <GlassCard className="p-4">
                  <h3 className="font-semibold mb-4 flex items-center gap-2">
                    <Video className="h-5 w-5 text-primary" />
                    Video Preview
                  </h3>
                  {activeVideo ? (
                    <div className="space-y-4">
                      {(() => {
                        const module = modules.find(m => m.id === activeVideo);
                        if (!module) return null;
                        const videoId = getVideoId(module.video_url);
                        
                        return (
                          <>
                            <div className="aspect-video rounded-lg overflow-hidden bg-black">
                              {videoId ? (
                                <iframe
                                  src={`https://www.youtube.com/embed/${videoId}`}
                                  className="w-full h-full"
                                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                  allowFullScreen
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                                  <a 
                                    href={module.video_url} 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-2 text-primary hover:underline"
                                  >
                                    <ExternalLink className="h-4 w-4" />
                                    Open Video
                                  </a>
                                </div>
                              )}
                            </div>
                            <div>
                              <h4 className="font-medium">{module.title}</h4>
                              {module.description && (
                                <p className="text-sm text-muted-foreground mt-1">
                                  {module.description}
                                </p>
                              )}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  ) : (
                    <div className="aspect-video rounded-lg bg-muted/30 flex items-center justify-center">
                      <div className="text-center text-muted-foreground">
                        <Play className="h-10 w-10 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">Click "Watch" on a module to preview</p>
                      </div>
                    </div>
                  )}
                </GlassCard>

                {/* Course Stats */}
                <GlassCard className="p-4 mt-4">
                  <h3 className="font-semibold mb-3">Course Overview</h3>
                  <div className="space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Total Modules</span>
                      <span className="font-medium">{modules.length}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Total Questions</span>
                      <span className="font-medium">{questions.length}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Avg. Questions/Module</span>
                      <span className="font-medium">
                        {modules.length > 0 ? Math.round(questions.length / modules.length) : 0}
                      </span>
                    </div>
                  </div>
                </GlassCard>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
});

CourseContent.displayName = "CourseContent";

export default CourseContent;
