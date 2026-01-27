import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  Pencil,
  Trash2,
  HelpCircle,
  BookOpen,
  CheckCircle,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

interface Module {
  id: string;
  title: string;
  order_index: number;
}

interface Question {
  id: string;
  module_id: string;
  question: string;
  options: string[];
  correct_answer: number;
  explanation: string | null;
  order_index: number;
}

interface QuestionFormData {
  question: string;
  options: string[];
  correct_answer: number;
  explanation: string;
}

const emptyFormData: QuestionFormData = {
  question: "",
  options: ["", "", "", ""],
  correct_answer: 0,
  explanation: "",
};

export function QuizQuestionsAdmin() {
  const [modules, setModules] = useState<Module[]>([]);
  const [questions, setQuestions] = useState<Record<string, Question[]>>({});
  const [loading, setLoading] = useState(true);
  const [selectedModule, setSelectedModule] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [formData, setFormData] = useState<QuestionFormData>(emptyFormData);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    fetchModulesAndQuestions();
  }, []);

  const fetchModulesAndQuestions = async () => {
    setLoading(true);
    
    const { data: modulesData, error: modulesError } = await supabase
      .from("onboarding_modules")
      .select("id, title, order_index")
      .eq("is_active", true)
      .order("order_index");

    if (modulesError) {
      console.error("Error fetching modules:", modulesError);
      toast.error("Failed to load modules");
      setLoading(false);
      return;
    }

    setModules(modulesData || []);

    const { data: questionsData, error: questionsError } = await supabase
      .from("onboarding_questions")
      .select("*")
      .order("order_index");

    if (questionsError) {
      console.error("Error fetching questions:", questionsError);
      toast.error("Failed to load questions");
      setLoading(false);
      return;
    }

    // Group questions by module
    const grouped: Record<string, Question[]> = {};
    (questionsData || []).forEach((q) => {
      const question: Question = {
        ...q,
        options: Array.isArray(q.options) ? q.options : JSON.parse(q.options as string),
      };
      if (!grouped[q.module_id]) {
        grouped[q.module_id] = [];
      }
      grouped[q.module_id].push(question);
    });

    setQuestions(grouped);
    setLoading(false);
  };

  const handleAddQuestion = (moduleId: string) => {
    setSelectedModule(moduleId);
    setEditingQuestion(null);
    setFormData(emptyFormData);
    setIsDialogOpen(true);
  };

  const handleEditQuestion = (question: Question) => {
    setSelectedModule(question.module_id);
    setEditingQuestion(question);
    setFormData({
      question: question.question,
      options: [...question.options],
      correct_answer: question.correct_answer,
      explanation: question.explanation || "",
    });
    setIsDialogOpen(true);
  };

  const handleDeleteQuestion = async (questionId: string) => {
    if (!confirm("Are you sure you want to delete this question?")) return;
    
    setDeleting(questionId);
    
    const { error } = await supabase
      .from("onboarding_questions")
      .delete()
      .eq("id", questionId);

    if (error) {
      console.error("Error deleting question:", error);
      toast.error("Failed to delete question");
    } else {
      toast.success("Question deleted");
      fetchModulesAndQuestions();
    }
    
    setDeleting(null);
  };

  const handleSaveQuestion = async () => {
    if (!selectedModule) return;
    
    // Validation
    if (!formData.question.trim()) {
      toast.error("Question text is required");
      return;
    }
    
    const validOptions = formData.options.filter(o => o.trim());
    if (validOptions.length < 2) {
      toast.error("At least 2 options are required");
      return;
    }
    
    if (formData.correct_answer >= validOptions.length) {
      toast.error("Please select a valid correct answer");
      return;
    }

    setSaving(true);

    const questionData = {
      module_id: selectedModule,
      question: formData.question.trim(),
      options: validOptions,
      correct_answer: formData.correct_answer,
      explanation: formData.explanation.trim() || null,
      order_index: editingQuestion 
        ? editingQuestion.order_index 
        : (questions[selectedModule]?.length || 0),
    };

    if (editingQuestion) {
      const { error } = await supabase
        .from("onboarding_questions")
        .update(questionData)
        .eq("id", editingQuestion.id);

      if (error) {
        console.error("Error updating question:", error);
        toast.error("Failed to update question");
      } else {
        toast.success("Question updated");
        setIsDialogOpen(false);
        fetchModulesAndQuestions();
      }
    } else {
      const { error } = await supabase
        .from("onboarding_questions")
        .insert(questionData);

      if (error) {
        console.error("Error creating question:", error);
        toast.error("Failed to create question");
      } else {
        toast.success("Question created");
        setIsDialogOpen(false);
        fetchModulesAndQuestions();
      }
    }

    setSaving(false);
  };

  const updateOption = (index: number, value: string) => {
    const newOptions = [...formData.options];
    newOptions[index] = value;
    setFormData({ ...formData, options: newOptions });
  };

  if (loading) {
    return (
      <GlassCard className="p-6">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </GlassCard>
    );
  }

  return (
    <GlassCard className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <HelpCircle className="h-6 w-6 text-primary" />
        <h2 className="text-xl font-semibold">Quiz Questions Manager</h2>
      </div>

      <Accordion type="single" collapsible className="space-y-4">
        {modules.map((module) => {
          const moduleQuestions = questions[module.id] || [];
          return (
            <AccordionItem 
              key={module.id} 
              value={module.id}
              className="border rounded-lg px-4"
            >
              <AccordionTrigger className="hover:no-underline">
                <div className="flex items-center gap-3">
                  <BookOpen className="h-5 w-5 text-muted-foreground" />
                  <span className="font-medium">{module.title}</span>
                  <Badge variant="secondary" className="ml-2">
                    {moduleQuestions.length} questions
                  </Badge>
                </div>
              </AccordionTrigger>
              <AccordionContent className="pt-4">
                <div className="space-y-4">
                  <Button
                    size="sm"
                    onClick={() => handleAddQuestion(module.id)}
                    className="mb-4"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Question
                  </Button>

                  {moduleQuestions.length === 0 ? (
                    <p className="text-muted-foreground text-sm py-4">
                      No questions yet. Add your first question above.
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-12">#</TableHead>
                          <TableHead>Question</TableHead>
                          <TableHead className="w-24">Options</TableHead>
                          <TableHead className="w-32 text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {moduleQuestions.map((q, idx) => (
                          <TableRow key={q.id}>
                            <TableCell className="font-medium">{idx + 1}</TableCell>
                            <TableCell className="max-w-md truncate">
                              {q.question}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">{q.options.length}</Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-2">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => handleEditQuestion(q)}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="text-destructive hover:text-destructive"
                                  onClick={() => handleDeleteQuestion(q.id)}
                                  disabled={deleting === q.id}
                                >
                                  {deleting === q.id ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <Trash2 className="h-4 w-4" />
                                  )}
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>

      {/* Add/Edit Question Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingQuestion ? "Edit Question" : "Add New Question"}
            </DialogTitle>
            <DialogDescription>
              {modules.find(m => m.id === selectedModule)?.title}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            <div className="space-y-2">
              <Label htmlFor="question">Question *</Label>
              <Textarea
                id="question"
                value={formData.question}
                onChange={(e) => setFormData({ ...formData, question: e.target.value })}
                placeholder="Enter the quiz question..."
                rows={2}
              />
            </div>

            <div className="space-y-4">
              <Label>Answer Options *</Label>
              {formData.options.map((option, idx) => (
                <div key={idx} className="flex items-center gap-3">
                  <div 
                    className={`flex items-center justify-center w-8 h-8 rounded-full border-2 cursor-pointer transition-colors ${
                      formData.correct_answer === idx 
                        ? "border-primary bg-primary text-primary-foreground" 
                        : "border-muted-foreground/30 hover:border-primary"
                    }`}
                    onClick={() => setFormData({ ...formData, correct_answer: idx })}
                  >
                    {formData.correct_answer === idx && (
                      <CheckCircle className="h-4 w-4" />
                    )}
                  </div>
                  <Input
                    value={option}
                    onChange={(e) => updateOption(idx, e.target.value)}
                    placeholder={`Option ${idx + 1}`}
                    className="flex-1"
                  />
                </div>
              ))}
              <p className="text-sm text-muted-foreground">
                Click the circle to mark the correct answer
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="explanation">Explanation (optional)</Label>
              <Textarea
                id="explanation"
                value={formData.explanation}
                onChange={(e) => setFormData({ ...formData, explanation: e.target.value })}
                placeholder="Explain why the correct answer is right..."
                rows={2}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveQuestion} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingQuestion ? "Update" : "Create"} Question
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </GlassCard>
  );
}
