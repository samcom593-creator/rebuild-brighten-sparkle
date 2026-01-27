import { motion } from "framer-motion";
import { Lock, CheckCircle, PlayCircle, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import { OnboardingModule, OnboardingProgress } from "@/hooks/useOnboardingCourse";

interface CourseModuleSidebarProps {
  modules: OnboardingModule[];
  progress: Record<string, OnboardingProgress>;
  currentIndex: number;
  onSelectModule: (index: number) => void;
  isModuleUnlocked: (index: number) => boolean;
  overallProgress: number;
}

export function CourseModuleSidebar({
  modules,
  progress,
  currentIndex,
  onSelectModule,
  isModuleUnlocked,
  overallProgress
}: CourseModuleSidebarProps) {
  return (
    <div className="w-full lg:w-80 bg-card border rounded-xl p-4">
      {/* Overall Progress */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium">Course Progress</span>
          <span className="text-sm text-muted-foreground">{overallProgress}%</span>
        </div>
        <Progress value={overallProgress} className="h-3" />
        <p className="text-xs text-muted-foreground mt-1">
          {modules.filter(m => progress[m.id]?.passed).length} of {modules.length} modules complete
        </p>
      </div>

      {/* Module List */}
      <div className="space-y-2">
        {modules.map((module, index) => {
          const moduleProgress = progress[module.id];
          const isUnlocked = isModuleUnlocked(index);
          const isPassed = moduleProgress?.passed;
          const isActive = currentIndex === index;
          const videoPercent = moduleProgress?.video_watched_percent || 0;

          return (
            <motion.button
              key={module.id}
              onClick={() => isUnlocked && onSelectModule(index)}
              disabled={!isUnlocked}
              className={cn(
                "w-full text-left p-3 rounded-lg transition-all",
                isActive && "bg-primary/10 border-2 border-primary",
                !isActive && isUnlocked && "hover:bg-muted/50 border-2 border-transparent",
                !isUnlocked && "opacity-50 cursor-not-allowed border-2 border-transparent"
              )}
              whileHover={isUnlocked ? { scale: 1.02 } : {}}
              whileTap={isUnlocked ? { scale: 0.98 } : {}}
            >
              <div className="flex items-start gap-3">
                {/* Status Icon */}
                <div className={cn(
                  "flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center",
                  isPassed && "bg-emerald-500/20",
                  !isPassed && isUnlocked && "bg-primary/20",
                  !isUnlocked && "bg-muted"
                )}>
                  {!isUnlocked ? (
                    <Lock className="h-4 w-4 text-muted-foreground" />
                  ) : isPassed ? (
                    <CheckCircle className="h-4 w-4 text-emerald-500" />
                  ) : videoPercent > 0 ? (
                    <PlayCircle className="h-4 w-4 text-primary" />
                  ) : (
                    <BookOpen className="h-4 w-4 text-primary" />
                  )}
                </div>

                {/* Module Info */}
                <div className="flex-1 min-w-0">
                  <p className={cn(
                    "font-medium text-sm truncate",
                    isActive && "text-primary"
                  )}>
                    {index + 1}. {module.title}
                  </p>
                  
                  {isUnlocked && !isPassed && (
                    <div className="mt-1">
                      <Progress value={videoPercent} className="h-1" />
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {videoPercent >= 90 
                          ? "Ready for quiz" 
                          : `${videoPercent}% watched`
                        }
                      </p>
                    </div>
                  )}
                  
                  {isPassed && (
                    <p className="text-xs text-emerald-500 mt-1">
                      ✓ Completed • Score: {moduleProgress.score}%
                    </p>
                  )}
                </div>
              </div>
            </motion.button>
          );
        })}
      </div>

      {/* Completion Message */}
      {overallProgress === 100 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-6 p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-center"
        >
          <CheckCircle className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
          <p className="font-semibold text-emerald-600 dark:text-emerald-400">
            Course Complete! 🎉
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            You're ready for field training
          </p>
        </motion.div>
      )}
    </div>
  );
}
