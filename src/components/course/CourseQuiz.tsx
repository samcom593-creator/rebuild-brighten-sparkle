import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle, XCircle, ArrowRight, RotateCcw, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { OnboardingQuestion } from "@/hooks/useOnboardingCourse";
import { ConfettiCelebration } from "@/components/dashboard/ConfettiCelebration";

interface CourseQuizProps {
  questions: OnboardingQuestion[];
  passThreshold: number;
  attempts: number;
  onSubmit: (answers: number[], score: number, passed: boolean) => Promise<boolean>;
  onRetry: () => void;
}

export function CourseQuiz({
  questions,
  passThreshold,
  attempts,
  onSubmit,
  onRetry
}: CourseQuizProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<(number | null)[]>(new Array(questions.length).fill(null));
  const [showResult, setShowResult] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [score, setScore] = useState(0);
  const [passed, setPassed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);

  const currentQuestion = questions[currentIndex];
  const selectedAnswer = answers[currentIndex];
  const isLastQuestion = currentIndex === questions.length - 1;

  const handleAnswerSelect = (answerIndex: number) => {
    if (showFeedback) return;
    const newAnswers = [...answers];
    newAnswers[currentIndex] = answerIndex;
    setAnswers(newAnswers);
  };

  const handleNext = () => {
    setShowFeedback(true);
    
    setTimeout(() => {
      setShowFeedback(false);
      if (isLastQuestion) {
        calculateResults();
      } else {
        setCurrentIndex(prev => prev + 1);
      }
    }, 1500);
  };

  const calculateResults = async () => {
    let correct = 0;
    answers.forEach((answer, index) => {
      if (answer === questions[index].correct_answer) {
        correct++;
      }
    });
    
    const finalScore = Math.round((correct / questions.length) * 100);
    const didPass = finalScore >= passThreshold;
    
    setScore(finalScore);
    setPassed(didPass);
    setShowResult(true);
    
    if (didPass) {
      setShowConfetti(true);
    }
    
    setSubmitting(true);
    await onSubmit(answers as number[], finalScore, didPass);
    setSubmitting(false);
  };

  const handleRetry = () => {
    setAnswers(new Array(questions.length).fill(null));
    setCurrentIndex(0);
    setShowResult(false);
    setShowFeedback(false);
    setScore(0);
    setPassed(false);
    onRetry();
  };

  if (showResult) {
    return (
      <>
        <ConfettiCelebration trigger={showConfetti} onComplete={() => setShowConfetti(false)} />
        <Card className="border-2 border-primary/20">
          <CardContent className="pt-8 pb-8 text-center">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", duration: 0.5 }}
            >
              {passed ? (
                <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-emerald-500/20 flex items-center justify-center">
                  <Trophy className="h-10 w-10 text-emerald-500" />
                </div>
              ) : (
                <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-destructive/20 flex items-center justify-center">
                  <XCircle className="h-10 w-10 text-destructive" />
                </div>
              )}
            </motion.div>

            <h2 className="text-2xl font-bold mb-2">
              {passed ? "Congratulations! 🎉" : "Not Quite..."}
            </h2>
            
            <p className="text-muted-foreground mb-4">
              {passed 
                ? "You've passed this module and can move on!"
                : `You need ${passThreshold}% to pass. Keep learning!`
              }
            </p>

            <div className="text-4xl font-bold mb-6">
              <span className={passed ? "text-emerald-500" : "text-destructive"}>
                {score}%
              </span>
            </div>

            <div className="text-sm text-muted-foreground mb-6">
              Attempt #{attempts + 1} • Passing score: {passThreshold}%
            </div>

            {!passed && (
              <Button onClick={handleRetry} className="gap-2">
                <RotateCcw className="h-4 w-4" />
                Try Again
              </Button>
            )}
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <Card className="border-2 border-primary/20">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-muted-foreground">
            Question {currentIndex + 1} of {questions.length}
          </span>
          <span className="text-sm text-muted-foreground">
            {attempts > 0 && `Attempt #${attempts + 1}`}
          </span>
        </div>
        <Progress value={((currentIndex + 1) / questions.length) * 100} className="h-2" />
      </CardHeader>
      
      <CardContent className="pt-4">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentIndex}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
          >
            <CardTitle className="text-lg mb-6">{currentQuestion.question}</CardTitle>

            <RadioGroup
              value={selectedAnswer?.toString()}
              onValueChange={(value) => handleAnswerSelect(parseInt(value))}
              className="space-y-3"
            >
              {currentQuestion.options.map((option, index) => {
                const isSelected = selectedAnswer === index;
                const isCorrect = index === currentQuestion.correct_answer;
                const showCorrectness = showFeedback && isSelected;

                return (
                  <motion.div
                    key={index}
                    initial={false}
                    animate={showCorrectness ? {
                      backgroundColor: isCorrect ? "hsl(var(--success) / 0.1)" : "hsl(var(--destructive) / 0.1)"
                    } : {}}
                    className={cn(
                      "flex items-center space-x-3 p-4 rounded-lg border-2 transition-all cursor-pointer",
                      isSelected && !showFeedback && "border-primary bg-primary/5",
                      !isSelected && "border-muted hover:border-primary/50",
                      showFeedback && isSelected && isCorrect && "border-emerald-500 bg-emerald-500/10",
                      showFeedback && isSelected && !isCorrect && "border-destructive bg-destructive/10"
                    )}
                    onClick={() => handleAnswerSelect(index)}
                  >
                    <RadioGroupItem value={index.toString()} id={`option-${index}`} />
                    <Label htmlFor={`option-${index}`} className="flex-1 cursor-pointer font-normal">
                      {option}
                    </Label>
                    {showFeedback && isSelected && (
                      isCorrect ? (
                        <CheckCircle className="h-5 w-5 text-emerald-500" />
                      ) : (
                        <XCircle className="h-5 w-5 text-destructive" />
                      )
                    )}
                  </motion.div>
                );
              })}
            </RadioGroup>

            {showFeedback && currentQuestion.explanation && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-4 p-4 rounded-lg bg-muted/50 text-sm"
              >
                <strong>Explanation:</strong> {currentQuestion.explanation}
              </motion.div>
            )}

            <div className="mt-6 flex justify-end">
              <Button
                onClick={handleNext}
                disabled={selectedAnswer === null || showFeedback}
                className="gap-2"
              >
                {isLastQuestion ? "Finish Quiz" : "Next Question"}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </motion.div>
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}
