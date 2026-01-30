import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  BookOpen,
  Video,
  HelpCircle,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface Module {
  id: string;
  title: string;
  description: string | null;
  video_url: string;
  order_index: number;
  pass_threshold: number | null;
}

interface Question {
  id: string;
  module_id: string;
  question: string;
  options: string[];
  correct_answer: number;
  explanation: string | null;
  order_index: number | null;
}

interface CourseContentViewerProps {
  open: boolean;
  onClose: () => void;
}

export function CourseContentViewer({ open, onClose }: CourseContentViewerProps) {
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());

  // Fetch modules
  const { data: modules = [], isLoading: loadingModules } = useQuery({
    queryKey: ["course-modules-full"],
    queryFn: async () => {
      const { data } = await supabase
        .from("onboarding_modules")
        .select("*")
        .eq("is_active", true)
        .order("order_index");
      return (data || []) as Module[];
    },
    enabled: open,
  });

  // Fetch questions
  const { data: questions = [], isLoading: loadingQuestions } = useQuery({
    queryKey: ["course-questions-full"],
    queryFn: async () => {
      const { data } = await supabase
        .from("onboarding_questions")
        .select("*")
        .order("order_index");
      return (data || []) as Question[];
    },
    enabled: open,
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

  const isLoading = loadingModules || loadingQuestions;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-primary" />
            Course Content Viewer
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            View all modules, videos, and quiz questions
          </p>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : modules.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <BookOpen className="h-10 w-10 mx-auto mb-3 opacity-50" />
            <p>No course modules found</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-4">
              <Badge variant="secondary">
                {modules.length} modules • {questions.length} questions
              </Badge>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={expandAll}>
                  Expand All
                </Button>
                <Button variant="outline" size="sm" onClick={collapseAll}>
                  Collapse All
                </Button>
              </div>
            </div>

            <ScrollArea className="max-h-[60vh] pr-4">
              <div className="space-y-3">
                {modules.map((module, index) => {
                  const moduleQuestions = getModuleQuestions(module.id);
                  const isExpanded = expandedModules.has(module.id);

                  return (
                    <Collapsible
                      key={module.id}
                      open={isExpanded}
                      onOpenChange={() => toggleModule(module.id)}
                    >
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.05 }}
                        className="border rounded-lg overflow-hidden"
                      >
                        <CollapsibleTrigger asChild>
                          <div className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/50 transition-colors">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">
                                {index + 1}
                              </div>
                              <div>
                                <h3 className="font-semibold">{module.title}</h3>
                                {module.description && (
                                  <p className="text-xs text-muted-foreground line-clamp-1">
                                    {module.description}
                                  </p>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-xs">
                                <HelpCircle className="h-3 w-3 mr-1" />
                                {moduleQuestions.length} Q
                              </Badge>
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              ) : (
                                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                              )}
                            </div>
                          </div>
                        </CollapsibleTrigger>

                        <CollapsibleContent>
                          <div className="border-t p-4 space-y-4 bg-muted/20">
                            {/* Video Link */}
                            <div className="flex items-center gap-2 p-3 rounded-lg border bg-card">
                              <Video className="h-4 w-4 text-primary" />
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
                              <div className="text-xs text-muted-foreground">
                                Pass threshold: {module.pass_threshold}%
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
                                    className="p-3 rounded-lg border bg-card space-y-2"
                                  >
                                    <p className="text-sm font-medium">
                                      {qIndex + 1}. {q.question}
                                    </p>
                                    <div className="space-y-1 pl-4">
                                      {(q.options as string[]).map((option, optIndex) => (
                                        <div
                                          key={optIndex}
                                          className={cn(
                                            "text-xs p-2 rounded",
                                            optIndex === q.correct_answer
                                              ? "bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/30"
                                              : "bg-muted text-muted-foreground"
                                          )}
                                        >
                                          {optIndex === q.correct_answer && (
                                            <CheckCircle className="h-3 w-3 inline mr-1" />
                                          )}
                                          {option}
                                        </div>
                                      ))}
                                    </div>
                                    {q.explanation && (
                                      <p className="text-xs text-muted-foreground mt-2 pl-4 italic">
                                        💡 {q.explanation}
                                      </p>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </CollapsibleContent>
                      </motion.div>
                    </Collapsible>
                  );
                })}
              </div>
            </ScrollArea>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
